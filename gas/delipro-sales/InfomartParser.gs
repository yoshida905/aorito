/**
 * インフォマートの仕入れのCSV(cp932を文字列にしたもの)を読み、PLの食材費・資材費の欄に割り当てる
 * (純粋関数。tests/delipro-sales.test.js)。
 */

/** 名前の比べ方: 全角英数を半角にし、空白と「株式会社」「有限会社」を除く */
function normalizeName_(s) {
  return String(s || '').normalize('NFKC').replace(/\s+/g, '').replace(/株式会社|有限会社|\(株\)|\(有\)/g, '');
}

/**
 * データ区分 D の行のうち、伝票の最初の行(［総合計］が入っている行)を伝票として返す
 * @return {{id:string,no:string,date:string,ym:string,person:string,supplier:string,amount:number}[]}
 */
function parseInfomartCsv_(text) {
  const rows = parseCsv_(text);
  const header = rows.filter(function (r) { return r[0] === '［データ区分］'; })[0];
  if (!header) throw new Error('インフォマートのCSVの見出し(［データ区分］)が見つかりません');
  const ix = {};
  header.forEach(function (n, i) { ix[n] = i; });
  ['［伝票日付］', '［伝票No］', '［自社担当者］', '［取引先名］', '［総合計］', '［取引ID_SYSTEM］'].forEach(function (n) {
    if (!(n in ix)) throw new Error('インフォマートのCSVに列 ' + n + ' がありません');
  });
  return rows.filter(function (r) { return r[0] === 'D' && r[ix['［総合計］']] !== '' && r[ix['［総合計］']] != null; })
    .map(function (r) {
      const date = r[ix['［伝票日付］']];
      return {
        id: r[ix['［取引ID_SYSTEM］']], no: r[ix['［伝票No］']], date: date, ym: date.slice(0, 7).replace('/', '-'),
        person: r[ix['［自社担当者］']], supplier: r[ix['［取引先名］']], amount: Number(r[ix['［総合計］']]) || 0,
      };
    });
}

/**
 * 伝票を、月×事業所×PLの行に集計する
 * @param slips parseInfomartCsv_ の結果(複数ファイル分を足してよい。取引IDが同じ伝票は1回だけ数える)
 * @param transfers { 伝票No: '関西' | '南海' | '除外' }
 * @return {{cells:{ym,sheet,row,value}[], lines:{ym,site,item,row,count,amount,how}[], unmapped:{ym,no,date,person,supplier,amount,reason}[]}}
 */
function assignInfomartSlips_(slips, cfg, transfers) {
  transfers = transfers || {};
  const persons = {};
  Object.keys(cfg.PERSONS).forEach(function (p) { persons[normalizeName_(p)] = cfg.PERSONS[p]; });
  const seen = {}, cellAt = {}, lineAt = {};
  const cells = [], lines = [], unmapped = [];
  slips.forEach(function (s) {
    if (seen[s.id]) return;
    seen[s.id] = true;
    const sup = cfg.SUPPLIERS.filter(function (x) { return normalizeName_(s.supplier).indexOf(normalizeName_(x.match)) !== -1; })[0];
    const miss = function (reason) {
      unmapped.push({ ym: s.ym, no: s.no, date: s.date, person: s.person, supplier: s.supplier, amount: s.amount, reason: reason });
    };
    const t = transfers[String(s.no)];
    if (t === '除外') return;
    if (!sup) return miss('取引先の割り当てがない');
    const sites = Object.keys(sup.rows);
    let site, how;
    if (t) { site = t; how = '振替'; }
    else if (sites.length === 1) { site = sites[0]; how = '取引先'; }
    else { site = persons[normalizeName_(s.person)]; how = '担当者'; }
    if (!site) return miss('担当者から事業所が決まらない');
    if (!(site in sup.rows)) return miss(site + 'のPLにこの取引先の行がない(振替先を確認)');
    const sheet = cfg.SITES[site], row = sup.rows[site];
    const ck = s.ym + '|' + sheet + '|' + row;
    if (!cellAt[ck]) { cellAt[ck] = { ym: s.ym, sheet: sheet, row: row, value: 0 }; cells.push(cellAt[ck]); }
    cellAt[ck].value += s.amount;
    const lk = ck + '|' + how;
    if (!lineAt[lk]) { lineAt[lk] = { ym: s.ym, site: site, item: sup.item, row: row, count: 0, amount: 0, how: how }; lines.push(lineAt[lk]); }
    lineAt[lk].count++;
    lineAt[lk].amount += s.amount;
  });
  return { cells: cells, lines: lines, unmapped: unmapped };
}

if (typeof module !== 'undefined') module.exports = { normalizeName_, parseInfomartCsv_, assignInfomartSlips_ };
