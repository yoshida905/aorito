/**
 * インフォマート(食材・包材の仕入れ)からの自動取得の調査用。
 * ID・パスワードはコードに書かず、スクリプトプロパティ INFOMART_ID / INFOMART_PASSWORD に登録する。
 */
const INFOMART_LOGON_URL = 'https://www.infomart.co.jp/scripts/logon.asp?CS=1';

/** ログインしてCookieを保持したクライアントを返す(ID・パスワードはスクリプトプロパティから読む) */
function infomartLogin_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('INFOMART_ID'), pwd = props.getProperty('INFOMART_PASSWORD');
  if (!id || !pwd) throw new Error('スクリプトプロパティ INFOMART_ID / INFOMART_PASSWORD を登録してください');
  const client = { jar: {}, trace: [] };
  infomartRequest_(client, INFOMART_LOGON_URL, { method: 'get' }); // 最初のCookieを受け取る
  const res = infomartRequest_(client, 'https://www.infomart.co.jp/scripts/logon_check.asp?qsnkh=&qsne02=', {
    method: 'post',
    payload: {
      UID: id, PWD: pwd, 'Logon.x': '10', 'Logon.y': '10',
      URL: '', CS: '2', userlogin: '1', logon_flg: '1', tid: '', check: '', melnavi: '', lkbn: '', idauth: '', msgcode: '', _type: '',
    },
    headers: { Referer: INFOMART_LOGON_URL, Origin: 'https://www.infomart.co.jp' },
  });
  client.lastUrl = res.url;
  client.lastHtml = res.text;
  return client;
}

/** Cookieを引き継ぎながらリダイレクトをたどる(www と www2 などのドメインをまたぐ)。{url, code, text} を返す */
function infomartRequest_(client, url, opts) {
  let options = opts;
  for (let i = 0; i < 10; i++) {
    const res = UrlFetchApp.fetch(url, Object.assign({}, options, {
      followRedirects: false, muteHttpExceptions: true,
      headers: Object.assign({}, options.headers, { Cookie: Object.keys(client.jar).map(function (k) { return k + '=' + client.jar[k]; }).join('; ') }),
    }));
    const headers = res.getAllHeaders();
    [].concat(headers['Set-Cookie'] || headers['set-cookie'] || []).forEach(function (c) {
      const kv = String(c).split(';')[0];
      const eq = kv.indexOf('=');
      if (eq > 0) client.jar[kv.slice(0, eq).trim()] = kv.slice(eq + 1).trim();
    });
    const code = res.getResponseCode();
    client.trace.push((options.method || 'get') + ' ' + url.replace(/\?.*/, '') + ' → ' + code);
    const location = headers['Location'] || headers['location'];
    if (code >= 300 && code < 400 && location) {
      url = infomartResolve_(url, String(location));
      options = { method: 'get' };
      continue;
    }
    const type = String(headers['Content-Type'] || headers['content-type'] || '');
    const charset = /utf-8/i.test(type) ? 'UTF-8' : 'Shift_JIS';
    return { url: url, code: code, text: res.getContentText(charset) };
  }
  throw new Error('リダイレクトが多すぎます: ' + url);
}

function infomartResolve_(base, loc) {
  if (/^https?:/i.test(loc)) return loc;
  const m = base.match(/^(https?:\/\/[^/]+)(\/[^?]*)?/);
  if (loc.charAt(0) === '/') return m[1] + loc;
  return m[1] + (m[2] || '/').replace(/[^/]*$/, '') + loc;
}

/**
 * 調査用(1回だけ実行): ログインして、ログイン後の画面を「delipro_probe」フォルダに保存し、
 * 画面のリンクの一覧(仕入れの実績や請求書の画面を探すため)を実行ログに出す。データは変更しない
 */
