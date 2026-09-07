/**
 * ケータリング現場アンケート フォーム送信時の自動処理。
 *
 * セットアップ:
 * 1. このスクリプトを、フォームの回答が溜まるスプレッドシートに紐づくApps Scriptプロジェクトとして配置する
 * 2. Config.gs の PROJECT_SHEET.SPREADSHEET_ID などを実環境に合わせて設定する
 * 3. Apps Scriptエディタの「トリガー」で onFormSubmit / イベントの種類「フォーム送信時」を追加する
 */

/**
 * フォーム送信をトリガーに実行されるメイン処理。
 * @param {GoogleAppsScript.Events.SheetsOnFormSubmit} e
 */
function onFormSubmit(e) {
  try {
    const row = readFormResponse_(e);
    const urgent = isClaimFlagged_(row);

    const matched = writeToProjectSheet_(row, urgent);
    if (!matched) {
      logUnmatched_(row);
    }

    if (urgent) {
      notifyUrgent_(row);
    }
  } catch (err) {
    Logger.log('onFormSubmit failed: ' + err);
    notifyError_(err);
  }
}

/**
 * フォーム回答イベントから、設定済みの質問キーで値を取り出す。
 */
function readFormResponse_(e) {
  const named = (e && e.namedValues) || {};
  const row = {};
  Object.keys(CONFIG.FORM_COLUMNS).forEach(function (key) {
    const questionTitle = CONFIG.FORM_COLUMNS[key];
    const values = named[questionTitle];
    row[key] = values && values.length ? String(values[0]).trim() : '';
  });
  return row;
}

function isClaimFlagged_(row) {
  return row.CLAIM_FLAG === CONFIG.CLAIM_FLAG_VALUE;
}

/**
 * 案件管理スプレッドシートを案件名で検索し、アンケート結果を反映する。
 * @return {boolean} 案件が見つかって書き込めた場合はtrue
 */
function writeToProjectSheet_(row, urgent) {
  const cfg = CONFIG.PROJECT_SHEET;
  if (!cfg.SPREADSHEET_ID) {
    throw new Error('Config.gs の PROJECT_SHEET.SPREADSHEET_ID が未設定です');
  }

  const ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(cfg.SHEET_NAME);
  if (!sheet) {
    throw new Error('案件管理シートが見つかりません: ' + cfg.SHEET_NAME);
  }

  const lastCol = sheet.getLastColumn();
  const headerRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const nameColIndex = headerRow.indexOf(cfg.COLUMNS.PROJECT_NAME);
  if (nameColIndex === -1) {
    throw new Error('案件管理シートに「' + cfg.COLUMNS.PROJECT_NAME + '」列が見つかりません');
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return false;
  }

  const names = sheet.getRange(2, nameColIndex + 1, lastRow - 1, 1).getValues();
  let targetRow = -1;
  for (let i = 0; i < names.length; i++) {
    if (String(names[i][0] || '').trim() === row.PROJECT_NAME) {
      targetRow = i + 2;
      break;
    }
  }

  if (targetRow === -1) {
    return false;
  }

  writeCellByHeader_(sheet, headerRow, targetRow, cfg.COLUMNS.SURVEY_STATUS, '回収済み');
  writeCellByHeader_(sheet, headerRow, targetRow, cfg.COLUMNS.SURVEY_SUMMARY, buildSummary_(row));
  writeCellByHeader_(sheet, headerRow, targetRow, cfg.COLUMNS.SURVEY_URGENT, urgent ? '要対応' : '');

  return true;
}

/**
 * ヘッダー名で列を探して1セルだけ書き込む。列が存在しなければ何もしない
 * (案件管理シートに列を後から追加すれば、次回実行時から自動的に使われる)。
 */
function writeCellByHeader_(sheet, headerRow, targetRow, headerName, value) {
  if (!headerName) return;
  const colIndex = headerRow.indexOf(headerName);
  if (colIndex === -1) return;
  sheet.getRange(targetRow, colIndex + 1).setValue(value);
}

function buildSummary_(row) {
  const parts = [];
  if (row.GOOD_POINTS) parts.push('良かった点: ' + row.GOOD_POINTS);
  if (row.IMPROVEMENTS) parts.push('改善点: ' + row.IMPROVEMENTS);
  if (row.TROUBLE) parts.push('トラブル: ' + row.TROUBLE);
  if (row.SUPPLY_BALANCE && row.SUPPLY_BALANCE !== '適正') {
    const detail = row.SUPPLY_DETAIL ? '(' + row.SUPPLY_DETAIL + ')' : '';
    parts.push('備品/食材: ' + row.SUPPLY_BALANCE + detail);
  }
  if (row.EXTRA_ORDER === 'あり') {
    parts.push('追加対応: ' + (row.EXTRA_ORDER_DETAIL || '(詳細未記入)'));
  }
  return parts.join(' / ');
}

/**
 * 案件管理シートに一致する案件名がなかった回答を、フォーム回答スプレッドシート側にログ記録する。
 */
function logUnmatched_(row) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.UNMATCHED_LOG_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.UNMATCHED_LOG_SHEET_NAME);
    sheet.appendRow(['記録日時', '案件名', '回答者', '備考']);
  }
  sheet.appendRow([
    new Date(),
    row.PROJECT_NAME,
    row.RESPONDENT,
    '案件管理シートに一致する案件名が見つかりませんでした',
  ]);
}

function notifyUrgent_(row) {
  const to = CONFIG.NOTIFY_EMAILS;
  if (!to) return;
  const subject = '【要対応】ケータリング現場アンケート: ' + row.PROJECT_NAME;
  const body = [
    '案件名: ' + row.PROJECT_NAME,
    '実施日: ' + row.EVENT_DATE,
    '回答者: ' + row.RESPONDENT,
    '',
    'クレーム・要対応事項の内容:',
    row.CLAIM_DETAIL || '(詳細未記入)',
  ].join('\n');
  MailApp.sendEmail(to, subject, body);
}

function notifyError_(err) {
  const to = CONFIG.NOTIFY_EMAILS;
  if (!to) return;
  MailApp.sendEmail(to, '【エラー】ケータリングアンケート自動処理', String(err));
}
