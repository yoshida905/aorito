// デリプロ注文一覧・キッチン指示書メール(gas/kitchen-digest の全ファイルを1つにまとめたもの)
// このファイルの中身を Apps Script のコード.gs に丸ごと貼り付けてください

// ===== Config.gs =====
/**
 * キッチン指示書メールの設定。実環境に合わせてここだけ書き換えれば動作します。
 * デリプロのID・パスワードはここではなく、スクリプトプロパティに登録します(docs/kitchen-digest.md)。
 */
const KITCHEN_CONFIG = {
  // 集配管理の「受付」で絞り込む事業所ID。'0'=すべて / '8'=東京 / '9'=大阪 / '24'=東海 / '22'=福岡・山口 / '23'=愛媛
  OFFICE_ID: '9',

  // 一覧に載せる期間: 今日から何日先まで
  DAYS_AHEAD: 7,
  // 大型案件だけはさらに先まで拾う(発注の前倒し用)。0にすると無効
  LARGE_LOOKAHEAD_DAYS: 21,
  // 大型案件の判定: この人数以上
  LARGE_HEADCOUNT: 50,

  // 保留でも色分けしない(保留件数にも数えない)お客様。名前の一部で判定
  // 南海は3日前に数量が確定する運用のため、保留が通常状態
  NO_PENDING_HIGHLIGHT_CLIENTS: ['南海電気鉄道'],

  // 送信先はコードに書かず、スクリプトプロパティ MAIL_TO にカンマ区切りで登録する
  // (GitHubが公開設定のため、社員のメールアドレスを載せない)。未登録なら ADMIN_EMAIL にだけ送る
  // エラー通知とテスト送信の宛先
  ADMIN_EMAIL: 'yoshida@lit-house.jp',
  // 毎日の送信時刻(時)。GASの仕様上、この時刻から1時間以内のどこかで実行されます
  TRIGGER_HOUR: 7,

  // PDF読み取りの小分け: 1回に読む注文数と、読み取りの間隔(ミリ秒)
  OCR_CHUNK_SIZE: 10,
  OCR_INTERVAL_MS: 3000,

  TIME_ZONE: 'Asia/Tokyo',
};

// ===== KitchenParser.gs =====
/**
 * デリプロ「キッチン指示書(注文別:メイン)」PDFのテキストを注文ごとに分解する純粋関数群。
 * GASのサービスに依存しないので、Node.jsでもテストできる(tests/kitchen-parser.test.js)。
 */

/**
 * @param {string} rawText PDFから取り出したテキスト
 * @param {string} todayYmd 'YYYY-MM-DD'。PDFに年の記載がないため、年の補完に使う
 * @return {Object[]} 注文の配列(お届け日時順)
 */
function parseKitchenText_(rawText, todayYmd) {
  const t = String(rawText || '').replace(/\s+/g, ' ').trim();
  const headRe = /注文番号\s*No\.\s*(\d+)\s+(\d{1,2})\/(\d{1,2})\s*[（(](.)[）)]\s*(?:(\d{1,2}:\d{2})\s*)?お届け/g;
  const heads = [];
  let m;
  while ((m = headRe.exec(t)) !== null) {
    heads.push({ index: m.index, end: headRe.lastIndex, m: m });
  }

  return heads.map(function (h, i) {
    const bodyEnd = i + 1 < heads.length ? heads[i + 1].index : t.length;
    const body = t.slice(h.end, bodyEnd).replace(/\s*Powered by TCPDF.*$/, '').trim();
    return buildKitchenOrder_(h.m, body, todayYmd);
  });
}

