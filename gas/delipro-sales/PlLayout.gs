/**
 * 集計結果を、PL(事業別PL)の売上欄と同じ行・列に並べる(純粋関数。tests/delipro-sales.test.js)。
 */

/** 'yyyy-MM' の月が、PLの何列目(1始まり)か */
function plColumnOf_(ym, firstMonth, firstColumn) {
  const m = Number(ym.slice(5, 7));
  const idx = (m - firstMonth + 12) % 12;
  return firstColumn.charCodeAt(0) - 64 + idx * 2;
}

/**
 * @param summary summarizeOrders_ の結果(tax 付き)
 * @return {{cells:{sheet:string,row:number,value:number}[], unmapped:{type:string,item:string,amount:number}[]}}
 *   unmapped はPLに置き場所がない金額(例: 東京直販の「未定」)。PLに載らず漏れるので知らせる
 */
function buildPlCells_(summary, layout) {
  const cells = [], unmapped = [];
  const placed = {};
  layout.forEach(function (sh) {
    sh.blocks.forEach(function (b) {
      placed[b.type] = true;
      const c = summary.cells[b.type] || {};
      const tx = (summary.tax && summary.tax[b.type]) || { r10: 0, r8: 0, r0: 0, exTax: 0 };
      Object.keys(b.rows).forEach(function (key) {
        const value = key === 'ex' ? tx.exTax : /^r(10|8|0)$/.test(key) ? tx[key] : (c[key] || 0);
        cells.push({ sheet: sh.sheet, row: b.rows[key], value: value });
      });
      Object.keys(c).forEach(function (p) {
        if (!(p in b.rows) && c[p]) unmapped.push({ type: b.type, item: p, amount: c[p] });
      });
      if (!('r0' in b.rows) && tx.r0) unmapped.push({ type: b.type, item: '0%対象', amount: tx.r0 });
    });
  });
  // PLに欄がない注文区分(例: 東海卸・山口/福岡・愛媛・区分なし)
  summary.types.forEach(function (t) {
    if (!placed[t] && summary.rowTotal[t]) unmapped.push({ type: t, item: '合計', amount: summary.rowTotal[t] });
  });
  return { cells: cells, unmapped: unmapped };
}

if (typeof module !== 'undefined') module.exports = { plColumnOf_, buildPlCells_ };
