// 大阪GB 現金出納帳 金庫管理スクリプト(このファイル1つをApps Scriptに貼り付ける)
// 元のファイル: gas-cash/Config.gs・Ledger.gs・Setup.gs・Code.gs

// ===== Config.gs =====
/**
 * 大阪GB 現金出納帳(既存のスプレッドシート+Googleフォーム)の改修用設定。
 *
 * 金庫の中身は3つに分けて管理する:
 * - 釣銭ポーチ: 現場に持っていく釣銭。金額は固定(1万円×5個)
 * - 金庫金: 購入の現金払いに使うお金。基準額(10万円)まで補充して使う
 * - 売上封筒: ケータリング・オードブルの現金売上。支払いには使わず、銀行へ行くときに全部入金する
 */
const CASH_CONFIG = {
  // 釣銭ポーチ
  POUCH_COUNT: 5,
  POUCH_AMOUNT: 10000,

  // 金庫金の基準額(補充するときは、この額に戻す)
  FUND_BASE: 100000,
  // 支払いの登録で金庫金の残高がこの額を下回ったとき、補充依頼のメールを送る
  FUND_LOW_ALERT: 30000,

  // 売上封筒を受け取ってからこの日数を超えて金庫に残っていたら、週次メールで警告する
  ENVELOPE_ALERT_DAYS: 14,

  // 週次メール(金庫確認の前に「あるはずの金額」を知らせる)の曜日と時刻
  WEEKLY_REPORT_DAY: 'MONDAY', // SUNDAY〜SATURDAY
  WEEKLY_REPORT_HOUR: 9,

  // 通知の宛先(カンマ区切りで複数可)
  NOTIFY_EMAILS: 'yoshida@lit-house.jp',

  // 担当者名。フォームの「担当者」がプルダウン/選択式ならこの選択肢にし、
  // 記述式なら、この名前以外を入力できないようにする(「平山 きよ美」などの表記ゆれを防ぐ)
  STAFF_NAMES: ['迫田', '大岡', '吉田', '山下', '平山', '藤川', '渡邊', '楠', '山口', '空野', '花川'],

  // 「処理区分」の選択肢。残高の計算はこの文字列で分類するため、フォームと一字一句そろえること。
  // 先頭の「入金」「出金」は、金庫全体から見てお金が入るか出るか。
  // 「振替」は金庫の中でお金を移すだけなので、金庫全体の金額は変わらない。
  KINDS: {
    PAY: '出金(支払い)',
    SALE: '入金(売上金・茶封筒へ)',
    REFILL: '入金(金庫金の補充)',
    OTHER_IN: '入金(おつり・返金の戻り・その他)',
    DEPOSIT: '出金(売上封筒を全部銀行へ入金)',
    // コンビニATMは硬貨を入金できないため、売上封筒の小銭は金庫金へ移す(銀行入金の前に登録する)
    COIN: '振替(売上封筒の小銭を金庫金へ)',
  },

  // 既存のシート名
  SHEETS: {
    RESPONSES: 'フォーム回答',
    HISTORY: '入出金履歴',
    BALANCE: '現金残高',
    MONTHLY: '月別集計',
  },

  // フォーム回答シートの列(既存フォームの質問順)
  COLS: {
    TIMESTAMP: 'A',
    KIND: 'B',
    DATE: 'C',
    AMOUNT: 'D',
    DESC: 'E',
    PARTNER: 'F',
    STAFF: 'G',
    RECEIPT: 'H',
    NOTE: 'I',
  },

  // 既存フォームの質問タイトル(namedValues のキー)
  Q: {
    KIND: '処理区分',
    DATE: '取引日',
    AMOUNT: '金額',
    DESC: '内容・用途',
    PARTNER: '相手先／取引先',
    STAFF: '担当者',
  },
};

