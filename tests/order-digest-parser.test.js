// Node.js で Parser.gs / Code.gs の純粋関数をテストする: node tests/order-digest-parser.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const dir = path.join(__dirname, '..', 'gas', 'order-digest');
const ctx = {};
vm.createContext(ctx);
// const 宣言をコンテキストから参照できるよう var に置き換えて読み込む
['Config.gs', 'Parser.gs', 'Code.gs'].forEach((f) => {
  vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8').replace(/^const /gm, 'var '), ctx, { filename: f });
});
const fx = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('ok - ' + name);
}

test('発注請書(控え)を解析できる', () => {
  const r = ctx.parseDeliproText_(fx('order_copy.txt'));
  assert.strictEqual(r.docType, 'order_copy');
  assert.strictEqual(r.deliveryDate, '2026-10-17');
  assert.strictEqual(r.deliveryTime, '14:00～15:00');
  assert.strictEqual(r.place, '松山市サンプル町1-2-3 サンプル会館 13会議室');
  assert.strictEqual(r.client, '株式会社サンプル商事');
  assert.strictEqual(r.contact, '山田 花子');
  assert.strictEqual(r.total, 102700);
  assert.strictEqual(r.office, '愛媛');
  assert.strictEqual(r.number, '4235');
  assert.strictEqual(r.memo, '※14:30着希望');
  assert.strictEqual(r.items.length, 3);
  assert.strictEqual(r.headcount, 35);
  assert.strictEqual(ctx.mainPlanName_(r.items), '(H)【全10品】アヤカミバコ MEBUKI');
});

test('大型案件: 値引・諸経費を除いて人数220名', () => {
  const r = ctx.parseDeliproText_(fx('order_large.txt'));
  assert.strictEqual(r.docType, 'order');
  assert.strictEqual(r.client, 'サンプル合同会社');
  assert.strictEqual(r.total, 1299000);
  assert.strictEqual(r.items.length, 6);
  assert.strictEqual(r.items[3].amount, -45000);
  assert.strictEqual(r.headcount, 220);
  assert.strictEqual(r.changeDeadlineDays, 5);
  assert.strictEqual(r.number, '2650');
});

test('個人宛の見積書(様)を解析できる', () => {
  const r = ctx.parseDeliproText_(fx('estimate_person.txt'));
  assert.strictEqual(r.docType, 'estimate');
  assert.strictEqual(r.client, '佐藤 次郎');
  assert.strictEqual(r.headcount, 6);
  assert.strictEqual(r.changeDeadlineDays, 3);
  assert.strictEqual(r.deliveryDate, '2026-10-14');
});

test('ファイル名で書類を判定し、発注請書を優先する', () => {
  assert.strictEqual(ctx.classifyDocByName_('MrBuffet_発注請書（控え）_2610101300.pdf'), 'order_copy');
  assert.strictEqual(ctx.classifyDocByName_('MrBuffet_発注請書_2610101254.pdf'), 'order');
  assert.strictEqual(ctx.classifyDocByName_('MrBuffet_見積書_ WAKABA.pdf'), 'estimate');
  assert.strictEqual(ctx.classifyDocByName_('会場レイアウト.pdf'), null);

  const pick = ctx.pickRepresentativeFile_([
    { name: 'MrBuffet_見積書_2610091736.pdf', created: 1 },
    { name: 'MrBuffet_発注請書_2610091738.pdf', created: 2 },
    { name: 'レイアウト.pdf', created: 3 },
  ]);
  assert.strictEqual(pick.status, '確定');
  assert.strictEqual(pick.file.name, 'MrBuffet_発注請書_2610091738.pdf');

  const pending = ctx.pickRepresentativeFile_([
    { name: 'MrBuffet_見積書_ WAKABA.pdf', created: 1 },
    { name: 'MrBuffet_見積書_MEBUKI.pdf', created: 5 },
  ]);
  assert.strictEqual(pending.status, '保留');
  assert.strictEqual(pending.estimateCount, 2);
  assert.strictEqual(pending.file.name, 'MrBuffet_見積書_MEBUKI.pdf');
  assert.strictEqual(ctx.pickRepresentativeFile_([{ name: 'メモ.pdf', created: 1 }]), null);
});

test('フォルダ名の日付判定(年またぎ含む)', () => {
  const p = /^(\d{2})(\d{2})[_＿]/;
  assert.strictEqual(ctx.folderDateInRange_('1017_★サンプル', p, [2026, 10, 11], [2026, 11, 1]), '2026-10-17');
  assert.strictEqual(ctx.folderDateInRange_('1010_★サンプル', p, [2026, 10, 11], [2026, 11, 1]), null);
  assert.strictEqual(ctx.folderDateInRange_('0105_★サンプル', p, [2026, 12, 28], [2027, 1, 18]), '2027-01-05');
  assert.strictEqual(ctx.folderDateInRange_('サンプル', p, [2026, 10, 11], [2026, 11, 1]), null);
});

test('日付ヘルパー', () => {
  assert.strictEqual(ctx.addDaysYmd_('2026-12-28', 7), '2027-01-04');
  assert.strictEqual(ctx.diffDaysYmd_('2026-10-11', '2026-10-19'), 8);
  assert.strictEqual(ctx.formatYmdJa_('2026-10-11'), '10/11(日)');
  assert.strictEqual(ctx.timeSortKey_('9:00～10:00'), '09:00');
  assert.strictEqual(ctx.timeSortKey_(''), '99:99');
});

test('メール本文を組み立てられる', () => {
  const mk = (file, date, status, area) => {
    const r = ctx.parseDeliproText_(fx(file));
    return {
      folderName: date + '_★sample', folderUrl: 'https://drive/f', area, date, status,
      estimateCount: 1, fileId: 'x', fileUrl: 'https://drive/x', fileName: file,
      info: Object.assign({}, r, { plan: ctx.mainPlanName_(r.items) }), notes: [],
      isLarge: r.headcount >= 50,
    };
  };
  const main = [mk('order_copy.txt', '2026-10-17', '確定', '愛媛'), mk('estimate_person.txt', '2026-10-14', '保留', '東京')];
  const ahead = [mk('order_large.txt', '2026-10-24', '確定', '大阪')];
  const mail = ctx.buildMail_('2026-10-11', '2026-10-18', main, ahead);
  assert.strictEqual(mail.subject, '【デリプロ注文一覧】10/11(日)〜10/18(日) 確定1件・保留1件・大型1件');
  assert.ok(mail.html.includes('大型案件'));
  assert.ok(mail.html.includes('10/19(月) 締切済') === false);
  assert.ok(mail.html.includes('10/19(月) あと8日'));
  assert.ok(mail.html.includes('案件なし'));
  fs.writeFileSync(path.join(require('os').tmpdir(), 'order-digest-preview.html'), mail.html);
});

console.log(passed + ' tests passed');
