/**
 * 入出金の計算ロジック(Googleのサービスを使わない純粋な関数だけを置く)。
 * tests/ledger.test.js から Node.js でテストできるようにしている。
 */

/** 「30,000」「３００００円」「¥30000」などを数値にする。数字でなければ NaN */
function parseAmount_(value) {
  const s = String(value == null ? '' : value)
    .replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xfee0); })
    .replace(/[,，円\s¥￥]/g, '');
  if (!/^\d+$/.test(s)) return NaN;
  return Number(s);
}

/** 「2026/09/27」「2026-09-27」を Date にする。読めなければ fallback を返す */
function parseDate_(value, fallback) {
  const m = String(value || '').match(/(\d{4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})/);
  if (!m) return fallback;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function formatMd_(date) {
  return (date.getMonth() + 1) + '/' + date.getDate();
}

function formatYen_(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '円';
}

function daysBetween_(from, to) {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / 86400000);
}

/** 売上封筒の次の記録ID(U0001, U0002, ...) */
function nextEnvelopeId_(ledger) {
  let max = 0;
  ledger.forEach(function (r) {
    const m = String(r.id || '').match(/^U(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  });
  return 'U' + ('0000' + (max + 1)).slice(-4);
}

/**
 * フォームの「入金した売上封筒」の選択肢に出す文字列。
 * チェックボックスの回答はカンマ区切りで届くため、金額にカンマを入れない。
 */
function envelopeLabel_(row) {
  return row.id + ' ' + formatMd_(row.date) + '受取 ' + row.desc + ' ' + row.amountIn + '円';
}

/** 回答文字列から封筒の記録IDを取り出す */
function extractEnvelopeIds_(text) {
  return String(text || '').match(/U\d{4,}/g) || [];
}

/**
 * フォームの1回答を、入出金台帳に追加する行と、入金済みにする封筒に変換する。
 * @param {Object<string,string>} answers 質問タイトル → 回答
 * @param {Object[]} ledger 既存の台帳(オブジェクト配列)
 * @param {Date} now 登録日時
 * @return {{rows: Object[], settleIds: string[], warnings: string[]}}
 */
function buildEntries_(answers, ledger, now) {
  const Q = CASH_CONFIG.Q;
  const K = CASH_CONFIG.KINDS;
  const kind = answers[Q.KIND] || '';
  const staff = answers[Q.STAFF] || '';
  const base = {
    id: '', createdAt: now, date: now, type: '', place: '', amountIn: '', amountOut: '',
    desc: '', staff: staff, receipt: '', status: '', depositDate: '', memo: '',
  };
  const warnings = [];
  const rows = [];
  let settleIds = [];

  function amountOf(title) {
    const n = parseAmount_(answers[title]);
    if (!(n > 0)) {
      warnings.push('金額が読み取れませんでした(' + title + ': ' + (answers[title] || '空欄') + ')。台帳を手で直してください。');
      return 0;
    }
    return n;
  }

  if (kind === K.PAY) {
    rows.push(Object.assign({}, base, {
      date: parseDate_(answers[Q.PAY_DATE], now),
      type: '支払い',
      place: PLACE.FUND,
      amountOut: amountOf(Q.PAY_AMOUNT),
      desc: answers[Q.PAY_DESC] || '',
      receipt: answers[Q.PAY_RECEIPT] || '',
    }));
    if (answers[Q.PAY_RECEIPT] && answers[Q.PAY_RECEIPT].indexOf('なし') !== -1) {
      warnings.push('レシート・領収書なしの支払いが登録されました。');
    }
  } else if (kind === K.SALE) {
    const saleType = answers[Q.SALE_TYPE] ? '(' + answers[Q.SALE_TYPE] + ')' : '';
    rows.push(Object.assign({}, base, {
      id: nextEnvelopeId_(ledger),
      date: parseDate_(answers[Q.SALE_DATE], now),
      type: '売上受取',
      place: PLACE.ENVELOPE,
      amountIn: amountOf(Q.SALE_AMOUNT),
      desc: (answers[Q.SALE_DESC] || '') + saleType,
      status: ENVELOPE_STATUS.KEPT,
    }));
  } else if (kind === K.DEPOSIT) {
    const date = parseDate_(answers[Q.DEPOSIT_DATE], now);
    const kept = {};
    ledger.forEach(function (r) {
      if (r.place === PLACE.ENVELOPE && r.status === ENVELOPE_STATUS.KEPT && r.id) kept[r.id] = r;
    });
    const ids = extractEnvelopeIds_(answers[Q.DEPOSIT_ENVELOPES]);
    const valid = ids.filter(function (id) { return kept[id]; });
    ids.forEach(function (id) {
      if (!kept[id]) warnings.push('封筒 ' + id + ' は保管中の一覧にありません(入金済みの可能性)。');
    });
    const bookTotal = valid.reduce(function (s, id) { return s + Number(kept[id].amountIn || 0); }, 0);
    const reported = amountOf(Q.DEPOSIT_AMOUNT);
    if (valid.length === 0) {
      warnings.push('入金した売上封筒が選ばれていません。');
    } else if (reported && reported !== bookTotal) {
      warnings.push('入金額が封筒の登録額と合いません。登録額 ' + formatYen_(bookTotal) +
        ' / 入金額 ' + formatYen_(reported) + ' / 差額 ' + formatYen_(reported - bookTotal));
    }
    if (valid.length) {
      rows.push(Object.assign({}, base, {
        date: date,
        type: '銀行入金',
        place: PLACE.ENVELOPE,
        amountOut: bookTotal,
        desc: '封筒 ' + valid.join(' '),
        memo: '銀行への入金額 ' + formatYen_(reported),
      }));
    }
    settleIds = valid;
  } else if (kind === K.REFILL) {
    rows.push(Object.assign({}, base, {
      date: parseDate_(answers[Q.REFILL_DATE], now),
      type: '補充',
      place: PLACE.FUND,
      amountIn: amountOf(Q.REFILL_AMOUNT),
      desc: answers[Q.REFILL_SOURCE] || '',
    }));
  } else {
    warnings.push('登録の種類が読み取れませんでした: ' + kind);
  }
  return { rows: rows, settleIds: settleIds, warnings: warnings };
}

/**
 * 台帳から、金庫に「今あるはずの金額」を計算する。
 * @param {Object[]} ledger
 * @param {Date} today
 */
function computeSummary_(ledger, today) {
  const cfg = CASH_CONFIG;
  let fund = 0;
  const envelopes = [];
  ledger.forEach(function (r) {
    const inn = Number(r.amountIn || 0);
    const out = Number(r.amountOut || 0);
    if (r.place === PLACE.FUND) fund += inn - out;
    if (r.place === PLACE.ENVELOPE && r.status === ENVELOPE_STATUS.KEPT) {
      envelopes.push({
        id: r.id, date: r.date, desc: r.desc, amount: inn,
        days: daysBetween_(r.date, today),
      });
    }
  });
  envelopes.sort(function (a, b) { return a.date - b.date; });
  const envelopeTotal = envelopes.reduce(function (s, e) { return s + e.amount; }, 0);
  const pouchTotal = cfg.POUCH_COUNT * cfg.POUCH_AMOUNT;
  return {
    pouchTotal: pouchTotal,
    fund: fund,
    refill: Math.max(0, cfg.FUND_BASE - fund),
    fundLow: fund < cfg.FUND_LOW_ALERT,
    envelopes: envelopes,
    envelopeTotal: envelopeTotal,
    oldEnvelopes: envelopes.filter(function (e) { return e.days > cfg.ENVELOPE_ALERT_DAYS; }),
    expectedTotal: pouchTotal + fund + envelopeTotal,
  };
}

/** 週次メール・残高シートに使う文面 */
function summaryLines_(s) {
  const cfg = CASH_CONFIG;
  const lines = [
    '金庫に今あるはずの金額: ' + formatYen_(s.expectedTotal),
    '',
    '1. 釣銭ポーチ: ' + formatYen_(s.pouchTotal) + '(' + formatYen_(cfg.POUCH_AMOUNT) + ' × ' + cfg.POUCH_COUNT + '個)',
    '2. 金庫金: ' + formatYen_(s.fund) + '(基準額 ' + formatYen_(cfg.FUND_BASE) + '、補充が必要な額 ' + formatYen_(s.refill) + ')',
    '3. 売上封筒: ' + formatYen_(s.envelopeTotal) + '(' + s.envelopes.length + '件)',
  ];
  s.envelopes.forEach(function (e) {
    lines.push('   ・' + e.id + ' ' + formatMd_(e.date) + '受取 ' + e.desc + ' ' + formatYen_(e.amount) +
      '(' + e.days + '日経過' + (e.days > cfg.ENVELOPE_ALERT_DAYS ? ' ※入金が遅れています' : '') + ')');
  });
  return lines;
}
