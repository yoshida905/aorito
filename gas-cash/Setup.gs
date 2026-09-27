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
  const values = [K.PAY, K.SALE, K.REFILL, K.OTHER_IN, K.DEPOSIT];
  const help = '支払い → ' + K.PAY + '\n' +
    'ケータリング・オードブルの現金売上(茶封筒に入れて金庫へ) → ' + K.SALE + '\n' +
    '銀行から引き出して金庫金に足した → ' + K.REFILL + '\n' +
    'おつりの戻り・返金・空き瓶代など → ' + K.OTHER_IN + '\n' +
    '金庫の売上封筒を全部銀行に入金した(金額は入金した合計) → ' + K.DEPOSIT;
  const type = item.getType();
  if (type === FormApp.ItemType.MULTIPLE_CHOICE) {
    item.asMultipleChoiceItem().setChoiceValues(values).setHelpText(help);
  } else if (type === FormApp.ItemType.LIST) {
    item.asListItem().setChoiceValues(values).setHelpText(help);
  } else {
    return '「' + cfg.Q.KIND + '」が選択式ではないため、選択肢は変更していません。手順書を見て手で変更してください。';
  }
  return 'フォームの「' + cfg.Q.KIND + '」の選択肢を5つに変更しました。';
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