function buildKitchenOrder_(m, body, todayYmd) {
  const order = {
    number: m[1],
    date: inferYear_(Number(m[2]), Number(m[3]), todayYmd),
    weekday: m[4],
    time: m[5] || '',
    client: '',
    place: '',
    plans: [],
    headcount: null,
    details: '',
  };

  // 先頭の「1/1」(ページ番号)を外し、「【プラン × 数量】」の手前までを宛名・住所とみなす
  // ページ番号「1/1」は読み取り方によって先頭以外にも出るため、どこにあっても外す
  const text = body.replace(/(^|\s)\d+\/\d+(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim();
  const firstPlan = text.indexOf('【');
  const header = firstPlan === -1 ? text : text.slice(0, firstPlan);

  const plansAndItems = firstPlan === -1 ? '' : text.slice(firstPlan);
  const planRe = /【(.+?)\s*[×x]\s*(\d+)】/g;
  let pm;
  let lastPlanEnd = 0;
  while ((pm = planRe.exec(plansAndItems)) !== null) {
    order.plans.push({ name: pm[1].trim(), qty: Number(pm[2]) });
    lastPlanEnd = planRe.lastIndex;
  }

  // 宛名と住所の区切りは「様」か「御中」。南海などプラン欄がない注文は、明細が宛名行に続くため
  // 住所の後ろの明細は別途 details として扱う
  const hm = header.match(/^(.+?(?:様|御中))\s*(.*)$/);
  if (hm) {
    order.client = hm[1].replace(/\s*(?:様|御中)$/, '').trim();
    order.place = hm[2].trim();
  } else {
    order.place = header.trim();
  }
  order.details = firstPlan === -1 ? '' : plansAndItems.slice(lastPlanEnd).trim();
  if (firstPlan === -1) {
    // プラン欄なし: 住所の後ろに「商品名 数量」が続く。数字で始まる番地と区別できないため、
    // 住所は宛名直後の最初の空白区切りまでとし、残りを明細とする
    const parts = order.place.split(' ');
    order.place = parts.shift() || '';
    order.details = parts.join(' ');
  }

  order.headcount = estimateKitchenHeadcount_(order.plans, order.details);
  return order;
}

/**
 * 人数の推定。次の最大値を採用する。
 * - プラン欄(【プラン × 数量】)の数量。諸経費・単品・ドリンク単品・LIVE・ケーキなど人数と関係ない行は除外
 * - 料理明細の数量(複数プランを足した人数分の料理があるため。例: (C)×20 + (H)×16 → 料理36)
 * - 「(20人前) 1」のような大皿は 人前×数量
 */
function estimateKitchenHeadcount_(plans, details) {
  const excluded = /^\(雑\)|（雑）|諸経費|\(単品\)|（単品）|追加メニュー|ドリンクセット|\d(?:\.\d)?L$|LIVE|ケーキ/;
  let max = null;
  const take = function (n) {
    if (n > 0 && (max === null || n > max)) max = n;
  };
  (plans || []).forEach(function (p) {
    if (!excluded.test(p.name)) take(p.qty);
  });

  const text = String(details || '');
  const servingRe = /[（(](\d+)人前[）)]\s+(\d+)/g;
  let sm;
  while ((sm = servingRe.exec(text)) !== null) take(Number(sm[1]) * Number(sm[2]));

  // 「ランチ7」のように商品名と数量がくっついて読み取られる場合もあるため、空白の直前の数字を数量とみなす
  const numRe = /(?:^|[^\d.,\/×x])(\d{1,4})(?=\s|$)/g;
  let nm;
  while ((nm = numRe.exec(text)) !== null) take(Number(nm[1]));
  return max;
}

/** 月日だけの日付に年を補う。今日から見て半年以上前なら翌年とみなす(12月に1月分を出す場合) */
function inferYear_(month, day, todayYmd) {
  const p = todayYmd.split('-').map(Number);
  let year = p[0];
  if (month < p[1] - 6) year++;
  return year + '-' + ('0' + month).slice(-2) + '-' + ('0' + day).slice(-2);
}

// ===== DeliListParser.gs =====
/**
 * デリプロ「集配管理(deli.php)」の検索結果HTMLを解析する純粋関数群。
 * Node.jsでもテストできる(tests/kitchen-parser.test.js)。
 */

/**
 * @return {{total:number|null, orders:{odid:string, status:string, date:string, time:string, office:string}[]}}
 */
function parseDeliList_(html) {
  const s = String(html || '');
  const totalMatch = s.match(/全\s*(\d+)\s*件/);
  const orders = [];
  const re = /<tr[^>]*class="tr_order[^"]*"[^>]*data-odid="(\d+)"/g;
  const starts = [];
  let m;
  while ((m = re.exec(s)) !== null) starts.push({ index: m.index, odid: m[1] });

  starts.forEach(function (st, i) {
    const block = s.slice(st.index, i + 1 < starts.length ? starts[i + 1].index : s.length);
    const dateM = block.match(/(\d{4}-\d{2}-\d{2})(?:\s*<br\s*\/?>\s*<span[^>]*>\s*(\d{1,2}:\d{2}))?/);
    // 1つ目の「alignCenter」で中身のあるセルが受付(事業所)
    const cells = [];
    const cellRe = /<td[^>]*class="alignCenter"[^>]*>([^<]*)<\/td>/g;
    let cm;
    while ((cm = cellRe.exec(block)) !== null) {
      const text = cm[1].replace(/\s+/g, ' ').trim();
      if (text) cells.push(text);
    }
    orders.push({
      odid: st.odid,
      status: /font-weight:\s*bold"?>\s*保留\s*</.test(block) ? '保留' : '確定',
      date: dateM ? dateM[1] : '',
      time: dateM && dateM[2] ? dateM[2] : '',
      office: cells[0] || '',
    });
  });
  return { total: totalMatch ? Number(totalMatch[1]) : null, orders: orders };
}

// ===== DeliproClient.gs =====
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
  return res.getBlob().setContentType(MimeType.PDF).setName(fileName);
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

// ===== Code.gs =====
/**
 * キッチン指示書メール: デリプロの「キッチン指示書(注文別:メイン)」PDFを読み取り、
 * 今日から7日先までの注文を日別・大型案件別に整理して、PDFを添付してメール送信する。
 *
 * デリプロに自動ログインし、集配管理で確定・保留の注文を検索してキッチン指示書PDFを取得する。
 * 50名以上の大型案件は LARGE_LOOKAHEAD_DAYS 日先まで先取りしてメール冒頭にまとめる。
 * セットアップ手順は docs/kitchen-digest.md を参照。
 */

/** 毎朝トリガーで実行されるメイン処理 */
function sendKitchenDigest() {
  const to = PropertiesService.getScriptProperties().getProperty('MAIL_TO');
  runKitchenDigest_(to || KITCHEN_CONFIG.ADMIN_EMAIL);
}

/** 動作確認用: 管理者宛てにだけ送る */
function testKitchenDigestToAdmin() {
  runKitchenDigest_(KITCHEN_CONFIG.ADMIN_EMAIL);
}

/** 毎朝の時間トリガーを作り直す(1回だけ手動実行する) */
function setupKitchenTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendKitchenDigest') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendKitchenDigest')
    .timeBased()
    .everyDays(1)
    .atHour(KITCHEN_CONFIG.TRIGGER_HOUR)
    .inTimezone(KITCHEN_CONFIG.TIME_ZONE)
    .create();
}

