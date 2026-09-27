/**
 * 初期設定。新しいスプレッドシートに紐づくApps Scriptから、最初に1回だけ実行する。
 *
 * 1. 「入出金台帳」「残高」シートを作る
 * 2. 出し入れ登録用のGoogleフォームを作り、このスプレッドシートを回答先にする
 * 3. フォーム送信時・週次のトリガーを登録する
 * 4. 金庫金の開始残高を入力する(実行前に金庫金を数えておくこと)
 */
function setupCashManagement() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const props = PropertiesService.getScriptProperties();

  if (props.getProperty('FORM_ID')) {
    const again = ui.alert('初期設定は実行済みです。フォームをもう一度作りますか?', ui.ButtonSet.YES_NO);
    if (again !== ui.Button.YES) return;
  }

  // 1. シート(開始残高は台帳を新しく作るときだけ入れる。再実行で二重に入らないように)
  let ledger = ss.getSheetByName(CASH_CONFIG.SHEETS.LEDGER);
  if (!ledger) {
    const res = ui.prompt('金庫金の開始残高',
      '金庫金(釣銭ポーチと売上封筒を除いた、支払い用のお金)を数えた金額を数字で入力してください。',
      ui.ButtonSet.OK_CANCEL);
    if (res.getSelectedButton() !== ui.Button.OK) return;
    const opening = parseAmount_(res.getResponseText());
    if (!(opening >= 0)) {
      ui.alert('金額が読み取れませんでした: ' + res.getResponseText());
      return;
    }
    ledger = ss.insertSheet(CASH_CONFIG.SHEETS.LEDGER);
    ledger.getRange(1, 1, 1, LEDGER_HEADERS.length).setValues([LEDGER_HEADERS]).setFontWeight('bold');
    ledger.setFrozenRows(1);
    ledger.getRange('C:C').setNumberFormat('yyyy/mm/dd');
    ledger.getRange('F:G').setNumberFormat('#,##0');
    ledger.getRange('L:L').setNumberFormat('yyyy/mm/dd');
    appendLedgerRows_([{
      id: '', createdAt: new Date(), date: new Date(), type: '開始残高', place: PLACE.FUND,
      amountIn: opening, amountOut: '', desc: '運用開始時に数えた金庫金', staff: '', receipt: '',
      status: '', depositDate: '', memo: '',
    }]);
  }

  // 2. フォーム
  const form = createCashForm_();
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
  props.setProperty('FORM_ID', form.getId());

  // 3. トリガー(二重登録を防ぐため、同じ関数の既存トリガーは消してから作る)
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['onCashFormSubmit', 'sendWeeklyReport'].indexOf(t.getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger('onCashFormSubmit').forSpreadsheet(ss).onFormSubmit().create();
  ScriptApp.newTrigger('sendWeeklyReport').timeBased()
    .onWeekDay(ScriptApp.WeekDay[CASH_CONFIG.WEEKLY_REPORT_DAY])
    .atHour(CASH_CONFIG.WEEKLY_REPORT_HOUR).create();

  refreshAll();
  ui.alert('初期設定が完了しました。\n\nフォームの回答用URL:\n' + form.getPublishedUrl() +
    '\n\n今金庫にある売上封筒は、受け取った日を入れてフォームから1件ずつ登録してください。');
}

