/**
 * アルバイト人件費のCSVを読み、事業所ごとに合計する(純粋関数。tests/delipro-sales.test.js)。
 * 個人ごとの金額は返さない(呼び出し側がシートに書かないように、合計だけにする)
 */

/** タイミーの利用明細のCSVか(見出しで判定) */
function isTimeeCsv_(text) {
  const head = String(text || '').replace(/^﻿/, '').split(/\r?\n/)[0];
  return head.indexOf('求人タイトル') !== -1 && head.indexOf('合計報酬額') !== -1;
}

/**
 * タイミーの利用明細を、月×事業所に集計する
 * @param rules [{match, site}] 求人タイトルに match が含まれれば site
 * @return {{cells:{ym,site,value}[], lines:{ym,site,title,count,hours,amount,fee}[], unmapped:{ym,title,count,amount}[]}}
 */
function summarizeTimee_(text, rules) {
  const rows = parseCsv_(String(text || '').replace(/^﻿/, ''));
  const ix = {};
  rows[0].forEach(function (n, i) { ix[n] = i; });
  ['求人タイトル', '求人日', '合計報酬額', '実働時間', '利用料'].forEach(function (n) {
    if (!(n in ix)) throw new Error('タイミーのCSVに列「' + n + '」がありません');
  });
  const cellAt = {}, lineAt = {}, missAt = {};
  const cells = [], lines = [], unmapped = [];
  rows.slice(1).forEach(function (r) {
    if (r.length < 2 || !r[ix['求人日']]) return;
    const ym = r[ix['求人日']].slice(0, 7).replace('/', '-');
    const title = r[ix['求人タイトル']].replace(/^.*】/, '');
    const amount = Number(r[ix['合計報酬額']]) || 0;
    const rule = rules.filter(function (x) { return title.indexOf(x.match) !== -1; })[0];
    if (!rule) {
      const mk = ym + '|' + title;
      if (!missAt[mk]) { missAt[mk] = { ym: ym, title: title, count: 0, amount: 0 }; unmapped.push(missAt[mk]); }
      missAt[mk].count++;
      missAt[mk].amount += amount;
      return;
    }
    const ck = ym + '|' + rule.site;
    if (!cellAt[ck]) { cellAt[ck] = { ym: ym, site: rule.site, value: 0 }; cells.push(cellAt[ck]); }
    cellAt[ck].value += amount;
    const lk = ck + '|' + title;
    if (!lineAt[lk]) { lineAt[lk] = { ym: ym, site: rule.site, title: title, count: 0, hours: 0, amount: 0, fee: 0 }; lines.push(lineAt[lk]); }
    const l = lineAt[lk];
    l.count++;
    l.hours += Number(r[ix['実働時間']]) || 0;
    l.amount += amount;
    l.fee += Number(r[ix['利用料']]) || 0;
  });
  return { cells: cells, lines: lines, unmapped: unmapped };
}

if (typeof module !== 'undefined') module.exports = { isTimeeCsv_, summarizeTimee_ };

/** マネーフォワード クラウド勤怠の日次勤怠のCSVか(見出しで判定) */
function isAttendanceCsv_(text) {
  const head = String(text || '').replace(/^﻿/, '').split(/\r?\n/)[0];
  return head.indexOf('従業員番号') !== -1 && head.indexOf('総労働時間') !== -1;
}

/** 'hh:mm' を時間(小数)にする */
function hoursOf_(s) {
  const m = String(s || '').match(/^(\d+):(\d{2})$/);
  return m ? Number(m[1]) + Number(m[2]) / 60 : 0;
}

/**
 * 日次勤怠のCSVを、1人1日1行で返す
 * @return {{emp,name,date,ym,total,overtime,night,worked}[]}
 */
