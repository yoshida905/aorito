/**
 * デリプロ画面の調査用スクリプト(1回だけ実行する)。
 * ログイン画面・ログイン後の画面・集配管理の画面のHTMLを取得し、マイドライブの
 * 「delipro_probe」フォルダにGoogleドキュメントとして保存する。
 * 保存されたHTMLから、自動ダウンロードに必要なフォームの項目名やURLを確認する。
 *
 * 事前準備: 「プロジェクトの設定」→「スクリプト プロパティ」に次の3つを登録する(コードには書かない)
 *   DELIPRO_CONTRACT_ID / DELIPRO_STAFF_ID / DELIPRO_PASSWORD
 */
const PROBE_BASE = 'https://asp.delipro.jp/dmanager/';

function probeDelipro() {
  const props = PropertiesService.getScriptProperties();
  const creds = [props.getProperty('DELIPRO_CONTRACT_ID'), props.getProperty('DELIPRO_STAFF_ID')];
  const password = props.getProperty('DELIPRO_PASSWORD');
  if (!creds[0] || !creds[1] || !password) throw new Error('スクリプトプロパティにID・パスワードが未登録です');

  const folder = getProbeFolder_();
  const jar = {};

  // 1. ログイン画面
  const loginPage = probeFetch_(PROBE_BASE + 'login.php', { method: 'get' }, jar);
  saveProbe_(folder, '1_login', loginPage);

  // 2. パスワード欄を含むフォームを探し、テキスト欄に上から順に 契約書ID・スタッフID を入れて送信
  const form = findLoginForm_(loginPage.body);
  if (!form) throw new Error('ログインフォームが見つかりません。1_login を確認してください');
  const payload = {};
  let textIndex = 0;
  form.inputs.forEach(function (inp) {
    if (!inp.name) return;
    if (inp.type === 'password') payload[inp.name] = password;
    else if (inp.type === 'text' || inp.type === 'tel' || inp.type === 'number' || inp.type === '') payload[inp.name] = creds[textIndex++] || '';
    else if (inp.type === 'hidden' || inp.type === 'submit') payload[inp.name] = inp.value;
  });
  const action = form.action ? resolveUrl_(form.action) : PROBE_BASE + 'login.php';
  const afterLogin = probeFetch_(action, { method: 'post', payload: payload }, jar);
  saveProbe_(folder, '2_after_login', afterLogin, '送信した項目名: ' + Object.keys(payload).join(', '));

  // 3. ログイン後の画面にあるリンクから「集配」を含むページを開く
  const links = extractLinks_(afterLogin.body);
  const target = links.filter(function (l) { return /集配|haisou|delivery|shuhai/i.test(l.text + ' ' + l.href); })[0];
  if (target) {
    const listPage = probeFetch_(resolveUrl_(target.href), { method: 'get' }, jar);
    saveProbe_(folder, '3_shuhai', listPage, 'リンク: ' + target.text + ' ' + target.href);
  }
  saveProbe_(folder, '4_links', { status: 0, url: '', body: links.map(function (l) { return l.text + '\t' + l.href; }).join('\n') });
  Logger.log('保存先: ' + folder.getUrl());
}

/** Cookieを引き継ぎながらリダイレクトを手動でたどる */
function probeFetch_(url, opts, jar) {
  let current = url;
  let options = opts;
  for (let i = 0; i < 6; i++) {
    const res = UrlFetchApp.fetch(current, Object.assign({}, options, {
      followRedirects: false,
      muteHttpExceptions: true,
      headers: { Cookie: Object.keys(jar).map(function (k) { return k + '=' + jar[k]; }).join('; ') },
    }));
    const headers = res.getAllHeaders();
    [].concat(headers['Set-Cookie'] || headers['set-cookie'] || []).forEach(function (c) {
      const kv = String(c).split(';')[0];
      const eq = kv.indexOf('=');
      if (eq > 0) jar[kv.slice(0, eq).trim()] = kv.slice(eq + 1).trim();
    });
    const code = res.getResponseCode();
    const location = headers['Location'] || headers['location'];
    if (code >= 300 && code < 400 && location) {
      current = resolveUrl_(location);
      options = { method: 'get' };
      continue;
    }
    return { status: code, url: current, body: res.getContentText('UTF-8') };
  }
  throw new Error('リダイレクトが多すぎます: ' + url);
}

function findLoginForm_(html) {
  const forms = html.match(/<form[\s\S]*?<\/form>/gi) || [];
  for (let i = 0; i < forms.length; i++) {
    if (!/type\s*=\s*["']?password/i.test(forms[i])) continue;
    const action = (forms[i].match(/<form[^>]*action\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
    const inputs = (forms[i].match(/<input[^>]*>/gi) || []).map(function (tag) {
      const attr = function (n) {
        const m = tag.match(new RegExp(n + '\\s*=\\s*["\']([^"\']*)["\']', 'i'));
        return m ? m[1] : '';
      };
      return { name: attr('name'), type: attr('type').toLowerCase(), value: attr('value') };
    });
    return { action: action, inputs: inputs };
  }
  return null;
}

function extractLinks_(html) {
  const out = [];
  const re = /<a[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    out.push({ href: m[1], text: m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() });
  }
  return out;
}

function resolveUrl_(href) {
  if (/^https?:\/\//i.test(href)) return href;
  if (href.charAt(0) === '/') return 'https://asp.delipro.jp' + href;
  return PROBE_BASE + href.replace(/^\.\//, '');
}

function getProbeFolder_() {
  const it = DriveApp.getFoldersByName('delipro_probe');
  return it.hasNext() ? it.next() : DriveApp.createFolder('delipro_probe');
}

function saveProbe_(folder, name, res, note) {
  const doc = DocumentApp.create('delipro_' + name);
  doc.getBody().setText('STATUS: ' + res.status + '\nURL: ' + res.url + '\n' + (note || '') + '\n\n' + res.body);
  doc.saveAndClose();
  DriveApp.getFileById(doc.getId()).moveTo(folder);
}