/** 出し入れ登録用フォームを作る。「登録の種類」で答えたセクションだけが表示される */
function createCashForm_() {
  const Q = CASH_CONFIG.Q;
  const K = CASH_CONFIG.KINDS;
  const form = FormApp.create(CASH_CONFIG.FORM_TITLE);
  form.setDescription('金庫のお金を出し入れしたら、その場でスマホから登録してください。' +
    '紙への記入は不要です。')
    .setCollectEmail(false)
    .setAllowResponseEdits(false)
    .setConfirmationMessage('登録しました。残高は自動で計算されます。');

  const amountValidation = FormApp.createTextValidation()
    .setHelpText('数字だけで入力してください(例: 1320)')
    .requireWholeNumber()
    .build();

  // 共通
  const kindItem = form.addMultipleChoiceItem().setTitle(Q.KIND).setRequired(true);
  if (CASH_CONFIG.STAFF_NAMES.length) {
    form.addListItem().setTitle(Q.STAFF).setChoiceValues(CASH_CONFIG.STAFF_NAMES).setRequired(true);
  } else {
    form.addTextItem().setTitle(Q.STAFF).setRequired(true);
  }

  // 支払い
  const payPage = form.addPageBreakItem().setTitle('支払い');
  form.addDateItem().setTitle(Q.PAY_DATE).setRequired(true);
  form.addTextItem().setTitle(Q.PAY_AMOUNT).setValidation(amountValidation).setRequired(true);
  form.addTextItem().setTitle(Q.PAY_DESC).setHelpText('例: 業務スーパー 食材 / 駐車場代').setRequired(true);
  form.addMultipleChoiceItem().setTitle(Q.PAY_RECEIPT)
    .setChoiceValues(['あり(レシート置き場に保管した)', 'なし(理由を支払先の欄に書いた)'])
    .setRequired(true);

  // 売上金の受け取り
  const salePage = form.addPageBreakItem().setTitle('売上金の受け取り')
    .setHelpText('茶封筒に案件名・金額・受取日を書き、金庫に入れてから登録してください。');
  salePage.setGoToPage(FormApp.PageNavigationType.SUBMIT); // 支払いページの次は送信
  form.addDateItem().setTitle(Q.SALE_DATE).setRequired(true);
  form.addTextItem().setTitle(Q.SALE_AMOUNT).setValidation(amountValidation).setRequired(true);
  form.addTextItem().setTitle(Q.SALE_DESC).setRequired(true);
  form.addMultipleChoiceItem().setTitle(Q.SALE_TYPE)
    .setChoiceValues(['ケータリング', 'オードブル', 'その他']).setRequired(true);

  // 銀行入金
  const depositPage = form.addPageBreakItem().setTitle('売上封筒の銀行入金')
    .setHelpText('一覧には、まだ金庫に保管中の封筒だけが自動で表示されます。');
  depositPage.setGoToPage(FormApp.PageNavigationType.SUBMIT);
  form.addDateItem().setTitle(Q.DEPOSIT_DATE).setRequired(true);
  const envelopeItem = form.addCheckboxItem().setTitle(Q.DEPOSIT_ENVELOPES)
    .setChoiceValues([NO_ENVELOPE_CHOICE]).setRequired(true);
  form.addTextItem().setTitle(Q.DEPOSIT_AMOUNT)
    .setHelpText('銀行の控えに書かれた金額').setValidation(amountValidation).setRequired(true);
  PropertiesService.getScriptProperties().setProperty('ENVELOPE_ITEM_ID', String(envelopeItem.getId()));

  // 補充
  const refillPage = form.addPageBreakItem().setTitle('金庫金の補充')
    .setHelpText('基準額 ' + formatYen_(CASH_CONFIG.FUND_BASE) + ' に戻すように補充してください。売上封筒のお金は使わないこと。');
  refillPage.setGoToPage(FormApp.PageNavigationType.SUBMIT);
  form.addDateItem().setTitle(Q.REFILL_DATE).setRequired(true);
  form.addTextItem().setTitle(Q.REFILL_AMOUNT).setValidation(amountValidation).setRequired(true);
  form.addMultipleChoiceItem().setTitle(Q.REFILL_SOURCE)
    .setChoiceValues(['銀行口座から引き出し', 'その他(社長の立替など)']).setRequired(true);

  kindItem.setChoices([
    kindItem.createChoice(K.PAY, payPage),
    kindItem.createChoice(K.SALE, salePage),
    kindItem.createChoice(K.DEPOSIT, depositPage),
    kindItem.createChoice(K.REFILL, refillPage),
  ]);
  return form;
}