// 現金残高シートのA列の見出し(GASはこの見出しで行を探して値を読む)
const BAL = {
  TOTAL: '金庫にあるはずの合計',
  POUCH: '① 釣銭ポーチ',
  FUND: '② 金庫金(支払い用)',
  FUND_COUNTED: '　数えた金額(基準)',
  FUND_IN: '　基準日時より後の入金(補充・おつり・売上の小銭等)',
  FUND_OUT: '　基準日時より後の支払い',
  REFILL: '　補充が必要な額',
  ENVELOPE: '③ 売上封筒(銀行へ未入金)',
  ENVELOPE_COUNT: '　封筒の件数',
  BASE_TIME: '基準日時(金庫を数えた日時)',
  LAST_DEPOSIT: '最後に売上封筒を銀行へ入金した日時',
  ENVELOPE_LIST: '未入金の売上封筒',
};

// ===== Ledger.gs =====
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
    lines.push('', '銀行へ行くときに ' + formatYen_(b.refill) +
      ' を引き出して金庫金を基準額に戻し、フォームで「' + cfg.KINDS.REFILL + '」を登録してください。');
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
    // ATMは1,000円単位でしか引き出せないため、1,000円単位に切り捨てる
    [BAL.REFILL, '=MAX(0,FLOOR(' + cfg.FUND_BASE + '-B6,1000))', '基準額 ' + formatYen_(cfg.FUND_BASE) + ' に戻すために引き出す額(1,000円単位)'],
    [BAL.ENVELOPE, '=' + sumAfter(K.SALE, '$B$15') + '-' + sumAfter(K.COIN, '$B$15'), 'お札は全部入金する。小銭は金庫金へ移す(振替)'],
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

// ===== Setup.gs =====
/**
 * 初期設定。「大阪GB｜現金出納帳」スプレッドシートに紐づくApps Scriptから、最初に1回だけ実行する。
 *
 * 1. 改修前の「現金残高」シートを「現金残高(改修前)」として残す
 * 2. 「現金残高」を、釣銭ポーチ・金庫金・売上封筒の3つに分けた計算に作り直す
 * 3. 「入出金履歴」の増減額、「月別集計」、「フォーム回答」右側の残高表示を新しい処理区分に対応させる
 * 4. フォームの「処理区分」の選択肢を5つに増やす
 * 5. フォーム送信時・週次のトリガーを登録する
 */
function setupCashManagement() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = CASH_CONFIG;

  const t = ui.prompt('1/2 基準日時',
    '金庫を数えた日時を入力してください(例: 2026/09/27 15:00)。\nこの日時より後に登録したものだけが残高の計算に入ります。',
    ui.ButtonSet.OK_CANCEL);
  if (t.getSelectedButton() !== ui.Button.OK) return;
  const baseTime = parseDateTime_(t.getResponseText());
  if (!baseTime) {
    ui.alert('日時が読み取れませんでした: ' + t.getResponseText());
    return;
  }
  const f = ui.prompt('2/2 数えた金庫金',
    '数えた金額から、釣銭ポーチ(' + formatYen_(cfg.POUCH_COUNT * cfg.POUCH_AMOUNT) + ')と売上封筒を除いた金額を数字で入力してください。',
    ui.ButtonSet.OK_CANCEL);
  if (f.getSelectedButton() !== ui.Button.OK) return;
  const fundCounted = parseAmount_(f.getResponseText());
  if (!(fundCounted >= 0)) {
    ui.alert('金額が読み取れませんでした: ' + f.getResponseText());
    return;
  }

  backupBalanceSheet_(ss);
  writeBalanceSheet_(ss, fundCounted, baseTime);
  updateHistoryAndMonthly_(ss);
  updateResponseSideSummary_(ss);
  const formMsg = updateFormChoices_(ss) + '\n' + updateStaffItem_(ss);
  installTriggers_(ss);

  ui.alert('初期設定が完了しました。\n\n' + formMsg +
    '\n\n基準日時より前の取引は、今後フォームに登録しないでください(数えた金額に含まれています)。');
}

function backupBalanceSheet_(ss) {
  const name = CASH_CONFIG.SHEETS.BALANCE + '(改修前)';
  const src = ss.getSheetByName(CASH_CONFIG.SHEETS.BALANCE);
  if (!src || ss.getSheetByName(name)) return;
  const copy = src.copyTo(ss).setName(name);
  // 関数のままだと新しい処理区分で0円になるため、改修前の値で固定しておく
  const range = copy.getDataRange();
  range.setValues(range.getValues());
}

