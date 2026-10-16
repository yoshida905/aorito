/**
 * インフォマート(食材・包材の仕入れ)からの自動取得の調査用。
 * ID・パスワードはコードに書かず、スクリプトプロパティ INFOMART_ID / INFOMART_PASSWORD に登録する。
 */
const INFOMART_LOGON_URL = 'https://www.infomart.co.jp/scripts/logon.asp?CS=1';

/**
 * 調査用(1回だけ実行): ログイン画面をそのまま「delipro_probe」フォルダに保存する。パスワードは使わない。
 * 入力欄の名前、画像認証(reCAPTCHAなど)や2段階認証の有無を確認する目的で使う
 */
function probeInfomartLogonPage() {
  const res = UrlFetchApp.fetch(INFOMART_LOGON_URL, { muteHttpExceptions: true, followRedirects: true });
  const html = res.getContentText('Shift_JIS');
  const it = DriveApp.getFoldersByName(SALES_CONFIG.PROBE_FOLDER);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(SALES_CONFIG.PROBE_FOLDER);
  folder.createFile('page_infomart_logon.html', html, MimeType.HTML);
  const inputs = (html.match(/<input[^>]*>/gi) || []).map(function (t) {
    const n = t.match(/name=["']?([^"'\s>]+)/i), ty = t.match(/type=["']?([^"'\s>]+)/i);
    return (ty ? ty[1] : 'text') + ':' + (n ? n[1] : '?');
  });
  Logger.log('HTTP ' + res.getResponseCode() + ' / 入力欄: ' + inputs.join(', '));
  Logger.log('画像認証などの気配: ' + (/recaptcha|hcaptcha|turnstile|captcha/i.test(html) ? 'あり' : 'なし'));
  Logger.log('保存先: ' + folder.getUrl());
}
