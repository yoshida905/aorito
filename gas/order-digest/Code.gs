/**
 * デリプロ注文一覧メール: 毎朝、今日から1週間先までの案件(確定・保留)を一覧にしてメール送信する。
 *
 * 仕組み:
 * 1. 「09_見積・受注書類」配下の案件フォルダ(MMDD_★顧客名)を、フォルダ名の日付で絞り込む
 * 2. フォルダ内のデリプロPDFを判定(発注請書あり=確定 / 見積書のみ=保留)
 * 3. PDFをGoogleドキュメントに一時変換してテキストを取り出し、日時・人数・金額などを読み取る
 * 4. 50名以上の大型案件は、3週間先まで先取りして冒頭にまとめる
 *
 * セットアップ手順は docs/order-digest.md を参照。
 */

/** 毎朝トリガーで実行されるメイン処理 */
function sendDailyOrderDigest() {
  runDigest_(DIGEST_CONFIG.MAIL_TO);
}

/** 動作確認用: 管理者宛てにだけ送る */
function testSendToAdmin() {
  runDigest_(DIGEST_CONFIG.ADMIN_EMAIL);
}

/** 毎朝の時間トリガーを作り直す(1回だけ手動実行する) */
function setupDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendDailyOrderDigest') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendDailyOrderDigest')
    .timeBased()
    .everyDays(1)
    .atHour(DIGEST_CONFIG.TRIGGER_HOUR)
    .inTimezone(DIGEST_CONFIG.TIME_ZONE)
    .create();
}

function runDigest_(mailTo) {
  const cfg = DIGEST_CONFIG;
  const deadline = Date.now() + cfg.TIME_BUDGET_MS;
  try {
    const today = Utilities.formatDate(new Date(), cfg.TIME_ZONE, 'yyyy-MM-dd');
    const mainEnd = addDaysYmd_(today, cfg.DAYS_AHEAD);
    const scanEnd = addDaysYmd_(today, Math.max(cfg.DAYS_AHEAD, cfg.LARGE_LOOKAHEAD_DAYS || 0));

    const caseFolders = collectCaseFolders_(today, scanEnd, deadline);
    const cache = loadParseCache_();
    const cases = caseFolders.map(function (cf) {
      return buildCase_(cf, cache, deadline);
    });
    saveParseCache_(cache);

    const main = [];
    const ahead = [];
    cases.forEach(function (c) {
      if (c.date >= today && c.date <= mainEnd) main.push(c);
      else if (c.date > mainEnd && c.date <= scanEnd && c.isLarge) ahead.push(c);
    });
    main.sort(compareCase_);
    ahead.sort(compareCase_);

    const mail = buildMail_(today, mainEnd, main, ahead);
    MailApp.sendEmail({
      to: mailTo,
      subject: mail.subject,
      htmlBody: mail.html,
      body: mail.text,
      attachments: collectAttachments_(main.concat(ahead)),
    });
  } catch (err) {
    Logger.log('runDigest_ failed: ' + (err && err.stack ? err.stack : err));
    MailApp.sendEmail(cfg.ADMIN_EMAIL, '【エラー】デリプロ注文一覧メール', String(err && err.stack ? err.stack : err));
  }
}

/**
 * ルート配下を探索し、フォルダ名の日付が期間内の案件フォルダを集める。
 * 案件フォルダの中には潜らない・過去の年フォルダは飛ばすことで探索量を抑える。
 */
function collectCaseFolders_(fromYmd, toYmd, deadline) {
  const cfg = DIGEST_CONFIG;
  const from = fromYmd.split('-').map(Number);
  const to = toYmd.split('-').map(Number);
  const root = DriveApp.getFolderById(cfg.ROOT_FOLDER_ID);
  const found = [];
  const stack = [{ folder: root, depth: 0, area: '' }];

  while (stack.length) {
    if (Date.now() > deadline) {
      throw new Error('フォルダ探索が時間内に終わりませんでした。EXCLUDE_FOLDER_NAMES に不要なフォルダを追加してください');
    }
    const cur = stack.pop();
    const it = cur.folder.getFolders();
    while (it.hasNext()) {
      const sub = it.next();
      const name = sub.getName();
      if (cfg.EXCLUDE_FOLDER_NAMES.indexOf(name) !== -1) continue;

      if (cfg.CASE_FOLDER_PATTERN.test(name)) {
        const date = folderDateInRange_(name, cfg.CASE_FOLDER_PATTERN, from, to);
        if (date) found.push({ folder: sub, folderDate: date, area: cur.area || name });
        continue;
      }
      if (/^\d{4}$/.test(name) && Number(name) < from[0]) continue;
      if (cur.depth < 4) stack.push({ folder: sub, depth: cur.depth + 1, area: cur.area || name });
    }
  }
  return found;
}

