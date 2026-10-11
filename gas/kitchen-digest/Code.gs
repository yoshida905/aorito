/**
 * キッチン指示書メール: デリプロの「キッチン指示書(注文別:メイン)」PDFを読み取り、
 * 今日から7日先までの注文を日別・大型案件別に整理して、PDFを添付してメール送信する。
 *
 * 現段階(フェーズ1)は、デリプロからダウンロードしたPDFを INBOX_FOLDER_ID のフォルダに置く運用。
 * フェーズ2でデリプロからの自動ダウンロードに差し替える場合は getKitchenPdf_() だけを置き換える。
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

    const file = getKitchenPdf_();
    if (!file) {
      MailApp.sendEmail(mailTo, '【要対応】本日のキッチン指示書PDFが未保存です',
        'デリプロの集配管理から「キッチン指示書(注文別:メイン)」を期間 ' + kFormatJa_(today) + '〜' + kFormatJa_(end) +
        ' でダウンロードし、所定のフォルダに保存してください。\n保存後に関数 sendKitchenDigest を実行すると送信されます。');
      return;
    }

    const orders = parseKitchenText_(extractKitchenPdfText_(file), today)
      .filter(function (o) { return o.date >= today && o.date <= end; });
    orders.forEach(function (o) {
      o.isLarge = o.headcount !== null && o.headcount >= cfg.LARGE_HEADCOUNT;
    });
    orders.sort(function (a, b) {
      const ka = a.date + ' ' + (a.time || '99:99');
      const kb = b.date + ' ' + (b.time || '99:99');
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });

    const mail = buildKitchenMail_(today, end, orders, file);
    MailApp.sendEmail({
      to: mailTo,
      subject: mail.subject,
      htmlBody: mail.html,
      body: mail.text,
      attachments: [file.getBlob()],
    });
  } catch (err) {
    Logger.log('runKitchenDigest_ failed: ' + (err && err.stack ? err.stack : err));
    MailApp.sendEmail(cfg.ADMIN_EMAIL, '【エラー】キッチン指示書メール', String(err && err.stack ? err.stack : err));
  }
}

/** 受け取りフォルダから、最新のキッチン指示書PDFを返す。古すぎる・存在しない場合はnull */
function getKitchenPdf_() {
  const cfg = KITCHEN_CONFIG;
  if (!cfg.INBOX_FOLDER_ID) throw new Error('Config.gs の INBOX_FOLDER_ID が未設定です');
  const it = DriveApp.getFolderById(cfg.INBOX_FOLDER_ID).getFilesByType(MimeType.PDF);
  let latest = null;
  while (it.hasNext()) {
    const f = it.next();
    if (!cfg.FILE_NAME_PATTERN.test(f.getName())) continue;
    if (!latest || f.getDateCreated() > latest.getDateCreated()) latest = f;
  }
  if (!latest) return null;
  const ageHours = (Date.now() - latest.getDateCreated().getTime()) / 3600000;
  return ageHours <= cfg.MAX_FILE_AGE_HOURS ? latest : null;
}

/**
 * PDFをGoogleドキュメントに一時変換してテキストを取り出す。
 * 要: Apps Scriptの「サービス」でDrive API(v3)を追加
 */
function extractKitchenPdfText_(file) {
  const tmp = Drive.Files.create(
    { name: 'tmp_kitchen_' + file.getId(), mimeType: MimeType.GOOGLE_DOCS },
    file.getBlob(),
    { ocrLanguage: 'ja', fields: 'id' }
  );
  try {
    return DocumentApp.openById(tmp.id).getBody().getText();
  } finally {
    Drive.Files.remove(tmp.id);
  }
}

/** メールの件名・HTML本文・テキスト本文を作る */
function buildKitchenMail_(today, end, orders, file) {
  const cfg = KITCHEN_CONFIG;
  const large = orders.filter(function (o) { return o.isLarge; });
  const people = function (list) {
    return list.reduce(function (s, o) { return s + (o.headcount || 0); }, 0);
  };

  const subject = '【キッチン指示書】' + kFormatJa_(today) + '〜' + kFormatJa_(end) +
    ' ' + orders.length + '件・大型' + large.length + '件';

  const h = [];
  h.push('<div style="font-family:sans-serif;font-size:14px;color:#222">');
  h.push('<p>' + kEsc_(kFormatJa_(today)) + '〜' + kEsc_(kFormatJa_(end)) + ' のキッチン指示書(注文別:メイン)です。' +
    '元のPDFを添付しています(<a href="' + kEsc_(file.getUrl()) + '">' + kEsc_(file.getName()) + '</a>)。</p>');
  h.push('<p>合計 ' + orders.length + '件 / ' + people(orders) + '名、うち大型(' + cfg.LARGE_HEADCOUNT + '名以上) ' +
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
  h.push('<p style="color:#888;font-size:12px">人数はプランの数量からの推定です。保留・確定の区別はこのPDFに載っていないため、デリプロの集配一覧で確認してください。</p>');
  h.push('</div>');

  const text = [subject, ''].concat(orders.map(function (o) {
    return [kFormatJa_(o.date), o.time, 'No.' + o.number, o.isLarge ? '【大型】' : '', o.client,
      (o.headcount || '?') + '名', planText_(o)].join(' ');
  })).join('\n');

  return { subject: subject, html: h.join(''), text: text };
}

function kitchenTable_(orders, today, showDaysLeft) {
  const th = 'style="border:1px solid #ccc;padding:4px 6px;background:#f2f2f2;text-align:left;white-space:nowrap"';
  const td = 'style="border:1px solid #ccc;padding:4px 6px;vertical-align:top"';
  const heads = ['日付', '時間', 'No.', '人数', 'お客様', 'プラン', 'お届け先'];
  if (showDaysLeft) heads.splice(1, 0, 'あと');
  const rows = orders.map(function (o) {
    const cells = [
      kEsc_(kFormatJa_(o.date)),
      kEsc_(o.time || '-'),
      kEsc_(o.number),
      (o.isLarge ? '<b style="color:#b00020">' : '') + kEsc_(o.headcount ? o.headcount + '名' : '-') + (o.isLarge ? '</b>' : ''),
      kEsc_(o.client),
      kEsc_(planText_(o)),
      kEsc_(o.place),
    ];
    if (showDaysLeft) cells.splice(1, 0, kEsc_(kDiffDays_(today, o.date) + '日'));
    return '<tr style="background:' + (o.isLarge ? '#fde7ea' : '#fff') + '">' +
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
