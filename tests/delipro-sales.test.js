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

// PLの並びへの変換
const { plColumnOf_, buildPlCells_ } = require('../gas/delipro-sales/PlLayout.gs');
assert.strictEqual(plColumnOf_('2026-03', 3, 'D'), 4);   // D列
assert.strictEqual(plColumnOf_('2026-10', 3, 'D'), 18);  // R列
assert.strictEqual(plColumnOf_('2027-02', 3, 'D'), 26);  // Z列
const plSummary = summarizeOrders_(
  [{ odid: '1', payment: '請求書', amount: 110000 }, { odid: '2', payment: '未定', amount: 5000 }, { odid: '3', payment: '現金', amount: 7000 }],
  { 1: '東京直販', 2: '東京直販', 3: '愛媛' }, ['東京直販', '愛媛'], ['現金', '請求書']);
plSummary.tax = { 東京直販: { total: 115000, exTax: 104630, r10: 110000, r8: 5000, r0: 0 } };
const pc = buildPlCells_(plSummary, [{ sheet: 'PL_東京', blocks: [{ type: '東京直販', rows: { 現金: 3, 請求書: 5, r10: 6, r8: 7, ex: 8 } }] }]);
assert.deepStrictEqual(pc.cells.map(c => [c.row, c.value]), [[3, 0], [5, 110000], [6, 110000], [7, 5000], [8, 104630]]);
assert.deepStrictEqual(pc.unmapped, [{ type: '東京直販', item: '未定', amount: 5000 }, { type: '愛媛', item: '合計', amount: 7000 }]);
const nankai = summarizeOrders_(
  [{ odid: '1', payment: '請求書', amount: 100000 }, { odid: '2', payment: '未定', amount: 39500 }],
  { 1: '大阪南海', 2: '大阪南海' }, ['大阪南海'], ['請求書', '未定']);
nankai.tax = { 大阪南海: { total: 139500, exTax: 129166, r10: 0, r8: 139500, r0: 0 } };
const pn = buildPlCells_(nankai, [{ sheet: 'PL_南海', blocks: [{ type: '大阪南海', rows: { 請求書: 25, 未定: 25, r8: 26, ex: 27 } }] }]);
assert.deepStrictEqual(pn.cells.map(c => [c.row, c.value]), [[25, 139500], [26, 139500], [27, 129166]]);
assert.deepStrictEqual(pn.unmapped, []);
console.log('pl layout tests passed');

// 売上分析(期間)の画面で選ばれている検索条件の読み取り
const { parseTaxForm_ } = require('../gas/delipro-sales/TaxParser.gs');
const form = '<select name="daytype"><option value="1"\n\t\t>注文日</option><option value="2"\n\t\tselected\n>お届け日</option></select>'
  + '<select id="slt_odtype" class="slt_odtype" name="odtype[]" value="" multiple="multiple"><option value="0" >未設定</option><option value="4" selected>大阪直販</option></select>'
  + '<select name="odstatus" id="odstatus"><option value="9999"\n>&nbsp;</option><option value="0"\n selected\n>確定</option></select>';
assert.deepStrictEqual(parseTaxForm_(form), { daytype: ['2'], odtype: ['4'], odstatus: ['0'] });
console.log('tax form tests passed');

// インフォマートの仕入れのCSV(架空の取引先・担当者)
{
  global.parseCsv_ = require('../gas/delipro-sales/SalesParser.gs').parseCsv_;
  const { normalizeName_, parseInfomartCsv_, assignInfomartSlips_ } = require('../gas/delipro-sales/InfomartParser.gs');
  assert.strictEqual(normalizeName_('株式会社Ｔｅｓｔ　Ｆｏｏｄ'), 'TestFood');
  const H = '［データ区分］,［伝票日付］,［伝票No］,［自社担当者］,［取引先名］,［金額］,［総合計］,［取引ID_SYSTEM］';
  const im = [
    'H,2026/10/16', H,
    'D,2026/09/01,1,山田 一郎,株式会社青果A,1000,1500,T1', 'D,2026/09/01,1,山田 一郎,株式会社青果A,500,,T1',
    'D,2026/09/02,2,佐藤花子,株式会社青果A,700,700,T2',
    'D,2026/09/03,3,佐藤花子,有限会社精肉B,2000,2000,T3',
    'D,2026/09/04,4,山田一郎,株式会社青果A,-300,-300,T4',
    'D,2026/09/05,5,山田一郎,鮮魚C,900,900,T5',
    'D,2026/09/06,6,山田一郎,株式会社青果A,400,400,T6',
    'D,2026/09/07,7,山田一郎,株式会社青果A,800,800,T7',
    'D,2026/10/01,8,佐藤花子,有限会社精肉B,100,100,T8',
    'F',
  ].join('\r\n');
  const slips = parseInfomartCsv_(im);
  assert.strictEqual(slips.length, 8);
  assert.deepStrictEqual([slips[0].ym, slips[0].amount, slips[3].amount], ['2026-09', 1500, -300]);
  const cfg = {
    SITES: { 関西: 'K', 南海: 'N' },
    PERSONS: { '山田 一郎': '関西', 佐藤花子: '南海' },
    SUPPLIERS: [{ match: '青果A', item: '青果A', rows: { 関西: 66, 南海: 68 } }, { match: '精肉B', item: '精肉B', rows: { 南海: 71 } }],
  };
  // 同じ取引IDの伝票は1回だけ。伝票6は南海へ振替、伝票7は除外
  const r = assignInfomartSlips_(slips.concat([slips[0]]), cfg, { 6: '南海', 7: '除外' });
  const v = (ym, sheet, row) => (r.cells.find(c => c.ym === ym && c.sheet === sheet && c.row === row) || {}).value;
  assert.strictEqual(v('2026-09', 'K', 66), 1200);
  assert.strictEqual(v('2026-09', 'N', 68), 1100);
  assert.strictEqual(v('2026-09', 'N', 71), 2000);
  assert.strictEqual(v('2026-10', 'N', 71), 100);
  assert.deepStrictEqual(r.unmapped.map(u => [u.no, u.reason]), [['5', '取引先の割り当てがない']]);
  assert.deepStrictEqual(r.lines.filter(l => l.row === 68).map(l => [l.how, l.count]), [['担当者', 1], ['振替', 1]]);
  // 片方の事業所にしか行がない取引先を、行のない事業所へ振り替えたとき
  assert.match(assignInfomartSlips_([slips[2]], cfg, { 3: '関西' }).unmapped[0].reason, /関西のPLにこの取引先の行がない/);
}
console.log('infomart ok');
