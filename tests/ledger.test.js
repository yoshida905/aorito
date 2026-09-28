// gas-cash/Ledger.gs の計算ロジックのテスト。実行: node --test tests/ledger.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load() {
  const dir = path.join(__dirname, '..', 'gas-cash');
  const src = ['Config.gs', 'Ledger.gs']
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n') +
    '\n;({CASH_CONFIG, BAL, parseAmount_, parseDateTime_, formatYen_, checkDeposit_, crossedLowAlert_,' +
    ' envelopeAges_, staffPattern_, weeklyReportLines_, balanceSheetRows_, envelopeListFormula_});';
  return vm.runInNewContext(src, {});
}

const G = load();
const K = G.CASH_CONFIG.KINDS;
const at = (d, h = 12) => new Date(2026, 8, d, h, 0);

test('金額の読み取り', () => {
  assert.equal(G.parseAmount_('1,320'), 1320);
  assert.equal(G.parseAmount_('３００００円'), 30000);
  assert.equal(G.parseAmount_(2181), 2181);
  assert.ok(Number.isNaN(G.parseAmount_('千円')));
});

test('日時の読み取り', () => {
  const d = G.parseDateTime_('2026/09/27 15:30');
  assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()], [2026, 8, 27, 15, 30]);
  assert.equal(G.parseDateTime_('2026-09-27').getHours(), 0);
  assert.equal(G.parseDateTime_('きのう'), null);
});

test('銀行入金: 基準日時と直前の入金より後の売上封筒だけを合計する', () => {
  const base = at(27, 15);
  const rows = [
    { ts: at(20), kind: K.SALE, amount: 99999 }, // 基準日時より前 → 対象外
    { ts: at(28), kind: K.SALE, amount: 30000 },
    { ts: at(28, 13), kind: K.PAY, amount: 500 },
    { ts: at(29), kind: K.DEPOSIT, amount: 30000 }, // 1回目の入金
    { ts: at(30), kind: K.SALE, amount: 44400 },
    { ts: at(30, 18), kind: K.SALE, amount: 100100 },
  ];
  const now = at(30, 20);
  const r = G.checkDeposit_(rows.concat([{ ts: now, kind: K.DEPOSIT, amount: 144500 }]), base, now, 144500);
  assert.equal(r.envelopes.length, 2);
  assert.equal(r.bookTotal, 144500);
  assert.equal(r.diff, 0);

  const short = G.checkDeposit_(rows, base, now, 143500);
  assert.equal(short.diff, -1000);

  const first = G.checkDeposit_(rows, base, at(29), 30000);
  assert.equal(first.bookTotal, 30000, '1回目は9/28の封筒だけ');
});

test('残高下限のメールは、下回った1回目だけ', () => {
  const limit = G.CASH_CONFIG.FUND_LOW_ALERT;
  assert.equal(G.crossedLowAlert_(limit - 1, 5000), true);
  assert.equal(G.crossedLowAlert_(limit - 6000, 5000), false, 'すでに下回っていた');
  assert.equal(G.crossedLowAlert_(limit, 5000), false);
});

test('週次メール: 経過日数と入金遅れの警告', () => {
  const today = at(30);
  const env = G.envelopeAges_([
    { date: at(10), partner: 'A社', amount: 30000 },
    { date: at(29), partner: 'B社', amount: 44400 },
  ], today);
  assert.deepEqual([...env.map((e) => e.days)], [20, 1]);
  const text = G.weeklyReportLines_({ total: 154368, pouch: 50000, fund: 29968, refill: 70032, envelope: 74400 }, env).join('\n');
  assert.match(text, /あるはずの合計: 154,368円/);
  assert.match(text, /補充が必要な額 70,032円/);
  assert.match(text, /売上封筒から 70,032円/);
  assert.match(text, /A社 30,000円\(20日経過 ※入金が遅れています\)/);
  assert.match(text, /14日を超えた売上封筒が 1件/);
});

