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
          ' の補充が必要です(次の入金の日に売上封筒から振替)。');
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
          '封筒の合計 ' + formatYen_(result.salesTotal) + '(' + result.envelopes.length + '件) - 金庫金へ移した額 ' +
          formatYen_(result.coins) + ' = ' + formatYen_(result.bookTotal) + ' / 入金額 ' +
          formatYen_(amount) + ' / 差額 ' + formatYen_(result.diff) + '\n' +
          '売上封筒から金庫金へお金を移した場合は、「' + cfg.KINDS.COIN + '」を登録してください(入金より前に登録されていないと差し引かれません)。');
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