function runKitchenDigest_(mailTo) {
  const cfg = KITCHEN_CONFIG;
  try {
    const today = Utilities.formatDate(new Date(), cfg.TIME_ZONE, 'yyyy-MM-dd');
    const end = kAddDays_(today, cfg.DAYS_AHEAD);
    const scanEnd = kAddDays_(today, Math.max(cfg.DAYS_AHEAD, cfg.LARGE_LOOKAHEAD_DAYS || 0));
    const stamp = Utilities.formatDate(new Date(), cfg.TIME_ZONE, 'yyMMddHHmm');

    // 1. 確定・保留の注文を検索(取消・練習は除く)
    const client = deliproLogin_();
    const listed = deliproSearch_(client, today, scanEnd, '0', cfg.OFFICE_ID)
      .concat(deliproSearch_(client, today, scanEnd, '1', cfg.OFFICE_ID));
    const byId = {};
    listed.forEach(function (o) { byId[o.odid] = o; });
    const ids = Object.keys(byId);

    // 2. キッチン指示書PDFを読み取り、注文状態を付け合わせる
    // GoogleのPDF読み取り(OCR)は1回に読めるページ数と頻度に上限があるため、
    // 注文を小分けにしてPDFを取得し、間隔を空けて読み取る(キッチン指示書は1注文=1ページ)
    let orders = [];
    for (let i = 0; i < ids.length; i += cfg.OCR_CHUNK_SIZE) {
      if (i > 0) Utilities.sleep(cfg.OCR_INTERVAL_MS);
      const chunk = ids.slice(i, i + cfg.OCR_CHUNK_SIZE);
      const pdf = deliproKitchenPdf_(client, chunk, 'kitchen_scan_' + stamp + '_' + i + '.pdf');
      orders = orders.concat(parseKitchenText_(extractKitchenPdfTextWithRetry_(pdf), today));
    }
    const seen = {};
    orders.forEach(function (o) {
      const l = byId[o.number] || {};
      o.status = l.status || '確定';
      o.office = l.office || '';
      seen[o.number] = true;
    });
    // キッチン指示書に載らない注文も一覧からは落とさない
    ids.filter(function (id) { return !seen[id]; }).forEach(function (id) {
      const l = byId[id];
      orders.push({ number: id, date: l.date, time: l.time, client: '(キッチン指示書に記載なし)', place: '',
        plans: [], details: '', headcount: null, status: l.status, office: l.office });
    });
    orders.forEach(function (o) {
      o.isLarge = o.headcount !== null && o.headcount >= cfg.LARGE_HEADCOUNT;
    });
    orders.sort(function (a, b) {
      const ka = a.date + ' ' + (a.time || '99:99');
      const kb = b.date + ' ' + (b.time || '99:99');
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });

    const main = orders.filter(function (o) { return o.date >= today && o.date <= end; });
    const ahead = orders.filter(function (o) { return o.date > end && o.date <= scanEnd && o.isLarge; });

    // 3. 添付は今日〜DAYS_AHEAD日分のキッチン指示書(デリプロの画面から出すものと同じ形式)
    const attachments = main.length
      ? [deliproKitchenPdf_(client, main.map(function (o) { return o.number; }), 'kitchen_' + stamp + '.pdf')]
      : [];

    const mail = buildKitchenMail_(today, end, main, ahead);
    MailApp.sendEmail({
      to: mailTo,
      subject: mail.subject,
      htmlBody: mail.html,
      body: mail.text,
      attachments: attachments,
    });
  } catch (err) {
    Logger.log('runKitchenDigest_ failed: ' + (err && err.stack ? err.stack : err));
    MailApp.sendEmail(cfg.ADMIN_EMAIL, '【エラー】キッチン指示書メール', String(err && err.stack ? err.stack : err));
  }
}