function writeBalanceSheet_(ss, fundCounted, baseTime) {
  const name = CASH_CONFIG.SHEETS.BALANCE;
  const sheet = ss.getSheetByName(name) || ss.insertSheet(name, 0);
  sheet.clear();
  sheet.getRange('A1').setValue('大阪GB｜現金残高(自動計算)').setFontSize(14).setFontWeight('bold');
  sheet.getRange('A3:C3').setValues([['項目', '金額(円)', '説明']]).setFontWeight('bold').setBackground('#d9d9d9');

  const rows = balanceSheetRows_(fundCounted, baseTime);
  sheet.getRange(4, 1, rows.length, 3).setValues(rows);
  sheet.getRange('B4:B12').setNumberFormat('#,##0');
  sheet.getRange('B12').setNumberFormat('0"件"');
  sheet.getRange('B14:B15').setNumberFormat('yyyy/mm/dd hh:mm');
  sheet.getRange('A4:B4').setFontWeight('bold').setFontSize(12).setBackground('#fff2cc');
  ['A5:B5', 'A6:B6', 'A11:B11'].forEach(function (a) { sheet.getRange(a).setFontWeight('bold'); });
  sheet.getRange('B7').setBackground('#ddebf7');
  sheet.getRange('B14').setBackground('#ddebf7');

  sheet.getRange('A17').setValue(BAL.ENVELOPE_LIST).setFontWeight('bold');
  sheet.getRange('A18:G18')
    .setValues([['受取日', '相手先', '内容', '金額', '担当者', '登録日時', '経過日数']])
    .setFontWeight('bold').setBackground('#d9d9d9');
  sheet.getRange('A19').setFormula(envelopeListFormula_());
  sheet.getRange('G19').setFormula('=ARRAYFORMULA(IF(ISNUMBER(A19:A),TODAY()-A19:A,""))');
  sheet.getRange('A19:A').setNumberFormat('yyyy/mm/dd');
  sheet.getRange('D19:D').setNumberFormat('#,##0');
  sheet.getRange('F19:F').setNumberFormat('yyyy/mm/dd hh:mm');

  sheet.setColumnWidth(1, 300);
  sheet.setColumnWidth(2, 140);
  sheet.setColumnWidth(3, 460);
  sheet.setFrozenRows(0);
}

function updateHistoryAndMonthly_(ss) {
  const cfg = CASH_CONFIG;
  const history = ss.getSheetByName(cfg.SHEETS.HISTORY);
  if (history) {
    // 「入金(…)」「出金(…)」の先頭2文字で増減を判定する(改修前の「入金」「出金」もそのまま扱える)
    history.getRange('J1').setFormula(
      // setFormula では範囲の計算にならないため ARRAYFORMULA で囲む(囲まないと #VALUE! になる)
      '=ARRAYFORMULA({"増減額";IF(A2:A1000="","",IF(LEFT(B2:B1000,2)="入金",D2:D1000,IF(LEFT(B2:B1000,2)="出金",-D2:D1000,"")))})');
  }
  const monthly = ss.getSheetByName(cfg.SHEETS.MONTHLY);
  if (monthly) {
    const R = "'" + cfg.SHEETS.RESPONSES + "'!";
    monthly.clear();
    monthly.getRange('A1').setFormula(
      '=IFERROR(QUERY({ARRAYFORMULA(IF(ISNUMBER(' + R + 'C2:C),TEXT(' + R + 'C2:C,"yyyy-mm"),"")),' +
      R + 'B2:B,' + R + 'D2:D},"select Col1, sum(Col3) where Col1 <> \'\' group by Col1 pivot Col2 label Col1 \'年月\'",0),"データなし")');
  }
}

