// node tests/delipro-sales.test.js (テスト用データは架空)
const assert = require('assert');
const { parseDeliDownloadCsv_, summarizeOrders_, summaryToTable_, addTax_ } = require('../gas/delipro-sales/SalesParser.gs');
const { parseTaxSummary_ } = require('../gas/delipro-sales/TaxParser.gs');

const csv = [
  '"注文データ：","作成日時","26年10月11日 17時40分"',
  '"注文番号","配達時間","会社名","届け先名","届け先電話番号","届け先住所","配達方法","支払区分","合計金額","注文点数","備考","商品"',
  '"101","10:00","テスト商事","山田","","","配達","請求書","120000","40","1行目\n2行目, カンマ入り","(C)プラン"',
  '"102","11:00","サンプル株式会社","","","","配達","クレジットカード","30000","10","","(H)オードブル"',
  '"103","12:00","見本工業","","","","配達","Cqree代理請求","50000","20","""引用""","(C)プラン"',
  '"104","13:00","区分漏れ商店","","","","来店","請求書","8000","2","",""',
  '',
].join('\r\n');

const orders = parseDeliDownloadCsv_(csv);
assert.strictEqual(orders[0].company, 'テスト商事');
assert.deepStrictEqual(orders.map(o => [o.odid, o.payment, o.amount]), [
  ['101', '請求書', 120000], ['102', 'クレジットカード', 30000], ['103', 'Cqree代理請求', 50000], ['104', '請求書', 8000],
]);

const s = summarizeOrders_(orders, { 101: '大阪直販', 102: '大阪直販', 103: '大阪CS' }, ['大阪直販', '大阪CS'], ['現金', 'クレジットカード', '請求書']);
assert.strictEqual(s.total, 208000);
assert.deepStrictEqual(s.types, ['大阪直販', '大阪CS', '区分なし']);
assert.deepStrictEqual(s.payments, ['現金', 'クレジットカード', '請求書', 'Cqree代理請求']);
const t = summaryToTable_(s);
assert.deepStrictEqual(t[0], ['注文区分', '件数', '現金', 'クレジットカード', '請求書', 'Cqree代理請求', '合計(税込)']);
assert.deepStrictEqual(t[1], ['大阪直販', 2, 0, 30000, 120000, 0, 150000]);
assert.deepStrictEqual(t[2], ['大阪CS', 1, 0, 0, 0, 50000, 50000]);
assert.deepStrictEqual(t[3], ['区分なし', 1, 0, 0, 8000, 0, 8000]);
assert.deepStrictEqual(t[4], ['合計', 4, 0, 30000, 128000, 50000, 208000]);

// 税率別の列と照合
s.tax = {
  大阪直販: { total: 150000, exTax: 137000, r10: 120000, r8: 30000, r0: 0 },
  大阪CS: { total: 49000, exTax: 44546, r10: 49000, r8: 0, r0: 0 },
  区分なし: { total: 8000, exTax: 7408, r10: 0, r8: 8000, r0: 0 },
};
const tt = summaryToTable_(s);
assert.deepStrictEqual(tt[0].slice(-5), ['10%対象(税込)', '8%対象(税込)', '0%対象', '税抜', '照合']);
assert.deepStrictEqual(tt[1].slice(-5), [120000, 30000, 0, 137000, '一致']);
assert.deepStrictEqual(tt[2].slice(-5), [49000, 0, 0, 44546, '差 1000']);
assert.deepStrictEqual(tt[4].slice(-5), [169000, 38000, 0, 188954, '差 1000']);
const added = addTax_({ 大阪直販: { total: 10, exTax: 9, r10: 10, r8: 0, r0: 0 } }, { 大阪直販: { total: 5, exTax: 4, r10: 0, r8: 5, r0: 0 } });
assert.deepStrictEqual(added.大阪直販, { total: 15, exTax: 13, r10: 10, r8: 5, r0: 0 });

// 売上分析(期間)の画面の読み取り(画面の作りを模した架空のHTML)
const page = '<tr><th>注文件数</th><th>注文点数</th><th>送料合計</th><th>注文合計</th><th>客単価</th><th>点単価</th></tr>'
  + '<tr><td><p style="font-size: x-large;">3</p></td><td><p>90</p></td><td><p>0</p></td>'
  + '<td><p style="font-size: x-large;">208,000</p><p>税抜: 190,000</p><p>(<span>10%対象</span> 150,000)</p><p>(<span>8%対象</span> 50,000)</p><p>(<span>0%対象</span> 8,000)</p></td><td>69,333</td><td>2,311</td></tr>';
assert.deepStrictEqual(parseTaxSummary_(page), { total: 208000, exTax: 190000, r10: 150000, r8: 50000, r0: 8000 });
const empty = '<tr><th>注文件数</th><th>注文点数</th><th>送料合計</th><th>注文合計</th><th>客単価</th><th>点単価</th></tr>'
  + '<tr><td><p>0</p></td><td><p>0</p></td><td><p>0</p></td><td><p>0</p><p>税抜: 0</p></td><td>-</td><td>-</td></tr>';
assert.deepStrictEqual(parseTaxSummary_(empty), { total: 0, exTax: 0, r10: 0, r8: 0, r0: 0 });
assert.throws(() => parseTaxSummary_(page.replace('8,000)', '9,000)')), /合いません/);

assert.throws(() => parseDeliDownloadCsv_('"a","b"\n"1","2"'), /見出し/);
console.log('delipro-sales tests passed');
