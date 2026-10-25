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