/** フォーム回答シートの右側(L〜M列)にある残高表示を、新しい現金残高シートに合わせる */
function updateResponseSideSummary_(ss) {
  const sheet = ss.getSheetByName(CASH_CONFIG.SHEETS.RESPONSES);
  if (!sheet || sheet.getRange('L2').getValue() !== '開始残高') return; // 想定と違う場合は触らない
  const B = "'" + CASH_CONFIG.SHEETS.BALANCE + "'!";
  sheet.getRange('L2:M5').setValues([
    [BAL.TOTAL, '=' + B + 'B4'],
    ['金庫金(支払い用)', '=' + B + 'B6'],
    ['売上封筒(未入金)', '=' + B + 'B11'],
    ['補充が必要な額', '=' + B + 'B10'],
  ]);
  sheet.getRange('L29').setValue('金庫を数え直したら「現金残高」のB7(数えた金額)とB14(基準日時)を更新。');
  sheet.getRange('L30').setValue('処理区分の文字を書き換えると計算から外れるので注意。');
}

/** フォームの「処理区分」の選択肢を新しい5つにする */
function updateFormChoices_(ss) {
  const cfg = CASH_CONFIG;
  const url = ss.getFormUrl();
  if (!url) return 'このスプレッドシートに紐づくフォームが見つからなかったため、フォームの選択肢は変更していません。';
  const form = FormApp.openByUrl(url);
  const item = form.getItems().filter(function (it) { return it.getTitle() === cfg.Q.KIND; })[0];
  if (!item) return 'フォームに「' + cfg.Q.KIND + '」の質問が見つからなかったため、選択肢は変更していません。';

  const K = cfg.KINDS;
  const values = [K.PAY, K.SALE, K.REFILL, K.OTHER_IN, K.COIN, K.DEPOSIT];
  const help = '支払い → ' + K.PAY + '\n' +
    'ケータリング・オードブルの現金売上(茶封筒に入れて金庫へ) → ' + K.SALE + '\n' +
    '銀行から引き出して金庫金に足した → ' + K.REFILL + '\n' +
    'おつりの戻り・返金・空き瓶代など → ' + K.OTHER_IN + '\n' +
    '入金の前に、売上封筒の小銭を金庫金へ移した → ' + K.COIN + '\n' +
    '金庫の売上封筒のお札を全部入金した(金額は入金した合計) → ' + K.DEPOSIT;
  const type = item.getType();
  if (type === FormApp.ItemType.MULTIPLE_CHOICE) {
    item.asMultipleChoiceItem().setChoiceValues(values).setHelpText(help);
  } else if (type === FormApp.ItemType.LIST) {
    item.asListItem().setChoiceValues(values).setHelpText(help);
  } else {
    return '「' + cfg.Q.KIND + '」が選択式ではないため、選択肢は変更していません。手順書を見て手で変更してください。';
  }
  return 'フォームの「' + cfg.Q.KIND + '」の選択肢を' + values.length + 'つに変更しました。';
}

/**
 * フォームの「担当者」を Config.gs の STAFF_NAMES に合わせる。メニューからも実行できる。
 * 質問を作り直すと回答シートの列がずれるため、既存の質問をそのまま使う:
 * - プルダウン/選択式 → 選択肢を担当者名にする
 * - 記述式 → 担当者名以外を入力できないようにする
 */
function updateStaffItem_(ss) {
  const cfg = CASH_CONFIG;
  const names = cfg.STAFF_NAMES;
  if (!names.length) return '';
  const url = (ss || SpreadsheetApp.getActiveSpreadsheet()).getFormUrl();
  if (!url) return 'フォームが見つからないため、担当者は変更していません。';
  const item = FormApp.openByUrl(url).getItems()
    .filter(function (it) { return it.getTitle() === cfg.Q.STAFF; })[0];
  if (!item) return 'フォームに「' + cfg.Q.STAFF + '」の質問が見つからないため、担当者は変更していません。';

  const type = item.getType();
  if (type === FormApp.ItemType.LIST) {
    item.asListItem().setChoiceValues(names).setRequired(true);
    return '「担当者」のプルダウンを' + names.length + '名にしました。';
  }
  if (type === FormApp.ItemType.MULTIPLE_CHOICE) {
    item.asMultipleChoiceItem().setChoiceValues(names).setRequired(true);
    return '「担当者」の選択肢を' + names.length + '名にしました。';
  }
  if (type === FormApp.ItemType.TEXT) {
    const validation = FormApp.createTextValidation()
      .setHelpText('次の名前(名字)で入力してください: ' + names.join('・'))
      .requireTextMatchesPattern(staffPattern_(names))
      .build();
    item.asTextItem().setValidation(validation).setHelpText('名字だけ: ' + names.join('・')).setRequired(true);
    return '「担当者」は記述式のため、' + names.length + '名の名字以外は入力できないようにしました。' +
      'プルダウンにしたい場合は、フォームの編集画面で質問の種類を「プルダウン」に変えてから、' +
      'メニュー「金庫 > 担当者の選択肢を反映」を実行してください。';
  }
  return '「担当者」の質問の種類に対応していないため、変更していません。';
}

