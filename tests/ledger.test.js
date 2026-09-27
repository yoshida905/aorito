// gas-cash/Ledger.gs の計算ロジックのテスト。実行: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load() {
  const dir = path.join(__dirname, '..', 'gas-cash');
  const src = ['Config.gs', 'Ledger.gs']
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n') +
    '\n;({CASH_CONFIG, PLACE, ENVELOPE_STATUS, parseAmount_, parseDate_, buildEntries_,' +
    ' computeSummary_, envelopeLabel_, extractEnvelopeIds_, summaryLines_});';
  return vm.runInNewContext(src, {});
}

const G = load();
const Q = G.CASH_CONFIG.Q;
const K = G.CASH_CONFIG.KINDS;
const NOW = new Date(2026, 9, 5, 10, 0);

// buildEntries_ の結果を台帳に反映する(Code.gs の appendLedgerRows_ + settleEnvelopes_ 相当)
function apply(ledger, answers, now = NOW) {
  const r = G.buildEntries_(answers, ledger, now);
  const next = ledger.map((row) => Object.assign({}, row));
  next.forEach((row) => {
    if (r.settleIds.includes(row.id)) row.status = G.ENVELOPE_STATUS.DEPOSITED;
  });
  return { ledger: next.concat(r.rows), result: r };
}

const opening = [{ id: '', date: new Date(2026, 9, 1), type: '開始残高', place: G.PLACE.FUND, amountIn: 100000, amountOut: '' }];

test('金額の読み取り', () => {
  assert.equal(G.parseAmount_('1,320'), 1320);
  assert.equal(G.parseAmount_('３００００円'), 30000);
  assert.equal(G.parseAmount_('¥ 600'), 600);
  assert.ok(Number.isNaN(G.parseAmount_('千円')));
  assert.ok(Number.isNaN(G.parseAmount_('')));
});

test('日付の読み取り', () => {
  const d = G.parseDate_('2026/09/27', null);
  assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate()], [2026, 8, 27]);
  assert.equal(G.parseDate_('', 'fallback'), 'fallback');
});

test('支払い・売上受取・補充で残高が合う', () => {
  let s = { ledger: opening };
  s = apply(s.ledger, { [Q.KIND]: K.PAY, [Q.STAFF]: '山田', [Q.PAY_DATE]: '2026/10/02', [Q.PAY_AMOUNT]: '9240', [Q.PAY_DESC]: '消耗品', [Q.PAY_RECEIPT]: 'あり(レシート置き場に保管した)' });
  s = apply(s.ledger, { [Q.KIND]: K.PAY, [Q.STAFF]: '鈴木', [Q.PAY_DATE]: '2026/10/03', [Q.PAY_AMOUNT]: '600', [Q.PAY_DESC]: '駐車場代', [Q.PAY_RECEIPT]: 'あり(レシート置き場に保管した)' });
  s = apply(s.ledger, { [Q.KIND]: K.SALE, [Q.STAFF]: '佐藤', [Q.SALE_DATE]: '2026/09/15', [Q.SALE_AMOUNT]: '30000', [Q.SALE_DESC]: 'A社', [Q.SALE_TYPE]: 'ケータリング' });
  s = apply(s.ledger, { [Q.KIND]: K.SALE, [Q.STAFF]: '佐藤', [Q.SALE_DATE]: '2026/10/04', [Q.SALE_AMOUNT]: '44400', [Q.SALE_DESC]: 'B社', [Q.SALE_TYPE]: 'オードブル' });

  const sum = G.computeSummary_(s.ledger, NOW);
  assert.equal(sum.pouchTotal, 50000);
  assert.equal(sum.fund, 100000 - 9240 - 600);
  assert.equal(sum.refill, 9840);
  assert.equal(sum.envelopeTotal, 74400);
  assert.equal(sum.envelopes.length, 2);
  assert.equal(sum.envelopes[0].id, 'U0001'); // 古い順
  assert.equal(sum.oldEnvelopes.length, 1); // 9/15受取は20日経過
  assert.equal(sum.expectedTotal, 50000 + 90160 + 74400);

  s = apply(s.ledger, { [Q.KIND]: K.REFILL, [Q.STAFF]: '社長', [Q.REFILL_DATE]: '2026/10/05', [Q.REFILL_AMOUNT]: '9840', [Q.REFILL_SOURCE]: '銀行口座から引き出し' });
  assert.equal(G.computeSummary_(s.ledger, NOW).fund, 100000);
});

test('銀行入金で封筒が保管中から外れ、金額違いは警告', () => {
  let s = { ledger: opening };
  s = apply(s.ledger, { [Q.KIND]: K.SALE, [Q.SALE_DATE]: '2026/10/01', [Q.SALE_AMOUNT]: '30000', [Q.SALE_DESC]: 'A社' });
  s = apply(s.ledger, { [Q.KIND]: K.SALE, [Q.SALE_DATE]: '2026/10/02', [Q.SALE_AMOUNT]: '44400', [Q.SALE_DESC]: 'B社' });
  const labels = G.computeSummary_(s.ledger, NOW).envelopes
    .map((e) => G.envelopeLabel_({ id: e.id, date: e.date, desc: e.desc, amountIn: e.amount }));
  assert.ok(!labels.some((l) => l.includes(',')), 'チェックボックスの区切りと衝突しないこと');

  // U0001 だけ入金、報告額が1,000円少ない
  s = apply(s.ledger, { [Q.KIND]: K.DEPOSIT, [Q.DEPOSIT_DATE]: '2026/10/05', [Q.DEPOSIT_ENVELOPES]: labels[0], [Q.DEPOSIT_AMOUNT]: '29000' });
  assert.deepEqual([...s.result.settleIds], ['U0001']);
  assert.equal(s.result.warnings.length, 1);
  assert.match(s.result.warnings[0], /合いません/);
  const sum = G.computeSummary_(s.ledger, NOW);
  assert.equal(sum.envelopeTotal, 44400);
  assert.equal(sum.fund, 100000, '売上封筒の入金は金庫金に影響しない');

  // 同じ封筒をもう一度入金しようとしたら警告
  s = apply(s.ledger, { [Q.KIND]: K.DEPOSIT, [Q.DEPOSIT_ENVELOPES]: labels.join(', '), [Q.DEPOSIT_AMOUNT]: '44400' });
  assert.deepEqual([...s.result.settleIds], ['U0002']);
  assert.ok(s.result.warnings.some((w) => w.includes('U0001')));
  assert.equal(G.computeSummary_(s.ledger, NOW).envelopeTotal, 0);
});

test('金額が読めない・レシートなしは警告', () => {
  const r = G.buildEntries_({ [Q.KIND]: K.PAY, [Q.PAY_AMOUNT]: 'せんえん', [Q.PAY_RECEIPT]: 'なし(理由を支払先の欄に書いた)' }, opening, NOW);
  assert.equal(r.warnings.length, 2);
});

test('残高が下限を下回ったら fundLow', () => {
  const { ledger } = apply(opening, { [Q.KIND]: K.PAY, [Q.PAY_AMOUNT]: '75000', [Q.PAY_RECEIPT]: 'あり' });
  assert.equal(G.computeSummary_(ledger, NOW).fundLow, true);
});
