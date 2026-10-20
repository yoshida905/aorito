// 金庫確認の記録(追加ファイル)。今のコードはそのまま残し、Apps Scriptに新しいファイルとして追加する。
// 同じ名前の関数(onOpen)は、このファイルの方が後に読まれるので、こちらのメニューが使われる。

CASH_CONFIG.SHEETS.CHECK = '金庫確認';

// 金庫確認シートの列(この順で書き込む。本社の一覧はA列=日時、F列=差額の合計を読む)
const CHECK_HEADERS = [
  '確認日時', '数えた人', '立会い', '帳簿の合計', '実際の合計', '差額(合計)',
  '帳簿の金庫金', '実際の金庫金', '差額(金庫金)', '帳簿の売上封筒', '実際の売上封筒', '差額(売上封筒)',
  '帳簿の釣銭ポーチ', '実際の釣銭ポーチ', '差額(釣銭ポーチ)', '原因・対応',
];

/**
 * 金庫確認の1行を作る。帳簿は記録した瞬間の「現金残高」シートの値で固定する
 * (あとから登録が増えても、確認した時点の差額が変わらないように)。
 * @param {{pouch:number, fund:number, envelope:number}} book 帳簿
 * @param {{pouch:number, fund:number, envelope:number}} actual 実際に数えた額
 */
function safeCheckRow_(now, counter, witness, book, actual) {
  const bookTotal = book.pouch + book.fund + book.envelope;
  const actualTotal = actual.pouch + actual.fund + actual.envelope;
  return [
    now, counter, witness, bookTotal, actualTotal, actualTotal - bookTotal,
    book.fund, actual.fund, actual.fund - book.fund,
    book.envelope, actual.envelope, actual.envelope - book.envelope,
    book.pouch, actual.pouch, actual.pouch - book.pouch,
    '',
  ];
}

/** スプレッドシートを開いたときにメニューを追加する */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('金庫')
    .addItem('金庫確認の結果を記録', 'recordSafeCheck')
    .addItem('週次メールを今すぐ送る', 'sendWeeklyReport')
    .addItem('担当者の選択肢を反映', 'applyStaffNames')
    .addSeparator()
    .addItem('初期設定(最初に1回だけ)', 'setupCashManagement')
    .addToUi();
}

/**
 * 週1回の金庫確認の結果を「金庫確認」シートに記録する(メニューから実行)。
 * 数える人が帳簿の数字に引きずられないよう、入力が終わるまで帳簿の額は見せない。
 */
function recordSafeCheck() {
  const ui = SpreadsheetApp.getUi();
  const ask = function (title, text) {
    const r = ui.prompt(title, text, ui.ButtonSet.OK_CANCEL);
    return r.getSelectedButton() === ui.Button.OK ? r.getResponseText().trim() : null;
  };
  const askAmount = function (title, text) {
    for (;;) {
      const v = ask(title, text);
      if (v === null) return null;
      const n = parseAmount_(v);
      if (n >= 0) return n;
      ui.alert('数字で入力してください: ' + v);
    }
  };
  const counter = ask('1/5 数えた人', '数えた人の名字を入力してください。');
  if (counter === null) return;
  const witness = ask('2/5 立会い', '立ち会った人の名字を入力してください。');
  if (witness === null) return;
  const pouch = askAmount('3/5 釣銭ポーチ', 'ポーチ全部の合計を数字で入力してください(例: 50000)。');
  if (pouch === null) return;
  const fund = askAmount('4/5 金庫金', '金庫金の合計を数字で入力してください。');
  if (fund === null) return;
  const envelope = askAmount('5/5 売上封筒', '売上封筒の中身の合計を数字で入力してください(なければ 0)。');
  if (envelope === null) return;

  SpreadsheetApp.flush();
  const bal = readBalance_();
  const row = safeCheckRow_(new Date(), counter, witness,
    { pouch: bal.pouch, fund: bal.fund, envelope: bal.envelope }, { pouch: pouch, fund: fund, envelope: envelope });
  checkSheet_().appendRow(row);

  const diff = row[5];
  const lines = [
    '帳簿の合計 ' + formatYen_(row[3]) + ' / 実際の合計 ' + formatYen_(row[4]) + ' / 差額 ' + formatYen_(diff),
    '金庫金の差額 ' + formatYen_(row[8]) + '、売上封筒の差額 ' + formatYen_(row[11]) + '、釣銭ポーチの差額 ' + formatYen_(row[14]),
  ];
  if (diff !== 0 || row[8] !== 0 || row[11] !== 0 || row[14] !== 0) {
    notify_('【金庫確認】差額があります ' + formatYen_(diff), lines.concat(['',
      '「金庫確認」シートの「原因・対応」に記入し、その週のうちに原因の確認か調整の登録をしてください。',
      'スプレッドシート: ' + SpreadsheetApp.getActiveSpreadsheet().getUrl()]).join('\n'));
  }
  ui.alert('記録しました。\n\n' + lines.join('\n') + (diff === 0 ? '\n\n差額はありません。' : '\n\n「金庫確認」シートの「原因・対応」に記入してください。'));
}

/** 金庫確認シート(なければ作る) */
function checkSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CASH_CONFIG.SHEETS.CHECK);
  if (!sheet) {
    sheet = ss.insertSheet(CASH_CONFIG.SHEETS.CHECK);
    sheet.getRange(1, 1, 1, CHECK_HEADERS.length).setValues([CHECK_HEADERS]).setFontWeight('bold').setBackground('#d9d9d9');
    sheet.setFrozenRows(1);
    sheet.getRange('A:A').setNumberFormat('yyyy/mm/dd hh:mm');
    sheet.getRange('D:O').setNumberFormat('#,##0;[Red]-#,##0;0');
    sheet.setColumnWidth(16, 360);
  }
  return sheet;
}