/** 案件フォルダ1つ分の情報を組み立てる */
function buildCase_(cf, cache, deadline) {
  const files = [];
  const it = cf.folder.getFilesByType(MimeType.PDF);
  while (it.hasNext()) {
    const f = it.next();
    files.push({ name: f.getName(), created: f.getDateCreated().getTime(), file: f });
  }

  const c = {
    folderName: cf.folder.getName(),
    folderUrl: cf.folder.getUrl(),
    area: cf.area,
    date: cf.folderDate,
    status: '書類なし',
    estimateCount: 0,
    fileId: '',
    fileUrl: '',
    fileName: '',
    info: null,
    notes: [],
    isLarge: false,
  };

  const pick = pickRepresentativeFile_(files);
  if (!pick) {
    c.notes.push('デリプロのPDF(見積書/発注請書)がありません');
    return c;
  }
  c.status = pick.status;
  c.estimateCount = pick.estimateCount;
  c.fileId = pick.file.file.getId();
  c.fileUrl = pick.file.file.getUrl();
  c.fileName = pick.file.name;
  if (c.status === '保留' && c.estimateCount > 1) {
    c.notes.push('見積書が' + c.estimateCount + '件あります(最新を表示)');
  }

  const cacheKey = c.fileId + ':' + pick.file.file.getLastUpdated().getTime();
  let info = cache[cacheKey] ? cache[cacheKey].data : null;
  if (!info) {
    if (Date.now() > deadline) {
      c.notes.push('時間切れのため未解析(明日の実行で解析されます)');
      return c;
    }
    try {
      const parsed = parseDeliproText_(extractPdfText_(pick.file.file));
      info = {
        deliveryDate: parsed.deliveryDate,
        deliveryTime: parsed.deliveryTime,
        place: parsed.place,
        client: parsed.client,
        total: parsed.total,
        office: parsed.office,
        number: parsed.number,
        memo: parsed.memo,
        changeDeadlineDays: parsed.changeDeadlineDays,
        headcount: parsed.headcount,
        plan: mainPlanName_(parsed.items),
      };
      cache[cacheKey] = { savedAt: Date.now(), data: info };
    } catch (err) {
      c.notes.push('PDFの読み取りに失敗: ' + err);
      return c;
    }
  }

  c.info = info;
  if (info.deliveryDate && info.deliveryDate !== c.date) {
    c.notes.push('フォルダ名の日付(' + formatYmdJa_(c.date) + ')とPDFの納品日が違います');
    c.date = info.deliveryDate;
  }
  c.isLarge = info.headcount !== null && info.headcount >= DIGEST_CONFIG.LARGE_HEADCOUNT;
  if (info.headcount === null) c.notes.push('人数を読み取れませんでした');
  return c;
}

/**
 * PDFをGoogleドキュメントに一時変換してテキストを取り出す。
 * デリプロのPDFは文字データを持っているため、変換でほぼそのまま文字が取れる。
 * 要: Apps Scriptの「サービス」でDrive API(v3)を追加
 */
function extractPdfText_(file) {
  const tmp = Drive.Files.create(
    { name: 'tmp_delipro_' + file.getId(), mimeType: MimeType.GOOGLE_DOCS },
    file.getBlob(),
    { ocrLanguage: 'ja', fields: 'id' }
  );
  try {
    return DocumentApp.openById(tmp.id).getBody().getText();
  } finally {
    Drive.Files.remove(tmp.id);
  }
}

function compareCase_(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const ta = timeSortKey_(a.info && a.info.deliveryTime);
  const tb = timeSortKey_(b.info && b.info.deliveryTime);
  return ta < tb ? -1 : ta > tb ? 1 : 0;
}