/** メニューから担当者の選択肢だけを反映する */
function applyStaffNames() {
  SpreadsheetApp.getUi().alert(updateStaffItem_() || 'Config.gs の STAFF_NAMES が空です。');
}

function installTriggers_(ss) {
  const cfg = CASH_CONFIG;
  // 二重登録を防ぐため、同じ関数の既存トリガーは消してから作る
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['onCashFormSubmit', 'sendWeeklyReport'].indexOf(t.getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('onCashFormSubmit').forSpreadsheet(ss).onFormSubmit().create();
  ScriptApp.newTrigger('sendWeeklyReport').timeBased()
    .onWeekDay(ScriptApp.WeekDay[cfg.WEEKLY_REPORT_DAY])
    .atHour(cfg.WEEKLY_REPORT_HOUR).create();
}

// ===== Code.gs =====
/**
 * 大阪GB 現金出納帳 フォーム送信時・週次の自動処理。
 *
 * 残高は「現金残高」シートの関数で計算される。このスクリプトは、その値を読んで
 * 補充が必要なとき・銀行入金額が合わないときに通知し、週1回「あるはずの金額」を知らせる。
 * セットアップは Setup.gs の setupCashManagement を1回だけ実行する。
 */

/** スプレッドシートを開いたときにメニューを追加する */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('金庫')
    .addItem('週次メールを今すぐ送る', 'sendWeeklyReport')
    .addItem('担当者の選択肢を反映', 'applyStaffNames')
    .addSeparator()
    .addItem('初期設定(最初に1回だけ)', 'setupCashManagement')
    .addToUi();
}

/**
 * フォーム送信をトリガーに実行される。
 * @param {GoogleAppsScript.Events.SheetsOnFormSubmit} e
 */
