/**
 * キッチン指示書メール: デリプロの「キッチン指示書(注文別:メイン)」PDFを読み取り、
 * 今日から7日先までの注文を日別・大型案件別に整理して、PDFを添付してメール送信する。
 *
 * デリプロに自動ログインし、集配管理で確定・保留の注文を検索してキッチン指示書PDFを取得する。
 * 50名以上の大型案件は LARGE_LOOKAHEAD_DAYS 日先まで先取りしてメール冒頭にまとめる。
 * セットアップ手順は docs/kitchen-digest.md を参照。
 */

/** 毎朝トリガーで実行されるメイン処理。送信先が登録されている事業所ごとに1通ずつ送る */
function sendKitchenDigest() {
  const props = PropertiesService.getScriptProperties();
  KITCHEN_CONFIG.OFFICES.forEach(function (office) {
    const raw = props.getProperty(office.mailToProperty);
    if (!raw) return;
    const r = parseRecipients_(raw);
    if (r.invalid.length) {
      // 宛先の書き間違いがあっても、正しい宛先には送る。間違いは管理者に知らせる
      MailApp.sendEmail(KITCHEN_CONFIG.ADMIN_EMAIL, '【要確認】' + office.title + 'の送信先に誤りがあります',
        'スクリプトプロパティ ' + office.mailToProperty + ' に、メールアドレスとして読めないものがありました。\n' +
        '読めなかったもの: ' + r.invalid.join(' / ') + '\n\n' +
        'これらを除いた ' + r.valid.length + '件の宛先には送信しています。');
    }
    if (r.valid.length) runKitchenDigest_(office, r.valid.join(','));
  });
}

/**
 * スクリプトプロパティの宛先を分解する。区切りは半角・全角のカンマ、読点、セミコロン、空白、改行のどれでもよい。
 * @return {{valid: string[], invalid: string[]}}
 */
function parseRecipients_(raw) {
  const valid = [];
  const invalid = [];
  String(raw || '').split(/[,，、;；\s]+/).forEach(function (part) {
    const addr = part.trim();
    if (!addr) return;
    (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr) ? valid : invalid).push(addr);
  });
  return { valid: valid, invalid: invalid };
}