/** 解析結果のキャッシュ(同じPDFを毎日変換し直さないため)。スクリプトプロパティに保存 */
function loadParseCache_() {
  const props = PropertiesService.getScriptProperties().getProperties();
  const cache = {};
  const limit = Date.now() - DIGEST_CONFIG.CACHE_RETENTION_DAYS * 86400000;
  Object.keys(props).forEach(function (k) {
    if (k.indexOf('pdf:') !== 0) return;
    try {
      const v = JSON.parse(props[k]);
      if (v.savedAt >= limit) cache[k.slice(4)] = v;
    } catch (e) {
      // 壊れたキャッシュは捨てる
    }
  });
  return cache;
}

function saveParseCache_(cache) {
  const store = PropertiesService.getScriptProperties();
  const current = store.getProperties();
  Object.keys(current).forEach(function (k) {
    if (k.indexOf('pdf:') === 0 && !cache[k.slice(4)]) store.deleteProperty(k);
  });
  const toSave = {};
  Object.keys(cache).forEach(function (k) {
    toSave['pdf:' + k] = JSON.stringify(cache[k]);
  });
  store.setProperties(toSave, false);
}

/** 添付するPDFを集める(ATTACH_MODEとサイズ上限に従う) */
function collectAttachments_(cases) {
  const cfg = DIGEST_CONFIG;
  if (cfg.ATTACH_MODE === 'none') return [];
  const blobs = [];
  let total = 0;
  cases.forEach(function (c) {
    if (!c.fileId) return;
    if (cfg.ATTACH_MODE === 'large' && !c.isLarge) return;
    const file = DriveApp.getFileById(c.fileId);
    const size = file.getSize();
    if (total + size > cfg.ATTACH_MAX_BYTES) return;
    total += size;
    blobs.push(file.getBlob().setName(formatYmdJa_(c.date).replace(/[/()]/g, '') + '_' + c.status + '_' + c.fileName));
  });
  return blobs;
}

/** メールの件名・HTML本文・テキスト本文を作る */
function buildMail_(today, mainEnd, main, ahead) {
  const cfg = DIGEST_CONFIG;
  const confirmed = main.filter(function (c) { return c.status === '確定'; });
  const pending = main.filter(function (c) { return c.status === '保留'; });
  const large = main.filter(function (c) { return c.isLarge; }).concat(ahead);
  const sum = function (list, key) {
    return list.reduce(function (s, c) { return s + ((c.info && c.info[key]) || 0); }, 0);
  };

  const subject = '【デリプロ注文一覧】' + formatYmdJa_(today) + '〜' + formatYmdJa_(mainEnd) +
    ' 確定' + confirmed.length + '件・保留' + pending.length + '件・大型' + large.length + '件';

  const h = [];
  h.push('<div style="font-family:sans-serif;font-size:14px;color:#222">');
  h.push('<p>' + esc_(formatYmdJa_(today)) + '〜' + esc_(formatYmdJa_(mainEnd)) + ' のデリプロ案件一覧です(保留=見積書のみ・発注請書未発行)。</p>');
  h.push('<table style="border-collapse:collapse;margin-bottom:16px">' +
    summaryRow_('確定', confirmed.length + '件 / ' + sum(confirmed, 'headcount') + '名 / ' + yen_(sum(confirmed, 'total'))) +
    summaryRow_('保留', pending.length + '件 / ' + sum(pending, 'headcount') + '名 / ' + yen_(sum(pending, 'total'))) +
    summaryRow_('大型(' + cfg.LARGE_HEADCOUNT + '名以上)', large.length + '件(' + cfg.LARGE_LOOKAHEAD_DAYS + '日先まで)') +
    '</table>');

  if (large.length) {
    h.push('<h3 style="color:#b00020;margin:16px 0 4px">大型案件(発注の前倒し確認)</h3>');
    h.push(tableHtml_(large, true, today));
  }

  h.push('<h3 style="margin:16px 0 4px">日別一覧</h3>');
  for (let d = today; d <= mainEnd; d = addDaysYmd_(d, 1)) {
    const day = main.filter(function (c) { return c.date === d; });
    h.push('<h4 style="margin:12px 0 4px">' + esc_(formatYmdJa_(d)) + ' ' + day.length + '件' +
      (day.length ? '(' + sum(day, 'headcount') + '名)' : '') + '</h4>');
    h.push(day.length ? tableHtml_(day, false, today) : '<p style="color:#888;margin:0">案件なし</p>');
  }

  const issues = main.concat(ahead).filter(function (c) { return c.notes.length; });
  if (issues.length) {
    h.push('<h3 style="margin:16px 0 4px">要確認</h3><ul>');
    issues.forEach(function (c) {
      h.push('<li><a href="' + esc_(c.folderUrl) + '">' + esc_(c.folderName) + '</a>: ' + esc_(c.notes.join(' / ')) + '</li>');
    });
    h.push('</ul>');
  }
  h.push('<p style="color:#888;font-size:12px">人数は料理・ドリンクプランの最大数量からの推定です。正式な内容は各PDFで確認してください。</p>');
  h.push('</div>');

  const text = [subject, ''].concat(main.map(function (c) {
    const i = c.info || {};
    return [formatYmdJa_(c.date), i.deliveryTime || '', c.status, c.isLarge ? '大型' : '', i.client || c.folderName,
      (i.headcount || '?') + '名', i.total ? yen_(i.total) : '', c.fileUrl || c.folderUrl].join(' ');
  })).join('\n');

  return { subject: subject, html: h.join(''), text: text };
}