test('現金残高シート: 行番号と参照がずれていない', () => {
  const rows = G.balanceSheetRows_(29968, at(27, 15));
  const rowOf = (label) => 4 + rows.findIndex((r) => r[0] === label);
  assert.equal(rowOf(G.BAL.TOTAL), 4);
  assert.equal(rows[0][1], `=B${rowOf(G.BAL.POUCH)}+B${rowOf(G.BAL.FUND)}+B${rowOf(G.BAL.ENVELOPE)}`);
  const fund = rows.find((r) => r[0] === G.BAL.FUND)[1];
  assert.equal(fund, `=B${rowOf(G.BAL.FUND_COUNTED)}+B${rowOf(G.BAL.FUND_IN)}-B${rowOf(G.BAL.FUND_OUT)}`);
  assert.equal(rowOf(G.BAL.REFILL), 10);
  assert.equal(rowOf(G.BAL.BASE_TIME), 14);
  assert.equal(rowOf(G.BAL.LAST_DEPOSIT), 15);
  // 金庫金の計算は $B$14(基準日時)、売上封筒は $B$15(最後の入金日時)より後を数える
  assert.match(rows.find((r) => r[0] === G.BAL.FUND_OUT)[1], /"出金\(支払い\)".*\$B\$14/);
  assert.match(rows.find((r) => r[0] === G.BAL.ENVELOPE)[1], /\$B\$15/);
  assert.match(G.envelopeListFormula_(), /\$B\$15/);
  // 範囲の最終行を固定しない(旧シートは30行目までしか集計していなかった)
  assert.ok(!/[A-Z]2:[A-Z]\d/.test(JSON.stringify(rows)));
  // 処理区分は「入金」「出金」「振替」で始まる(入出金履歴の増減は先頭2文字で判定。振替は増減なし)
  Object.values(K).forEach((k) => assert.match(k, /^(入金|出金|振替)/));
  assert.match(K.COIN, /^振替/);
  assert.equal(rows.find((r) => r[0] === G.BAL.REFILL)[1], '=MAX(0,100000-B6)');
  // 小銭の振替は金庫金を増やし、売上封筒から差し引く
  assert.match(rows.find((r) => r[0] === G.BAL.FUND_IN)[1], new RegExp(K.COIN.replace(/[()]/g, '\\$&')));
  assert.match(rows.find((r) => r[0] === G.BAL.ENVELOPE)[1], new RegExp('-SUMIFS\\([^)]*"' + K.COIN.replace(/[()]/g, '\\$&')));
});

test('担当者の入力チェック: 登録した名字だけ通す', () => {
  const re = new RegExp(G.staffPattern_(G.CASH_CONFIG.STAFF_NAMES));
  assert.equal(G.CASH_CONFIG.STAFF_NAMES.length, 11);
  ['迫田', '渡邊', '楠', ' 平山 ', '花川\u3000'].forEach((n) => assert.ok(re.test(n), n));
  ['平山　きよ美', '空野英夫', '渡辺', '山', ''].forEach((n) => assert.ok(!re.test(n), n));
});

test('コンビニ入金: 売上封筒から金庫金へ振替した分は入金額から差し引いて照合する', () => {
  const base = at(27, 15);
  const rows = [
    { ts: at(28), kind: K.SALE, amount: 44400 },
    { ts: at(29), kind: K.SALE, amount: 30150 },
    { ts: at(30, 9), kind: K.COIN, amount: 550 }, // 400 + 150 の小銭を金庫金へ
  ];
  const now = at(30, 10);
  const ok = G.checkDeposit_(rows, base, now, 74000);
  assert.equal(ok.salesTotal, 74550);
  assert.equal(ok.coins, 550);
  assert.equal(ok.bookTotal, 74000);
  assert.equal(ok.diff, 0);
  // 振替を登録し忘れると、小銭の分だけ差額として通知される
  const missing = G.checkDeposit_(rows.slice(0, 2), base, now, 74000);
  assert.equal(missing.diff, -550);
});

test('9/18の封筒の例: 売上255,000円から補充分を振替し、支払いは金庫金から', () => {
  const base = at(1, 9);
  const rows = [100000, 72000, 78000, 4000, 1000].map((a, i) => ({ ts: at(2 + i), kind: K.SALE, amount: a }));
  rows.push({ ts: at(18, 9), kind: K.COIN, amount: 81000 }); // 補充・支払い用に金庫金へ移した額
  const r = G.checkDeposit_(rows, base, at(18, 10), 174000);
  assert.equal(r.salesTotal, 255000);
  assert.equal(r.bookTotal, 174000);
  assert.equal(r.diff, 0);
});