function probeInfomartAfterLogin() {
  const lines = [];
  const log = function (msg) { Logger.log(msg); lines.push([Utilities.formatDate(new Date(), SALES_CONFIG.TIME_ZONE, 'HH:mm:ss'), String(msg).slice(0, 45000)]); };
  const client = infomartLogin_();
  const html = client.lastHtml || '';
  const it = DriveApp.getFoldersByName(SALES_CONFIG.PROBE_FOLDER);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(SALES_CONFIG.PROBE_FOLDER);
  folder.createFile('page_infomart_after_login.html', html, MimeType.HTML);
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
  log('通信の経過: ' + client.trace.join(' → '));
  log('ログイン後の画面: ' + client.lastUrl + ' / タイトル: ' + title.replace(/\s+/g, ' ').trim());
  log('ログイン画面に戻された気配: ' + (/name=["']?PWD/i.test(html) ? 'あり(ログイン失敗の可能性)' : 'なし'));
  log('本人確認(認証コードなど)の気配: ' + (/認証コード|ワンタイム|確認コード|本人確認/.test(html) ? 'あり' : 'なし'));
  // ログイン画面に戻された場合の手がかり: 隠し項目の値と、エラーらしい文
  const hidden = (html.match(/<input[^>]*type=["']?hidden[^>]*>/gi) || []).map(function (t) {
    const n = (t.match(/name=["']?([^"'\s>]+)/i) || [])[1], v = (t.match(/value=["']([^"']*)["']/i) || [])[1];
    return n + '=' + (v || '');
  });
  log('隠し項目: ' + hidden.join(', '));
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, '\n');
  const msgs = text.split('\n').map(function (x) { return x.trim(); })
    .filter(function (x) { return x && /エラー|誤り|正しく|一致|ロック|失敗|無効|入力してください|できません/.test(x); });
  log('エラーらしい文: ' + (msgs.slice(0, 10).join(' / ') || 'なし'));
  const links = [];
  const re = /<a[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null && links.length < 80) {
    const text = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (text) links.push(text + ' → ' + m[1].replace(/&amp;/g, '&'));
  }
  log('リンク(' + links.length + '件):\n' + links.join('\n'));
  log('保存先: ' + folder.getUrl());
  // 実行ログは上の行が隠れて読みにくいため、集計用スプレッドシートの「インフォマート調査」シートにも書く
  const ss = openSalesSpreadsheet_();
  const sh = ss.getSheetByName('インフォマート調査') || ss.insertSheet('インフォマート調査');
  sh.clear();
  sh.getRange(1, 1, lines.length, 2).setValues(lines);
}

/**
 * 調査用(1回だけ実行): ログイン画面が読み込んでいる処理のファイル(ログインボタンを押したときの checkNewLogonForm など)を
 * 集計用スプレッドシートの「インフォマート調査」シートに書き出す。パスワードは使わず、ログインもしない
 */
function probeInfomartScripts() {
  const files = ['/include/logon.js?4', '/web/jp/js/logon-idcheck.js?4', '/web/jp/js/controls_common.js?4'];
  const rows = [];
  files.forEach(function (path) {
    const res = UrlFetchApp.fetch('https://www.infomart.co.jp' + path, { muteHttpExceptions: true });
    const type = String(res.getHeaders()['Content-Type'] || '');
    const text = res.getContentText(/utf-8/i.test(type) ? 'UTF-8' : 'Shift_JIS');
    rows.push([path, 'HTTP ' + res.getResponseCode() + ' / ' + text.length + '文字']);
    for (let i = 0; i < text.length; i += 40000) rows.push([path + ' #' + (i / 40000 + 1), "'" + text.slice(i, i + 40000)]);
  });
  const ss = openSalesSpreadsheet_();
  const sh = ss.getSheetByName('インフォマート調査') || ss.insertSheet('インフォマート調査');
  sh.clear();
  sh.getRange(1, 1, rows.length, 2).setValues(rows);
  Logger.log('「インフォマート調査」シートに書き出しました: ' + rows.length + '行');
}