/** 動作確認用: 送信先が登録されている事業所の分を、管理者宛てにだけ送る */
function testKitchenDigestToAdmin() {
  const props = PropertiesService.getScriptProperties();
  KITCHEN_CONFIG.OFFICES.forEach(function (office) {
    if (props.getProperty(office.mailToProperty)) runKitchenDigest_(office, KITCHEN_CONFIG.ADMIN_EMAIL);
  });
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

function runKitchenDigest_(office, mailTo) {
  const cfg = KITCHEN_CONFIG;
  try {
    const today = Utilities.formatDate(new Date(), cfg.TIME_ZONE, 'yyyy-MM-dd');
    const end = kAddDays_(today, cfg.DAYS_AHEAD);
    const scanEnd = kAddDays_(today, Math.max(cfg.DAYS_AHEAD, cfg.LARGE_LOOKAHEAD_DAYS || 0));
    const stamp = Utilities.formatDate(new Date(), cfg.TIME_ZONE, 'yyMMddHHmm');

    // 1. 確定・保留の注文を検索(取消・練習は除く)
    const client = deliproLogin_();
    const listed = deliproSearch_(client, today, scanEnd, '0', office.id)
      .concat(deliproSearch_(client, today, scanEnd, '1', office.id));
    const byId = {};
    listed.forEach(function (o) { byId[o.odid] = o; });
    const ids = Object.keys(byId);

    // 2. キッチン指示書PDFを読み取り、注文状態を付け合わせる
    // デリプロのPDFは文字データを持っているので、OCRを使わずに直接読み取る(回数制限なし・数秒で終わる)
    let orders = [];
    if (ids.length) {
      const pdf = deliproKitchenPdf_(client, ids, 'kitchen_scan_' + stamp + '.pdf');
      orders = parseKitchenText_(extractPdfText_(pdf.getBytes()), today);
    }
    const seen = {};
    orders.forEach(function (o) {
      const l = byId[o.number] || {};
      o.status = l.status || '確定';
      o.office = l.office || '';
      o.staff = l.staff || '';
      o.orderType = l.orderType || '';
      o.car = l.car || '';
      o.depart = l.depart || '';
      seen[o.number] = true;
    });
    // キッチン指示書に載らない注文も一覧からは落とさない
    ids.filter(function (id) { return !seen[id]; }).forEach(function (id) {
      const l = byId[id];
      orders.push({ number: id, date: l.date, time: l.time, client: '(キッチン指示書に記載なし)', place: '',
        plans: [], details: '', headcount: null, status: l.status, office: l.office,
        staff: l.staff || '', orderType: l.orderType || '', car: l.car || '', depart: l.depart || '' });
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

    // 日別売上(税込・確定/保留別)
    const days = [];
    for (let d = today; d <= end; d = kAddDays_(d, 1)) days.push(d);
    const sales = deliproDailySales_(client, days, office.id);

    const mail = buildKitchenMail_(today, end, main, ahead, office.title, sales);
    MailApp.sendEmail({
      to: mailTo,
      subject: mail.subject,
      htmlBody: mail.html,
      body: mail.text,
      attachments: attachments,
    });
  } catch (err) {
    Logger.log('runKitchenDigest_ failed: ' + (err && err.stack ? err.stack : err));
    MailApp.sendEmail(cfg.ADMIN_EMAIL, '【エラー】' + office.title + 'メール', String(err && err.stack ? err.stack : err));
  }
}

/** メールの件名・HTML本文・テキスト本文を作る */
function buildKitchenMail_(today, end, orders, ahead, title, sales) {
  const cfg = KITCHEN_CONFIG;
  const large = orders.filter(function (o) { return o.isLarge; }).concat(ahead || []);
  const pending = orders.filter(isHighlightedPending_);
  // 南海など、保留が通常状態で数から外した件数(東京・東海のように該当がなければ表示しない)
  const excludedPending = orders.filter(function (o) { return o.status === '保留'; }).length - pending.length;
  // 保留のまま配達日が近い案件(確定の催促が必要)
  const urgent = pending.filter(function (o) {
    return kDiffDays_(today, orderDeadline_(o)) <= cfg.PENDING_ALERT_MARGIN_DAYS;
  });
  const people = function (list) {
    return list.reduce(function (s, o) { return s + (o.headcount || 0); }, 0);
  };

  const subject = '【' + title + '】' + kFormatJa_(today) + '〜' + kFormatJa_(end) +
    ' ' + orders.length + '件(保留' + pending.length + '件)・大型' + large.length + '件' +
    (urgent.length ? '・要催促' + urgent.length + '件' : '');

  const h = [];
  h.push('<div style="font-family:sans-serif;font-size:14px;color:#222">');
  h.push('<p>' + kEsc_(kFormatJa_(today)) + '〜' + kEsc_(kFormatJa_(end)) + ' のデリプロ注文一覧です(確定・保留)。' +
    'キッチン指示書(注文別:メイン)のPDFを添付しています。</p>');
  if (sales) {
    const total = Object.keys(sales).reduce(function (t, k) {
      return { confirmed: t.confirmed + sales[k].confirmed, pending: t.pending + sales[k].pending };
    }, { confirmed: 0, pending: 0 });
    h.push('<p>売上(税込) ' + kEsc_(yenK_(total.confirmed + total.pending)) + '(確定' + kEsc_(yenK_(total.confirmed)) +
      '・保留' + kEsc_(yenK_(total.pending)) + ')</p>');
  }
  h.push('<p>合計 ' + orders.length + '件 / ' + people(orders) + '名、うち保留 ' + pending.length + '件 / ' + people(pending) + '名' +
    (excludedPending ? '(南海の定例分' + excludedPending + '件を除く)' : '') + '</p>');
  h.push('<p>大型(' + cfg.LARGE_HEADCOUNT + '名以上・' + cfg.LARGE_LOOKAHEAD_DAYS + '日先まで) ' +
    large.length + '件 / ' + people(large) + '名</p>');

  if (urgent.length) {
    h.push('<h3 style="color:#b26a00;margin:16px 0 4px">確定の催促が必要(保留のまま受注締切が' +
      cfg.PENDING_ALERT_MARGIN_DAYS + '日以内・超過)</h3>');
    h.push('<p style="margin:0 0 4px;font-size:12px;color:#555">受注締切: ケータリング(C)は' + cfg.ORDER_DEADLINE_DAYS.C +
      '日前、オードブル(H)は' + cfg.ORDER_DEADLINE_DAYS.H + '日前</p>');
    h.push(kitchenTable_(urgent, today, true, true));
  }

  if (large.length) {
    h.push('<h3 style="color:#b00020;margin:16px 0 4px">大型案件(発注に注意)</h3>');
    h.push(kitchenTable_(large, today, true));
  }

  h.push('<h3 style="margin:16px 0 4px">日別一覧</h3>');
  for (let d = today; d <= end; d = kAddDays_(d, 1)) {
    const day = orders.filter(function (o) { return o.date === d; });
    h.push('<h4 style="margin:12px 0 4px">' + kEsc_(kFormatJa_(d)) + ' ' + day.length + '件' +
      (day.length ? '(' + people(day) + '名)' : '') + salesText_(sales && sales[d]) + '</h4>');
    h.push(day.length ? kitchenTable_(day, today, false) : '<p style="color:#888;margin:0">注文なし</p>');
  }
  h.push('<p style="color:#888;font-size:12px">人数はキッチン指示書のプラン・料理の数量からの推定です。卸(プリン・パンなど)は人数に含めません。</p>');
  h.push('</div>');

  const text = [subject, ''].concat(orders.map(function (o) {
    return [kFormatJa_(o.date), o.time, o.staff ? '配送:' + o.staff : '', o.depart ? '発' + o.depart : '', 'No.' + o.number, o.status, o.isLarge ? '【大型】' : '', o.client,
      o.wholesale ? '卸' : (o.headcount || '?') + '名', planText_(o)].join(' ');
  })).join('\n');

  return { subject: subject, html: h.join(''), text: text };
}

function kitchenTable_(orders, today, showDaysLeft, showDeadline) {
  const th = 'style="border:1px solid #ccc;padding:4px 6px;background:#f2f2f2;text-align:left;white-space:nowrap"';
  const td = 'style="border:1px solid #ccc;padding:4px 6px;vertical-align:top"';
  const heads = ['日付', '時間', '配送', '配車・出発', 'No.', '状態', '人数', 'お客様', 'プラン', 'お届け先'];
  if (showDaysLeft) heads.splice(1, 0, 'あと');
  if (showDeadline) heads.splice(1, 0, '受注締切');
  const rows = orders.map(function (o) {
    const cells = [
      kEsc_(kFormatJa_(o.date)),
      kEsc_(o.time || '-'),
      kEsc_(o.staff || '未定'),
      kEsc_([o.car, o.depart ? '発 ' + o.depart : ''].filter(Boolean).join(' ') || '-'),
      kEsc_(o.number),
      isHighlightedPending_(o) ? '<b style="color:#b26a00">保留</b>' : kEsc_(o.status),
      (o.isLarge ? '<b style="color:#b00020">' : '') + kEsc_(o.wholesale ? '卸' : o.headcount ? o.headcount + '名' : '-') + (o.isLarge ? '</b>' : ''),
      kEsc_(o.client),
      kEsc_(planText_(o)),
      kEsc_(o.place),
    ];
    if (showDaysLeft) cells.splice(1, 0, kEsc_(kDiffDays_(today, o.date) + '日'));
    if (showDeadline) cells.splice(1, 0, deadlineCell_(o, today));
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

/**
 * 受注締切日('YYYY-MM-DD')。プランに(C)ケータリングがあれば5日前、(H)オードブルなら3日前。
 * 両方ある注文は早いほう(ケータリング)に合わせる
 */
function orderDeadline_(o) {
  const days = KITCHEN_CONFIG.ORDER_DEADLINE_DAYS;
  const names = (o.plans || []).map(function (p) { return p.name; }).join(' ') + ' ' + (o.details || '');
  let n = days.DEFAULT;
  if (/[(（]C[)）]/.test(names)) n = Math.max(n, days.C);
  else if (/[(（]H[)）]/.test(names)) n = days.H;
  return kAddDays_(o.date, -n);
}

function deadlineCell_(o, today) {
  const d = orderDeadline_(o);
  const left = kDiffDays_(today, d);
  const note = left < 0 ? '<b style="color:#b00020">超過</b>' : left === 0 ? '<b style="color:#b00020">本日</b>' : 'あと' + left + '日';
  return kEsc_(kFormatJa_(d)) + ' ' + note;
}

/** 日別見出しの売上表示「売上¥2,776,235(確定¥…・保留¥…)」。保留がなければ内訳は省く */
function salesText_(s) {
  if (!s) return '';
  const total = s.confirmed + s.pending;
  if (!total) return ' 売上¥0';
  return ' 売上' + yenK_(total) + (s.pending ? '(確定' + yenK_(s.confirmed) + '・保留' + yenK_(s.pending) + ')' : '');
}

function yenK_(n) {
  return '¥' + String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
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