function parseAttendanceCsv_(text) {
  const rows = parseCsv_(String(text || '').replace(/^﻿/, ''));
  const ix = {};
  rows[0].forEach(function (n, i) { ix[n] = i; });
  ['従業員番号', '氏名', '日付', '総労働時間', '法定外', '深夜所定', '深夜所定外', '深夜法定外'].forEach(function (n) {
    if (!(n in ix)) throw new Error('勤怠のCSVに列「' + n + '」がありません');
  });
  return rows.slice(1).filter(function (r) { return r.length > 3 && r[ix['日付']]; }).map(function (r) {
    const total = hoursOf_(r[ix['総労働時間']]);
    return {
      emp: r[ix['従業員番号']], name: r[ix['氏名']], date: r[ix['日付']], ym: r[ix['日付']].slice(0, 7).replace('/', '-'),
      total: total, overtime: hoursOf_(r[ix['法定外']]),
      night: hoursOf_(r[ix['深夜所定']]) + hoursOf_(r[ix['深夜所定外']]) + hoursOf_(r[ix['深夜法定外']]),
      worked: total > 0,
    };
  });
}

/**
 * 勤怠×時給で、月×事業所の人件費を出す。同じ人・同じ日が複数のファイルにあれば、あとのものを使う
 * @param records [{...parseAttendanceCsv_の1行, site}] site はファイル名から決めた事業所
 * @param wages { 従業員番号: {wage, dailyFare, monthlyFare, site, exclude} }
 * @return {{cells:{ym,site,value}[], lines:{ym,site,people,hours,overtime,night,days,amount}[], missing:{ym,emp,name}[]}}
 *   個人ごとの金額は返さない。missing は時給が登録されていない人(名前だけ)
 */
function calcAttendancePay_(records, wages, rates) {
  const byDay = {};
  records.forEach(function (r) { byDay[r.emp + '|' + r.date] = r; });
  const person = {};
  Object.keys(byDay).forEach(function (k) {
    const r = byDay[k];
    const w = wages[r.emp] || {};
    if (w.exclude) return;
    const site = w.site || r.site;
    const pk = r.ym + '|' + site + '|' + r.emp;
    if (!person[pk]) person[pk] = { ym: r.ym, site: site, emp: r.emp, name: r.name, hours: 0, overtime: 0, night: 0, days: 0 };
    const p = person[pk];
    p.hours += r.total;
    p.overtime += r.overtime;
    p.night += r.night;
    if (r.worked) p.days++;
  });
  const cellAt = {}, cells = [], lines = [], missing = [];
  Object.keys(person).sort().forEach(function (pk) {
    const p = person[pk];
    if (!p.days) return;
    const w = wages[p.emp];
    if (!w || !w.wage) { missing.push({ ym: p.ym, emp: p.emp, name: p.name }); return; }
    const pay = Math.round(p.hours * w.wage + p.overtime * w.wage * rates.overtime + p.night * w.wage * rates.night)
      + Math.round((w.dailyFare || 0) * p.days + (w.monthlyFare || 0));
    const ck = p.ym + '|' + p.site;
    if (!cellAt[ck]) {
      cellAt[ck] = { ym: p.ym, site: p.site, value: 0 };
      cells.push(cellAt[ck]);
      cellAt[ck].line = { ym: p.ym, site: p.site, people: 0, hours: 0, overtime: 0, night: 0, days: 0, amount: 0 };
      lines.push(cellAt[ck].line);
    }
    const c = cellAt[ck], l = c.line;
    c.value += pay;
    l.people++; l.hours += p.hours; l.overtime += p.overtime; l.night += p.night; l.days += p.days; l.amount += pay;
  });
  cells.forEach(function (c) { delete c.line; });
  return { cells: cells, lines: lines, missing: missing };
}

/** ファイル名から事業所を決める(rules: [{match, site}]) */
function siteOfFileName_(name, rules) {
  const r = rules.filter(function (x) { return String(name).indexOf(x.match) !== -1; })[0];
  return r ? r.site : '';
}

if (typeof module !== 'undefined') module.exports = Object.assign(module.exports, { isAttendanceCsv_, hoursOf_, parseAttendanceCsv_, calcAttendancePay_, siteOfFileName_ });
