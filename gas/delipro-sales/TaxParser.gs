/**
 * デリプロ「売上分析(期間)」(analyze_sale_time.php)の画面から、注文合計と税率別の金額を読む(純粋関数)。
 * 画面の表示: 注文合計 8,504,047 / 税抜: 7,801,630 / (10%対象 5,809,360) (8%対象 2,352,710) (0%対象 341,977)
 * 税率別の金額は税込。該当がない税率は画面に出ないので0とする。
 * @return {{total:number, exTax:number, r10:number, r8:number, r0:number}}
 */
function parseTaxSummary_(html) {
  const text = String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  const num = function (re) {
    const m = text.match(re);
    return m ? Number(m[1].replace(/,/g, '')) : null;
  };
  const m = text.match(/注文合計 客単価 点単価 ([\d,]+) ([\d,]+) ([\d,]+) ([\d,]+) 税抜\s*[:：]\s*([\d,]+)/);
  if (!m) throw new Error('売上分析(期間)の画面から注文合計を読めませんでした。デリプロの画面の仕様変更の可能性があります');
  const r = {
    total: Number(m[4].replace(/,/g, '')),
    exTax: Number(m[5].replace(/,/g, '')),
    r10: num(/10\s*[%％]\s*対象\s*([\d,]+)/) || 0,
    r8: num(/8\s*[%％]\s*対象\s*([\d,]+)/) || 0,
    r0: num(/(?:^|[^0-9])0\s*[%％]\s*対象\s*([\d,]+)/) || 0,
  };
  if (r.r10 + r.r8 + r.r0 !== r.total) {
    throw new Error('売上分析(期間)の税率別の合計(' + (r.r10 + r.r8 + r.r0) + ')が注文合計(' + r.total + ')と合いません');
  }
  return r;
}

if (typeof module !== 'undefined') module.exports = { parseTaxSummary_ };