function onCashFormSubmit(e) {
  try {
    const cfg = CASH_CONFIG;
    const named = (e && e.namedValues) || {};
    const get = function (title) { return String((named[title] || [''])[0] || '').trim(); };
    const kind = get(cfg.Q.KIND);
    const amount = parseAmount_(get(cfg.Q.AMOUNT));
    const msgs = [];

    if (!(amount > 0)) {
      msgs.push('金額が読み取れませんでした(' + get(cfg.Q.AMOUNT) + ')。フォーム回答シートを直してください。');
    }
    if (Object.keys(cfg.KINDS).map(function (k) { return cfg.KINDS[k]; }).indexOf(kind) === -1) {
      msgs.push('処理区分「' + kind + '」は残高の計算に入りません。フォームの選択肢を確認してください。');
    }

    SpreadsheetApp.flush();
    const bal = readBalance_();

    if (kind === cfg.KINDS.PAY && amount > 0) {
      if (bal.fund < 0) {
        msgs.push('金庫金の残高がマイナス(' + formatYen_(bal.fund) + ')です。登録漏れ・二重登録がないか確認してください。');
      } else if (crossedLowAlert_(bal.fund, amount)) {
        msgs.push('金庫金の残高が ' + formatYen_(bal.fund) + ' になりました。' + formatYen_(bal.refill) +
          ' の補充が必要です(次に銀行へ行くときに引き出す)。');
      }
    }

    if (kind === cfg.KINDS.DEPOSIT && amount > 0 && e && e.range) {
      const sheet = e.range.getSheet();
      const submitTime = sheet.getRange(e.range.getRow(), 1).getValue();
      const result = checkDeposit_(readResponses_(sheet), bal.baseTime, submitTime, amount);
      if (!result.envelopes.length) {
        msgs.push('銀行入金が登録されましたが、未入金の売上封筒が登録されていません。売上の登録漏れがないか確認してください。');
      } else if (result.diff !== 0) {
        msgs.push('銀行への入金額が、登録済みの売上封筒の合計と合いません。\n' +
          '封筒の合計 ' + formatYen_(result.salesTotal) + '(' + result.envelopes.length + '件) - 金庫金へ移した小銭 ' +
          formatYen_(result.coins) + ' = ' + formatYen_(result.bookTotal) + ' / 入金額 ' +
          formatYen_(amount) + ' / 差額 ' + formatYen_(result.diff) + '\n' +
          '小銭を金庫金へ移した場合は、「' + cfg.KINDS.COIN + '」を登録してください(入金より前の日時で登録されていないと差し引かれません)。');
      }
    }

    if (msgs.length) {
      const body = msgs.concat(['', '登録内容:'])
        .concat(Object.keys(named).filter(function (k) { return get(k); })
          .map(function (k) { return '・' + k + ': ' + get(k); }))
        .concat(['', 'スプレッドシート: ' + SpreadsheetApp.getActiveSpreadsheet().getUrl()]);
      notify_('【金庫】確認が必要な登録があります', body.join('\n'));
    }
  } catch (err) {
    Logger.log('onCashFormSubmit failed: ' + err);
    notify_('【エラー】金庫の現金管理 自動処理', String(err && err.stack || err));
  }
}

/** 週1回、金庫を数える前に「あるはずの金額」をメールで知らせる */
function sendWeeklyReport() {
  const bal = readBalance_();
  const envelopes = envelopeAges_(readEnvelopeList_(), new Date());
  const lines = weeklyReportLines_(bal, envelopes)
    .concat(['', 'スプレッドシート: ' + SpreadsheetApp.getActiveSpreadsheet().getUrl()]);
  notify_('【金庫確認】あるはずの金額 ' + formatYen_(bal.total), lines.join('\n'));
}

/** 現金残高シートのA列の見出しで行を探し、B列の値を読む */
function readBalance_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CASH_CONFIG.SHEETS.BALANCE);
  const values = sheet.getRange(1, 1, 16, 2).getValues();
  const byLabel = {};
  values.forEach(function (r) { if (r[0]) byLabel[String(r[0])] = r[1]; });
  const need = function (label) {
    if (!(label in byLabel)) throw new Error('現金残高シートに「' + label + '」の行がありません。初期設定を実行してください');
    return byLabel[label];
  };
  return {
    total: Number(need(BAL.TOTAL)),
    pouch: Number(need(BAL.POUCH)),
    fund: Number(need(BAL.FUND)),
    refill: Number(need(BAL.REFILL)),
    envelope: Number(need(BAL.ENVELOPE)),
    baseTime: need(BAL.BASE_TIME),
  };
}

/** 現金残高シートの「未入金の売上封筒」一覧を読む */
function readEnvelopeList_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CASH_CONFIG.SHEETS.BALANCE);
  const last = sheet.getLastRow();
  if (last < 19) return [];
  return sheet.getRange(19, 1, last - 18, 6).getValues()
    .filter(function (r) { return isDate_(r[0]); })
    .map(function (r) { return { date: r[0], partner: r[1] || r[2], amount: Number(r[3]) || 0 }; });
}

/** フォーム回答シートから、登録日時・処理区分・金額を読む */
function readResponses_(sheet) {
  const last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, 4).getValues()
    .filter(function (r) { return isDate_(r[0]); })
    .map(function (r) { return { ts: r[0], kind: String(r[1]), amount: parseAmount_(r[3]) }; });
}

function notify_(subject, body) {
  const to = CASH_CONFIG.NOTIFY_EMAILS;
  if (!to) return;
  MailApp.sendEmail(to, subject, body);
}
