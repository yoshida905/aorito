/**
 * デリプロ(https://asp.delipro.jp/dmanager/)へのログインとデータ取得。
 * ID・パスワードはスクリプトプロパティ DELIPRO_CONTRACT_ID / DELIPRO_STAFF_ID / DELIPRO_PASSWORD から読む。
 */
const DELIPRO_BASE = 'https://asp.delipro.jp/dmanager/';

/** ログインしてCookieを保持したクライアントを返す */
function deliproLogin_() {
  const props = PropertiesService.getScriptProperties();
  const client = { jar: {} };
  const res = deliproRequest_(client, 'login.php', {
    method: 'post',
    payload: {
      user_id: props.getProperty('DELIPRO_CONTRACT_ID') || '',
      txt_code: props.getProperty('DELIPRO_STAFF_ID') || '',
      txt_pass: props.getProperty('DELIPRO_PASSWORD') || '',
      hid_mode: 'login',
    },
  });
  if (res.getContentText('UTF-8').indexOf('logout.php') === -1) {
    throw new Error('デリプロにログインできませんでした。スクリプトプロパティのID・パスワードを確認してください');
  }
  return client;
}

/**
 * 集配管理で 配達日 from〜to の注文を検索する。
 * @param {string} status '0'=確定 / '1'=保留
 * @param {string} officeId 受付の事業所ID('0'=すべて)
 */
function deliproSearch_(client, fromYmd, toYmd, status, officeId) {
  const payload = {
    dayfield: 'oddelidate',
    datSt: fromYmd.replace(/-/g, '/'),
    datEd: toYmd.replace(/-/g, '/'),
    'odspid_s[]': '1',
    oddelistid_s: '0',
    odtype_s: '0',
    odstid_s: officeId || '0',
    odconc_s: '',
    odstatus_s: status,
    oddelitype_s: '0',
    odcpid_s: '0',
    rad_sort_s: '0',
    itname_s: '', opname_s: '', odmemo_s: '', odlocalmemo_s: '',
    csname_s: '', cstel_s: '', csadd_s: '', odcstel_s: '', txtodid: '',
    'image.x': '10', 'image.y': '10',
  };
  const html = deliproRequest_(client, 'deli.php', { method: 'post', payload: payload }).getContentText('UTF-8');
  const parsed = parseDeliList_(html);
  if (parsed.total !== null && parsed.total !== parsed.orders.length) {
    throw new Error('集配一覧の件数が合いません(表示' + parsed.total + '件・取得' + parsed.orders.length + '件)。画面の仕様変更の可能性があります');
  }
  return parsed.orders;
}

/** 指定した注文番号のキッチン指示書(注文別:メイン)PDFを取得する */
function deliproKitchenPdf_(client, odids, fileName) {
  const res = deliproRequest_(client, 'deli.php?mode=print_kitchen&is_main=true&odids=' + odids.join(','), { method: 'get' });
  const type = String(res.getHeaders()['Content-Type'] || res.getHeaders()['content-type'] || '');
  if (type.indexOf('pdf') === -1) {
    throw new Error('キッチン指示書PDFを取得できませんでした(Content-Type: ' + type + ')');
  }
  return res.getBlob().setName(fileName);
}

/** Cookieを引き継ぎながらリダイレクトをたどる */
function deliproRequest_(client, path, opts) {
  let url = /^https?:/.test(path) ? path : DELIPRO_BASE + path;
  let options = opts;
  for (let i = 0; i < 6; i++) {
    const res = UrlFetchApp.fetch(url, Object.assign({}, options, {
      followRedirects: false,
      muteHttpExceptions: true,
      headers: { Cookie: Object.keys(client.jar).map(function (k) { return k + '=' + client.jar[k]; }).join('; ') },
    }));
    const headers = res.getAllHeaders();
    [].concat(headers['Set-Cookie'] || headers['set-cookie'] || []).forEach(function (c) {
      const kv = String(c).split(';')[0];
      const eq = kv.indexOf('=');
      if (eq > 0) client.jar[kv.slice(0, eq).trim()] = kv.slice(eq + 1).trim();
    });
    const code = res.getResponseCode();
    const location = headers['Location'] || headers['location'];
    if (code >= 300 && code < 400 && location) {
      url = /^https?:/.test(location) ? location : DELIPRO_BASE + String(location).replace(/^\.?\//, '');
      options = { method: 'get' };
      continue;
    }
    if (code >= 400) throw new Error('デリプロへのアクセスに失敗しました(HTTP ' + code + '): ' + url);
    return res;
  }
  throw new Error('リダイレクトが多すぎます: ' + path);
}