/** 読み取りの頻度制限(rate limit)に当たったら、待ってから再挑戦する */
function extractKitchenPdfTextWithRetry_(blob) {
  const waits = [10000, 30000, 60000];
  for (let attempt = 0; ; attempt++) {
    try {
      return extractKitchenPdfText_(blob);
    } catch (err) {
      if (attempt >= waits.length || !/rate limit|User rate|429|503/i.test(String(err))) throw err;
      Utilities.sleep(waits[attempt]);
    }
  }
}

/**
 * PDFをGoogleドキュメントに一時変換してテキストを取り出す。
 * 要: Apps Scriptの「サービス」でDrive APIを追加(v2・v3のどちらでも動く)
 */
function extractKitchenPdfText_(blob) {
  const isV3 = typeof Drive.Files.create === 'function';
  const tmp = isV3
    ? Drive.Files.create({ name: 'tmp_kitchen_' + blob.getName(), mimeType: MimeType.GOOGLE_DOCS }, blob,
      { ocrLanguage: 'ja', fields: 'id' })
    // v2 では変換先の種類を指定せず、PDFとして渡して ocr:true でGoogleドキュメントに変換する
    : Drive.Files.insert({ title: 'tmp_kitchen_' + blob.getName() }, blob.setContentType(MimeType.PDF),
      { ocr: true, ocrLanguage: 'ja' });
  try {
    return DocumentApp.openById(tmp.id).getBody().getText();
  } finally {
    Drive.Files.remove(tmp.id);
  }
}

/** メールの件名・HTML本文・テキスト本文を作る */
function buildKitchenMail_(today, end, orders, ahead) {
  const cfg = KITCHEN_CONFIG;
  const large = orders.filter(function (o) { return o.isLarge; }).concat(ahead || []);
  const pending = orders.filter(isHighlightedPending_);
  const people = function (list) {
    return list.reduce(function (s, o) { return s + (o.headcount || 0); }, 0);
  };

  const subject = '【キッチン指示書】' + kFormatJa_(today) + '〜' + kFormatJa_(end) +
    ' ' + orders.length + '件(保留' + pending.length + '件)・大型' + large.length + '件';

  const h = [];
  h.push('<div style="font-family:sans-serif;font-size:14px;color:#222">');
  h.push('<p>' + kEsc_(kFormatJa_(today)) + '〜' + kEsc_(kFormatJa_(end)) + ' のデリプロ注文一覧です(確定・保留)。' +
    'キッチン指示書(注文別:メイン)のPDFを添付しています。</p>');
  h.push('<p>合計 ' + orders.length + '件 / ' + people(orders) + '名、うち保留 ' + pending.length + '件 / ' + people(pending) + '名(南海などの定例分を除く)</p>');
  h.push('<p>大型(' + cfg.LARGE_HEADCOUNT + '名以上・' + cfg.LARGE_LOOKAHEAD_DAYS + '日先まで) ' +
    large.length + '件 / ' + people(large) + '名</p>');

  if (large.length) {
    h.push('<h3 style="color:#b00020;margin:16px 0 4px">大型案件(発注に注意)</h3>');
    h.push(kitchenTable_(large, today, true));
  }

  h.push('<h3 style="margin:16px 0 4px">日別一覧</h3>');
  for (let d = today; d <= end; d = kAddDays_(d, 1)) {
    const day = orders.filter(function (o) { return o.date === d; });
    h.push('<h4 style="margin:12px 0 4px">' + kEsc_(kFormatJa_(d)) + ' ' + day.length + '件' +
      (day.length ? '(' + people(day) + '名)' : '') + '</h4>');
    h.push(day.length ? kitchenTable_(day, today, false) : '<p style="color:#888;margin:0">注文なし</p>');
  }
  h.push('<p style="color:#888;font-size:12px">人数はキッチン指示書のプラン・料理の数量からの推定です。</p>');
  h.push('</div>');

  const text = [subject, ''].concat(orders.map(function (o) {
    return [kFormatJa_(o.date), o.time, 'No.' + o.number, o.status, o.isLarge ? '【大型】' : '', o.client,
      (o.headcount || '?') + '名', planText_(o)].join(' ');
  })).join('\n');

  return { subject: subject, html: h.join(''), text: text };
}

