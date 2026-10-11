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
  runKitchenDigest_(KITCHEN_CONFIG.MAIL_TO);
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
    let orders = [];
    if (ids.length) {
      const pdf = deliproKitchenPdf_(client, ids, 'kitchen_scan_' + stamp + '.pdf');
      orders = parseKitchenText_(extractKitchenPdfText_(pdf), today);
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
  const pending = orders.filter(function (o) { return o.status === '保留'; });
  const people = function (list) {
    return list.reduce(function (s, o) { return s + (o.headcount || 0); }, 0);
  };

  const subject = '【キッチン指示書】' + kFormatJa_(today) + '〜' + kFormatJa_(end) +
    ' ' + orders.length + '件(保留' + pending.length + '件)・大型' + large.length + '件';

  const h = [];
  h.push('<div style="font-family:sans-serif;font-size:14px;color:#222">');
  h.push('<p>' + kEsc_(kFormatJa_(today)) + '〜' + kEsc_(kFormatJa_(end)) + ' のデリプロ注文一覧です(確定・保留)。' +
    'キッチン指示書(注文別:メイン)のPDFを添付しています。</p>');
  h.push('<p>合計 ' + orders.length + '件 / ' + people(orders) + '名、うち保留 ' + pending.length + '件 / ' + people(pending) + '名</p>');
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
      o.status === '保留' ? '<b style="color:#b26a00">保留</b>' : '確定',
      (o.isLarge ? '<b style="color:#b00020">' : '') + kEsc_(o.headcount ? o.headcount + '名' : '-') + (o.isLarge ? '</b>' : ''),
      kEsc_(o.client),
      kEsc_(planText_(o)),
      kEsc_(o.place),
    ];
    if (showDaysLeft) cells.splice(1, 0, kEsc_(kDiffDays_(today, o.date) + '日'));
    const bg = o.isLarge ? '#fde7ea' : o.status === '保留' ? '#fff6d6' : '#fff';
    return '<tr style="background:' + bg + '">' +
      cells.map(function (v) { return '<td ' + td + '>' + v + '</td>'; }).join('') + '</tr>';
  });
  return '<table style="border-collapse:collapse;font-size:13px"><tr>' +
    heads.map(function (x) { return '<th ' + th + '>' + x + '</th>'; }).join('') + '</tr>' + rows.join('') + '</table>';
}

/** プラン欄の要約。プラン欄がない注文(南海など)は明細をそのまま出す */
function planText_(o) {
  if (!o.plans.length) return o.details;
  return o.plans.map(function (p) { return p.name + '×' + p.qty; }).join(' / ');
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
