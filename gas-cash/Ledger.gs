/**
 * 計算ロジック(Googleのサービスを使わない純粋な関数だけを置く)。
 * tests/ledger.test.js から Node.js でテストできるようにしている。
 *
 * 残高そのものは「現金残高」シートの関数で計算する。ここにあるのは、
 * 関数では書きにくい通知の判定と、シートの関数を組み立てる処理だけ。
 */

/** 「30,000」「３００００円」「¥30000」などを数値にする。数字でなければ NaN */
function parseAmount_(value) {
  if (typeof value === 'number') return value;
  const s = String(value == null ? '' : value)
    .replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xfee0); })
    .replace(/[,，円\s¥￥]/g, '');
  if (!/^\d+$/.test(s)) return NaN;
  return Number(s);
}

/** Date かどうか(スプレッドシートの日付セルは Date で届く) */
function isDate_(v) {
  return Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime());
}

/** 「2026/09/27 15:00」「2026-09-27」を Date にする。読めなければ null */
function parseDateTime_(value) {
  if (isDate_(value)) return value;
  const m = String(value || '').match(/(\d{4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})日?(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0));
}

function formatMd_(date) {
  return (date.getMonth() + 1) + '/' + date.getDate();
}

function formatYen_(n) {
  const sign = n < 0 ? '-' : '';
  return sign + String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '円';
}

function daysBetween_(from, to) {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / 86400000);
}

/**
 * 売上封筒の銀行入金を登録したとき、登録済みの未入金封筒の合計と入金額を比べる。
 * 未入金の封筒 = 基準日時と直前の銀行入金より後に登録され、今回の登録より前に登録された売上。
 * 同じ期間に金庫金へ移した小銭(振替)は、入金しなくてよい額として差し引く。
 * @param {{ts: Date, kind: string, amount: number}[]} rows フォーム回答(今回の行も含んでよい)
 * @param {Date} baseTime 基準日時(金庫を数えた日時)
 * @param {Date} submitTime 今回の登録日時
 * @param {number} amount 今回登録した入金額
 */
function checkDeposit_(rows, baseTime, submitTime, amount) {
  const K = CASH_CONFIG.KINDS;
  let from = baseTime;
  rows.forEach(function (r) {
    if (r.kind === K.DEPOSIT && r.ts < submitTime && r.ts > from) from = r.ts;
  });
  const envelopes = rows.filter(function (r) {
    return r.kind === K.SALE && r.ts > from && r.ts < submitTime;
  });
  const coins = rows.filter(function (r) {
    return r.kind === K.COIN && r.ts > from && r.ts < submitTime;
  }).reduce(function (s, r) { return s + (Number(r.amount) || 0); }, 0);
  const salesTotal = envelopes.reduce(function (s, r) { return s + (Number(r.amount) || 0); }, 0);
  const bookTotal = salesTotal - coins;
  return { envelopes: envelopes, salesTotal: salesTotal, coins: coins, bookTotal: bookTotal, diff: amount - bookTotal };
}

/**
 * 支払いの登録で、金庫金の残高が下限をまたいで下回ったか。
 * 下回った状態で登録が続くたびにメールが届かないよう、またいだときだけ true にする。
 */
function crossedLowAlert_(fundAfter, paidAmount) {
  const limit = CASH_CONFIG.FUND_LOW_ALERT;
  return fundAfter < limit && fundAfter + paidAmount >= limit;
}

/** 未入金の封筒に経過日数を付ける(古い順) */
function envelopeAges_(list, today) {
  return list
    .filter(function (e) { return isDate_(e.date); })
    .map(function (e) {
      return Object.assign({}, e, { days: daysBetween_(e.date, today) });
    })
    .sort(function (a, b) { return a.date - b.date; });
}

/** 週次メールの本文 */
function weeklyReportLines_(b, envelopes) {
  const cfg = CASH_CONFIG;
  const lines = [
    '金庫確認の日です。下の金額を金庫確認表の青い欄に書き写してから、2人で数えてください。',
    '',
    '金庫にあるはずの合計: ' + formatYen_(b.total),
    '',
    '1. 釣銭ポーチ: ' + formatYen_(b.pouch) + '(' + formatYen_(cfg.POUCH_AMOUNT) + ' × ' + cfg.POUCH_COUNT + '個)',
    '2. 金庫金: ' + formatYen_(b.fund) + '(基準額 ' + formatYen_(cfg.FUND_BASE) + '、補充が必要な額 ' + formatYen_(b.refill) + ')',
    '3. 売上封筒: ' + formatYen_(b.envelope) + '(' + envelopes.length + '件)',
  ];
  envelopes.forEach(function (e) {
    lines.push('   ・' + formatMd_(e.date) + '受取 ' + e.partner + ' ' + formatYen_(e.amount) +
      '(' + e.days + '日経過' + (e.days > cfg.ENVELOPE_ALERT_DAYS ? ' ※入金が遅れています' : '') + ')');
  });
  if (b.refill > 0) {
    lines.push('', '次の入金の日に、売上封筒から ' + formatYen_(b.refill) + '(小銭を含む)を金庫金へ移し、' +
      'フォームで「' + cfg.KINDS.COIN + '」を登録してから、残りのお札を入金してください。' +
      '売上封筒が足りないときは、銀行から引き出して「' + cfg.KINDS.REFILL + '」を登録してください。');
  }
  const late = envelopes.filter(function (e) { return e.days > cfg.ENVELOPE_ALERT_DAYS; });
  if (late.length) {
    lines.push('', '受け取りから' + cfg.ENVELOPE_ALERT_DAYS + '日を超えた売上封筒が ' + late.length +
      '件あります。次に銀行へ行くときに必ず入金してください。');
  }
  return lines;
}

