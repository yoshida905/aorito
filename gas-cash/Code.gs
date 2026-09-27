/**
 * 金庫の現金管理 フォーム送信時・週次の自動処理。
 *
 * セットアップは Setup.gs の setupCashManagement を1回だけ実行する。
 */

/** スプレッドシートを開いたときにメニューを追加する */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('金庫')
    .addItem('残高を再計算', 'refreshAll')
    .addItem('週次メールを今すぐ送る', 'sendWeeklyReport')
    .addSeparator()
    .addItem('初期設定(最初に1回だけ)', 'setupCashManagement')
    .addToUi();
}

/**
 * フォーム送信をトリガーに実行されるメイン処理。
 * @param {GoogleAppsScript.Events.SheetsOnFormSubmit} e
 */
function onCashFormSubmit(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const answers = readAnswers_(e);
    const ledger = readLedger_();
    const result = buildEntries_(answers, ledger, new Date());

    appendLedgerRows_(result.rows);
    settleEnvelopes_(result.settleIds, answers[CASH_CONFIG.Q.DEPOSIT_DATE]);

    const summary = refreshAll();
    notifyIfNeeded_(answers, result.warnings, summary);
  } catch (err) {
    Logger.log('onCashFormSubmit failed: ' + err);
    notify_('【エラー】金庫の現金管理 自動処理', String(err && err.stack || err));
  } finally {
    lock.releaseLock();
  }
}

/** 残高シートとフォームの封筒一覧を最新にする。台帳を手で直したときもメニューから実行する */
function refreshAll() {
  const summary = computeSummary_(readLedger_(), new Date());
  writeBalanceSheet_(summary);
  refreshEnvelopeChoices_(summary);
  return summary;
}

/** 週1回、金庫を数える前に「あるはずの金額」をメールで知らせる */
function sendWeeklyReport() {
  const summary = refreshAll();
  const lines = ['金庫確認の日です。下の金額を金庫確認表の「帳簿の金額」欄に書き写してから、2人で数えてください。', '']
    .concat(summaryLines_(summary));
  if (summary.refill > 0) {
    lines.push('', '銀行へ行くときに ' + formatYen_(summary.refill) +
      ' を引き出し、金庫金を基準額に戻してください(補充したらフォームで登録)。');
  }
  if (summary.oldEnvelopes.length) {
    lines.push('', '受け取りから' + CASH_CONFIG.ENVELOPE_ALERT_DAYS + '日を超えた売上封筒が ' +
      summary.oldEnvelopes.length + '件あります。次に銀行へ行くときに必ず入金してください。');
  }
  lines.push('', 'スプレッドシート: ' + SpreadsheetApp.getActiveSpreadsheet().getUrl());
  notify_('【金庫確認】今あるはずの金額 ' + formatYen_(summary.expectedTotal), lines.join('\n'));
}

/** namedValues を「質問タイトル → 回答文字列」に変換する(チェックボックスは連結される) */
function readAnswers_(e) {
  const named = (e && e.namedValues) || {};
  const answers = {};
  Object.keys(named).forEach(function (title) {
    const v = named[title];
    answers[title] = (Array.isArray(v) ? v.join(', ') : String(v || '')).trim();
  });
  return answers;
}

function ledgerSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CASH_CONFIG.SHEETS.LEDGER);
  if (!sheet) throw new Error('「' + CASH_CONFIG.SHEETS.LEDGER + '」シートがありません。初期設定を実行してください');
  return sheet;
}

/** 入出金台帳をオブジェクト配列で読む(列はヘッダー名で探すので、列の並べ替えに強い) */
function readLedger_() {
  const values = ledgerSheet_().getDataRange().getValues();
  if (values.length < 2) return [];
  const header = values[0];
  const idx = LEDGER_HEADERS.map(function (h) { return header.indexOf(h); });
  return values.slice(1).map(function (row) {
    const obj = {};
    LEDGER_KEYS.forEach(function (key, i) { obj[key] = idx[i] === -1 ? '' : row[idx[i]]; });
    if (!(obj.date instanceof Date)) obj.date = parseDate_(obj.date, new Date());
    return obj;
  }).filter(function (r) { return r.type; });
}

function appendLedgerRows_(rows) {
  if (!rows.length) return;
  const sheet = ledgerSheet_();
  const values = rows.map(function (r) {
    return LEDGER_KEYS.map(function (key) { return r[key] === undefined ? '' : r[key]; });
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, values.length, LEDGER_HEADERS.length).setValues(values);
}

/** 銀行に入金した封筒の状態を「銀行入金済」にする */
function settleEnvelopes_(ids, depositDateText) {
  if (!ids.length) return;
  const sheet = ledgerSheet_();
  const values = sheet.getDataRange().getValues();
  const header = values[0];
  const idCol = header.indexOf('記録ID');
  const statusCol = header.indexOf('封筒の状態');
  const dateCol = header.indexOf('銀行入金日');
  const depositDate = parseDate_(depositDateText, new Date());
  for (let i = 1; i < values.length; i++) {
    if (ids.indexOf(String(values[i][idCol])) === -1) continue;
    sheet.getRange(i + 1, statusCol + 1).setValue(ENVELOPE_STATUS.DEPOSITED);
    sheet.getRange(i + 1, dateCol + 1).setValue(depositDate);
  }
}

function writeBalanceSheet_(summary) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CASH_CONFIG.SHEETS.BALANCE);
  if (!sheet) sheet = ss.insertSheet(CASH_CONFIG.SHEETS.BALANCE, 0);
  sheet.clear();
  const lines = ['金庫の残高(自動更新)', '更新日時: ' +
    Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm'), '']
    .concat(summaryLines_(summary));
  sheet.getRange(1, 1, lines.length, 1).setValues(lines.map(function (l) { return [l]; }));
  sheet.getRange(1, 1).setFontSize(14).setFontWeight('bold');
  sheet.getRange(4, 1).setFontSize(13).setFontWeight('bold');
  sheet.setColumnWidth(1, 640);
}

/** フォームの「入金した売上封筒」の選択肢を、保管中の封筒だけにする */
function refreshEnvelopeChoices_(summary) {
  const props = PropertiesService.getScriptProperties();
  const formId = props.getProperty('FORM_ID');
  const itemId = props.getProperty('ENVELOPE_ITEM_ID');
  if (!formId || !itemId) return;
  const item = FormApp.openById(formId).getItemById(Number(itemId)).asCheckboxItem();
  const labels = summary.envelopes.map(function (e) {
    return envelopeLabel_({ id: e.id, date: e.date, desc: e.desc, amountIn: e.amount });
  });
  item.setChoiceValues(labels.length ? labels : [NO_ENVELOPE_CHOICE]);
}

function notifyIfNeeded_(answers, warnings, summary) {
  const msgs = warnings.slice();
  if (summary.fundLow) {
    msgs.push('金庫金の残高が ' + formatYen_(summary.fund) + ' になりました。' +
      formatYen_(summary.refill) + ' の補充が必要です。');
  }
  if (!msgs.length) return;
  const body = msgs.concat(['', '登録内容:'])
    .concat(Object.keys(answers).filter(function (k) { return answers[k]; })
      .map(function (k) { return '・' + k + ': ' + answers[k]; }))
    .concat(['', 'スプレッドシート: ' + SpreadsheetApp.getActiveSpreadsheet().getUrl()]);
  notify_('【金庫】確認が必要な登録があります', body.join('\n'));
}

function notify_(subject, body) {
  const to = CASH_CONFIG.NOTIFY_EMAILS;
  if (!to) return;
  MailApp.sendEmail(to, subject, body);
}