function kitchenTable_(orders, today, showDaysLeft) {
  const th = 'style="border:1px solid #ccc;padding:4px 6px;background:#f2f2f2;text-align:left;white-space:nowrap"';
  const td = 'style="border:1px solid #ccc;padding:4px 6px;vertical-align:top"';
  const heads = ['日付', '時間', 'No.', '状態', '人数', 'お客様', 'プラン', 'お届け先'];
  if (showDaysLeft) heads.splice(1, 0, 'あと');
  const rows = orders.map(function (o) {
    const cells = [
      kEsc_(kFormatJa_(o.date)),
      kEsc_(o.time || '-'),
      kEsc_(o.number),
      isHighlightedPending_(o) ? '<b style="color:#b26a00">保留</b>' : kEsc_(o.status),
      (o.isLarge ? '<b style="color:#b00020">' : '') + kEsc_(o.headcount ? o.headcount + '名' : '-') + (o.isLarge ? '</b>' : ''),
      kEsc_(o.client),
      kEsc_(planText_(o)),
      kEsc_(o.place),
    ];
    if (showDaysLeft) cells.splice(1, 0, kEsc_(kDiffDays_(today, o.date) + '日'));
    const bg = o.isLarge ? '#fde7ea' : isHighlightedPending_(o) ? '#fff6d6' : '#fff';
    return '<tr style="background:' + bg + '">' +
      cells.map(function (v) { return '<td ' + td + '>' + v + '</td>'; }).join('') + '</tr>';
  });
  return '<table style="border-collapse:collapse;font-size:13px"><tr>' +
    heads.map(function (x) { return '<th ' + th + '>' + x + '</th>'; }).join('') + '</tr>' + rows.join('') + '</table>';
}

/** 色分けして目立たせる保留か(南海など、保留が通常状態のお客様は除く) */
function isHighlightedPending_(o) {
  if (o.status !== '保留') return false;
  return !(KITCHEN_CONFIG.NO_PENDING_HIGHLIGHT_CLIENTS || []).some(function (name) {
    return String(o.client || '').indexOf(name) !== -1;
  });
}

/** プラン欄の要約。プラン欄がない注文(南海など)は明細をそのまま出す */
function planText_(o) {
  if (!o.plans.length) return o.details;
  const text = o.plans.map(function (p) { return p.name + '×' + p.qty; }).join(' / ');
  // プラン欄が諸経費などだけの注文(料理は明細側にある)は、明細も並べる
  const onlyExtras = o.plans.every(function (p) { return /^\(雑\)|（雑）|諸経費/.test(p.name); });
  return onlyExtras && o.details ? text + ' / ' + o.details : text;
}

function kAddDays_(ymd, days) {
  const p = ymd.split('-').map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + days));
  return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
}

function kDiffDays_(fromYmd, toYmd) {
  const a = fromYmd.split('-').map(Number);
  const b = toYmd.split('-').map(Number);
  return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86400000);
}

function kFormatJa_(ymd) {
  const p = ymd.split('-').map(Number);
  const w = ['日', '月', '火', '水', '木', '金', '土'][new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay()];
  return p[1] + '/' + p[2] + '(' + w + ')';
}

function kEsc_(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