/**
 * 現金残高シートに書く内容(A列の見出し, B列の値または関数, C列の説明)。
 * フォーム回答シートを直接参照するので、行が増えても範囲切れにならない。
 */
function balanceSheetRows_(fundCounted, baseTime) {
  const cfg = CASH_CONFIG;
  const K = cfg.KINDS;
  const C = cfg.COLS;
  const R = "'" + cfg.SHEETS.RESPONSES + "'!";
  const col = function (c) { return R + c + '2:' + c; };
  const ts = col(C.TIMESTAMP), kind = col(C.KIND), amt = col(C.AMOUNT);
  const sumAfter = function (k, cell) {
    return 'SUMIFS(' + amt + ',' + kind + ',"' + k + '",' + ts + ',">"&' + cell + ')';
  };
  // 行番号は下の配列の並びで決まる(4行目から)
  const rows = [
    [BAL.TOTAL, '=B5+B6+B11', '①+②+③。週1回の金庫確認で、実際に数えた合計と比べる'],
    [BAL.POUCH, cfg.POUCH_COUNT * cfg.POUCH_AMOUNT, formatYen_(cfg.POUCH_AMOUNT) + '×' + cfg.POUCH_COUNT + '個(固定)'],
    [BAL.FUND, '=B7+B8-B9', '購入の現金払いに使うお金'],
    [BAL.FUND_COUNTED, fundCounted, '基準日時に数えた金庫金(ポーチ・売上封筒を除く)'],
    [BAL.FUND_IN, '=' + sumAfter(K.REFILL, '$B$14') + '+' + sumAfter(K.OTHER_IN, '$B$14') + '+' + sumAfter(K.COIN, '$B$14'), ''],
    [BAL.FUND_OUT, '=' + sumAfter(K.PAY, '$B$14'), ''],
    [BAL.REFILL, '=MAX(0,' + cfg.FUND_BASE + '-B6)', '基準額 ' + formatYen_(cfg.FUND_BASE) + ' に戻す額。入金の日に売上封筒から振替で移す'],
    [BAL.ENVELOPE, '=' + sumAfter(K.SALE, '$B$15') + '-' + sumAfter(K.COIN, '$B$15'), '入金の日に、小銭と補充分を金庫金へ振替し、残りのお札を全部入金する'],
    [BAL.ENVELOPE_COUNT, '=COUNTIFS(' + kind + ',"' + K.SALE + '",' + ts + ',">"&$B$15)', ''],
    ['', '', ''],
    [BAL.BASE_TIME, baseTime, 'この日時より後に登録したものだけを計算する。金庫を数え直したら、ここと数えた金額を更新'],
    [BAL.LAST_DEPOSIT, '=MAX($B$14,IFERROR(MAXIFS(' + ts + ',' + kind + ',"' + K.DEPOSIT + '"),0))', '自動'],
  ];
  return rows;
}

/** 未入金の売上封筒の一覧(現金残高シートの18行目から)を出す関数 */
function envelopeListFormula_() {
  const cfg = CASH_CONFIG;
  const C = cfg.COLS;
  const R = "'" + cfg.SHEETS.RESPONSES + "'!";
  const col = function (c) { return R + c + '2:' + c; };
  return '=IFERROR(FILTER({' + [C.DATE, C.PARTNER, C.DESC, C.AMOUNT, C.STAFF, C.TIMESTAMP].map(col).join(',') +
    '},' + col(C.KIND) + '="' + cfg.KINDS.SALE + '",' + col(C.TIMESTAMP) + '>$B$15),"なし")';
}

/** 担当者名だけを受け付ける入力チェックの正規表現(前後の半角・全角スペースは許す) */
function staffPattern_(names) {
  const escaped = names.map(function (n) { return n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); });
  return '^[\\s\u3000]*(' + escaped.join('|') + ')[\\s\u3000]*$';
}
