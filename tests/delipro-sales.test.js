// node tests/delipro-sales.test.js (テスト用データは架空)
const assert = require('assert');
const { parseDeliDownloadCsv_, summarizeOrders_, summaryToTable_ } = require('../gas/delipro-sales/SalesParser.gs');

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

assert.throws(() => parseDeliDownloadCsv_('"a","b"\n"1","2"'), /見出し/);
console.log('delipro-sales tests passed');
