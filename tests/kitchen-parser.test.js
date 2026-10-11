// Node.js で KitchenParser.gs をテストする: node tests/kitchen-parser.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const dir = path.join(__dirname, '..', 'gas', 'kitchen-digest');
const ctx = {};
vm.createContext(ctx);
['Config.gs', 'KitchenParser.gs', 'Code.gs'].forEach((f) => {
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
  list.forEach((o) => { o.isLarge = o.headcount >= 50; });
  const file = { getUrl: () => 'https://drive/x', getName: () => 'kitchen_2610111233.pdf' };
  const mail = ctx.buildKitchenMail_('2026-10-11', '2026-10-18', list, file);
  assert.strictEqual(mail.subject, '【キッチン指示書】10/11(日)〜10/18(日) 6件・大型3件');
  assert.ok(mail.html.includes('大型案件'));
  assert.ok(mail.html.includes('注文なし'));
  assert.ok(mail.html.includes('(C)特別プラン×138'));
});

test('複数プランは料理明細の数量を優先、大皿は人前×数量', () => {
  assert.strictEqual(ctx.estimateKitchenHeadcount_([{ name: '(C)特別プラン', qty: 20 }, { name: '(H)特別プラン', qty: 16 }], '・ローストビーフ 36 ・お寿司 20'), 36);
  assert.strictEqual(ctx.estimateKitchenHeadcount_([{ name: '(H)ごち【15品】極上黒皿盛り', qty: 1 }], 'ミートパテ(20人前) 1 唐揚げ(20人前) 1'), 20);
  assert.strictEqual(ctx.estimateKitchenHeadcount_([], '1皿6名様分（500円） 105 40cm×60cmケーキ 1'), 105);
});

console.log(passed + ' tests passed');
