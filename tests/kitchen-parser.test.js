// Node.js で KitchenParser.gs をテストする: node tests/kitchen-parser.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const dir = path.join(__dirname, '..', 'gas', 'kitchen-digest');
const ctx = {};
vm.createContext(ctx);
['Config.gs', 'KitchenParser.gs', 'DeliListParser.gs', 'Code.gs'].forEach((f) => {
  vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8').replace(/^const /gm, 'var '), ctx, { filename: f });
});

const orders = ctx.parseKitchenText_(fs.readFileSync(path.join(__dirname, 'fixtures', 'kitchen.txt'), 'utf8'), '2026-10-11');
const byNo = Object.fromEntries(orders.map((o) => [o.number, o]));
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok - ' + name); }

test('注文を6件に分割できる', () => {
  assert.strictEqual(orders.length, 6);
  assert.strictEqual(orders.map((o) => o.number).join(','), '4067,3777,4095,3763,3068,4137');
});

test('日時・宛名・住所を読み取れる', () => {
  const o = byNo['4095'];
  assert.strictEqual(o.date, '2026-10-11');
  assert.strictEqual(o.time, '11:10');
  assert.strictEqual(o.client, '山田 花子');
  assert.strictEqual(o.place, '大道1－11－20サンプルマンション1A');
  assert.strictEqual(o.plans.length, 4);
  assert.strictEqual(o.headcount, 15);
});

test('時間なしのお届けも読める', () => {
  assert.strictEqual(byNo['4137'].time, '');
  assert.strictEqual(byNo['4137'].date, '2026-10-18');
  assert.strictEqual(byNo['4137'].headcount, 20);
  assert.strictEqual(byNo['4137'].details, 'こだわりの田舎風ミートパテ 20');
});

test('重複プランは最大値で人数を出す(105名)', () => {
  assert.strictEqual(byNo['3777'].headcount, 105);
  assert.strictEqual(byNo['3777'].client, '株式会社サンプルプロデュース 辻');
});

test('LIVE・ケーキ・諸経費を除いて138名', () => {
  assert.strictEqual(byNo['3068'].headcount, 138);
});

test('プラン欄が諸経費だけなら明細の数量から推定(400名)', () => {
  assert.strictEqual(byNo['3763'].headcount, 400);
});

test('プラン欄なし(南海)は住所と明細を分ける', () => {
  const o = byNo['4067'];
  assert.strictEqual(o.client, 'サンプル電鉄株式会社 株式会社サンプル');
  assert.strictEqual(o.place, '難波1-1-1サンプル駅パントリー');
  assert.strictEqual(o.details, 'サンプル3号 ランチ 14 サンプル4号 アフタヌーンティー 8 ロック氷1kg 4');
  assert.strictEqual(o.headcount, 14);
});

test('年またぎ: 12月に1月分は翌年', () => {
  assert.strictEqual(ctx.inferYear_(1, 5, '2026-12-28'), '2027-01-05');
  assert.strictEqual(ctx.inferYear_(12, 30, '2026-12-28'), '2026-12-30');
});


test('メール本文を組み立てられる', () => {
  const list = orders.filter((o) => o.date <= '2026-10-18');
  list.forEach((o) => { o.isLarge = o.headcount >= 50; o.status = o.number === '4095' ? '保留' : '確定'; });
  const mail = ctx.buildKitchenMail_('2026-10-11', '2026-10-18', list, []);
  assert.strictEqual(mail.subject, '【キッチン指示書】10/11(日)〜10/18(日) 6件(保留1件)・大型3件');
  assert.ok(mail.html.includes('大型案件'));
  assert.ok(mail.html.includes('注文なし'));
  assert.ok(mail.html.includes('(C)特別プラン×138'));
  assert.ok(mail.html.includes('>保留</b>'));
});

test('集配一覧HTMLから注文番号・保留・日時・受付を読み取れる', () => {
  const r = ctx.parseDeliList_(fs.readFileSync(path.join(__dirname, 'fixtures', 'deli_list.html'), 'utf8'));
  assert.strictEqual(r.total, 2);
  assert.strictEqual(r.orders.length, 2);
  assert.strictEqual(JSON.stringify(r.orders[0]), JSON.stringify({ odid: '4241', status: '確定', date: '2026-10-11', time: '', office: '東海事業所' }));
  assert.strictEqual(JSON.stringify(r.orders[1]), JSON.stringify({ odid: '4155', status: '保留', date: '2026-10-11', time: '09:30', office: '大阪事業所' }));
});

test('複数プランは料理明細の数量を優先、大皿は人前×数量', () => {
  assert.strictEqual(ctx.estimateKitchenHeadcount_([{ name: '(C)特別プラン', qty: 20 }, { name: '(H)特別プラン', qty: 16 }], '・ローストビーフ 36 ・お寿司 20'), 36);
  assert.strictEqual(ctx.estimateKitchenHeadcount_([{ name: '(H)ごち【15品】極上黒皿盛り', qty: 1 }], 'ミートパテ(20人前) 1 唐揚げ(20人前) 1'), 20);
  assert.strictEqual(ctx.estimateKitchenHeadcount_([], '1皿6名様分（500円） 105 40cm×60cmケーキ 1'), 105);
});


test('OCRで「1/1」が途中に出たり数量がくっついても読める', () => {
  const t = '注文番号 No.4068 10/12(月) 14:30 お届け サンプル電鉄株式会社 様 1/1 サンプル1号 モーニング7 サンプル2号 ランチ7 ロック氷1kg4';
  const o = ctx.parseKitchenText_(t, '2026-10-11')[0];
  assert.ok(!o.details.includes('1/1'));
  assert.strictEqual(o.headcount, 7);
  assert.strictEqual(ctx.estimateKitchenHeadcount_([], '1.5L 64貫 1皿6名様分 2'), 2);
});

test('プラン欄が諸経費だけなら明細も表示する', () => {
  assert.strictEqual(ctx.planText_({ plans: [{ name: '(雑)諸経費', qty: 1 }], details: '(C)特別プラン 400' }), '(雑)諸経費×1 / (C)特別プラン 400');
});

console.log(passed + ' tests passed');