function tableHtml_(cases, showDeadline, today) {
  const th = 'style="border:1px solid #ccc;padding:4px 6px;background:#f2f2f2;text-align:left;white-space:nowrap"';
  const heads = ['日付', '時間', '状態', '人数', '拠点', 'お客様', 'プラン', '金額', '場所', '社内メモ'];
  if (showDeadline) heads.splice(3, 0, '確定締切');
  const rows = cases.map(function (c) {
    const i = c.info || {};
    const bg = c.isLarge ? '#fde7ea' : c.status === '保留' ? '#fff6d6' : c.status === '確定' ? '#fff' : '#eee';
    const td = 'style="border:1px solid #ccc;padding:4px 6px;vertical-align:top"';
    const cells = [
      esc_(formatYmdJa_(c.date)),
      esc_(i.deliveryTime || ''),
      esc_(c.status),
      (c.isLarge ? '<b style="color:#b00020">' : '') + esc_(i.headcount ? i.headcount + '名' : '-') + (c.isLarge ? '</b>' : ''),
      esc_(i.office || c.area),
      '<a href="' + esc_(c.fileUrl || c.folderUrl) + '">' + esc_(i.client || c.folderName) + '</a>',
      esc_(i.plan || ''),
      esc_(i.total ? yen_(i.total) : ''),
      esc_(i.place || ''),
      esc_(i.memo || ''),
    ];
    if (showDeadline) cells.splice(3, 0, esc_(deadlineText_(c, today)));
    return '<tr style="background:' + bg + '">' + cells.map(function (v) { return '<td ' + td + '>' + v + '</td>'; }).join('') + '</tr>';
  });
  return '<table style="border-collapse:collapse;font-size:13px">' +
    '<tr>' + heads.map(function (x) { return '<th ' + th + '>' + x + '</th>'; }).join('') + '</tr>' +
    rows.join('') + '</table>';
}

/** 人数・メニューの確定締切(PDF備考の「開催日のN日前まで」から計算) */
function deadlineText_(c, today) {
  const days = c.info && c.info.changeDeadlineDays;
  if (!days) return '-';
  const d = addDaysYmd_(c.date, -days);
  const left = diffDaysYmd_(today, d);
  return formatYmdJa_(d) + (left < 0 ? ' 締切済' : left === 0 ? ' 本日' : ' あと' + left + '日');
}

function summaryRow_(label, value) {
  return '<tr><td style="padding:2px 12px 2px 0;color:#555">' + esc_(label) + '</td><td style="padding:2px 0">' + esc_(value) + '</td></tr>';
}

function yen_(n) {
  return '¥' + Number(n || 0).toLocaleString('ja-JP');
}

function esc_(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
