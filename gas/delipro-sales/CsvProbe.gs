/**
 * 調査用(1回だけ実行): 今月1日〜今日に配達した確定注文で、集配管理の3種類のダウンロード
 * (ダウンロード / 明細DL / 発注書DL)を取得し、マイドライブの「delipro_probe」フォルダにそのまま保存する。
 * PLの売上(注文区分×支払方法×税率)を自動集計するために、CSVの列を確認する目的で使う。
 * メールは送らず、デリプロのデータも変更しない。
 */
function probeDeliproCsv() {
  const cfg = SALES_CONFIG;
  const today = Utilities.formatDate(new Date(), cfg.TIME_ZONE, 'yyyy-MM-dd');
  const first = today.slice(0, 8) + '01';
  const client = deliproLogin_();
  const orders = deliproSearch_(client, first, today, '0', '0');
  const ids = orders.map(function (o) { return o.odid; });
  if (!ids.length) throw new Error('対象の注文がありません');

  const it = DriveApp.getFoldersByName(cfg.PROBE_FOLDER);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(cfg.PROBE_FOLDER);
  [['deli_download.php', { odids: ids.join(','), user: 'dp0100' }],
   ['delisheet_download.php', { odids: ids.join(',') }],
   ['ordersheet_download.php', { odids: ids.join(',') }]].forEach(function (t) {
    const res = deliproRequest_(client, t[0], { method: 'post', payload: t[1] });
    const blob = res.getBlob().setName('csv_' + t[0].replace('.php', '') + '_' + ids.length + '件');
    folder.createFile(blob);
  });
  Logger.log('保存先: ' + folder.getUrl() + ' / 注文' + ids.length + '件');
}

/**
 * 調査用(1回だけ実行): CSVに無い「注文区分」「事業所」「税率」の取り方を調べるため、
 * 集配管理の検索結果の画面(HTML)をそのまま「delipro_probe」フォルダに保存する。
 * 画面の中の選択肢(注文区分など)と、帳票(発注請書など)へのリンクを見る目的で使う。
 */
function probeDeliproPages() {
  const cfg = SALES_CONFIG;
  const today = Utilities.formatDate(new Date(), cfg.TIME_ZONE, 'yyyy-MM-dd');
  const client = deliproLogin_();
  const it = DriveApp.getFoldersByName(cfg.PROBE_FOLDER);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(cfg.PROBE_FOLDER);

  // 検索前の画面と、今日配達分の検索結果(件数が少なく、画面の部品を見るには十分)
  const top = deliproRequest_(client, 'deli.php', { method: 'get' }).getContentText('UTF-8');
  folder.createFile('page_deli_top.html', top, MimeType.HTML);
  deliproSearch_(client, today, today, '0', '0');
  folder.createFile('page_deli_result.html', client.lastHtml, MimeType.HTML);
  Logger.log('保存先: ' + folder.getUrl());
}

/**
 * 調査用(1回だけ実行): 税率別の金額(10%・8%・0%対象)が出る「売上分析(期間)」の画面
 * (analyze_sale_time.php)を「delipro_probe」フォルダに保存する。検索条件の項目名を確認する目的で使う。
 */
function probeDeliproAnalysis() {
  const cfg = SALES_CONFIG;
  const client = deliproLogin_();
  const it = DriveApp.getFoldersByName(cfg.PROBE_FOLDER);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(cfg.PROBE_FOLDER);
  ['analyze_sale_time.php', 'index.php'].forEach(function (path) {
    const html = deliproRequest_(client, path, { method: 'get' }).getContentText('UTF-8');
    folder.createFile('page_' + path.replace('.php', '') + '.html', html, MimeType.HTML);
  });
  Logger.log('保存先: ' + folder.getUrl());
}

/**
 * 調査用(1回だけ実行): 売上分析(期間)に検索条件(今月・大阪直販・確定)を送ったときの返事の画面を
 * 「delipro_probe」フォルダに保存する。画面の検索条件の欄に、送った条件が反映されているかを確認する目的で使う。
 */
function probeTaxRequest() {
  const cfg = SALES_CONFIG;
  const today = Utilities.formatDate(new Date(), cfg.TIME_ZONE, 'yyyy-MM-dd');
  const client = deliproLogin_();
  client.trace = [];
  const it = DriveApp.getFoldersByName(cfg.PROBE_FOLDER);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(cfg.PROBE_FOLDER);
  try {
    const r = deliproTaxSummary_(client, today.slice(0, 8) + '01', today, '4', '0');
    Logger.log('読み取り結果: ' + JSON.stringify(r));
  } catch (e) {
    Logger.log('読み取りエラー: ' + e);
  }
  folder.createFile('page_tax_result.html', client.lastTaxHtml || '', MimeType.HTML);
  Logger.log('通信の経過: ' + client.trace.join(' / '));
  Logger.log('保存先: ' + folder.getUrl());
}

/**
 * 調査用(1回だけ実行): 売上分析(期間)で「お届け日」「注文区分」の条件が効く送り方を探す。
 * 送り方を変えて今月・大阪直販・確定を検索し、返ってきた画面で選ばれている条件と注文合計を実行ログに出す。
 */
function probeTaxVariants() {
  const cfg = SALES_CONFIG;
  const today = Utilities.formatDate(new Date(), cfg.TIME_ZONE, 'yyyy/MM/dd');
  const base = [
    ['daytype', '2'], ['datSt', today.slice(0, 8) + '01'], ['slt_sttime', '0'], ['datEd', today], ['slt_edtime', '24'],
    ['slt_group', '1'], ['txt_discount_min', ''], ['txt_discount_max', ''], ['odspid_s', '1'],
    ['txt_odcszip', ''], ['txt_odcsadd', ''], ['txt_odmemo', ''], ['odtype[]', '4'], ['odstatus', '0'],
    ['txt_csid', ''], ['txt_csname', ''], ['txt_cstel', ''], ['hid_mode', ''],
  ];
  const enc = function (pairs) {
    return pairs.map(function (p) { return encodeURIComponent(p[0]) + '=' + encodeURIComponent(p[1]); }).join('&');
  };
  const obj = {};
  base.forEach(function (p) { obj[p[0]] = p[1]; });
  const variants = [
    ['A 今の送り方', function (c) { return deliproRequest_(c, 'analyze_sale_time.php', { method: 'post', payload: obj }); }],
    ['B 文字列で送る', function (c) {
      return deliproRequest_(c, 'analyze_sale_time.php', { method: 'post', payload: enc(base), contentType: 'application/x-www-form-urlencoded' });
    }],
    ['C 画面を開いてから送る', function (c) {
      deliproRequest_(c, 'analyze_sale_time.php', { method: 'get' });
      return deliproRequest_(c, 'analyze_sale_time.php', { method: 'post', payload: enc(base), contentType: 'application/x-www-form-urlencoded' });
    }],
    ['D URLに付けて送る(GET)', function (c) { return deliproRequest_(c, 'analyze_sale_time.php?' + enc(base), { method: 'get' }); }],
    ['E 参照元を付けて送る', function (c) {
      return deliproRequest_(c, 'analyze_sale_time.php', {
        method: 'post', payload: enc(base), contentType: 'application/x-www-form-urlencoded',
        headers: { Referer: DELIPRO_BASE + 'analyze_sale_time.php', Origin: 'https://asp.delipro.jp' },
      });
    }],
  ];
  variants.forEach(function (v) {
    const client = deliproLogin_();
    client.trace = [];
    try {
      const html = v[1](client).getContentText('UTF-8');
      Logger.log(v[0] + ': ' + describeTaxForm_(html) + ' / 通信: ' + client.trace.join(' → '));
    } catch (e) {
      Logger.log(v[0] + ': エラー ' + e);
    }
  });
}

/** 返ってきた画面で選ばれている日付の基準・注文区分・注文状態と、注文合計 */
function describeTaxForm_(html) {
  const sel = function (name) {
    const m = html.match(new RegExp('<select[^>]*name="' + name.replace(/[[\]]/g, '\\$&') + '"[\\s\\S]*?</select>'));
    if (!m) return '?';
    const out = [];
    const re = /<option value="([^"]*)"\s*([^>]*)>([^<]*)/g;
    let o;
    while ((o = re.exec(m[0])) !== null) if (/selected/.test(o[2])) out.push(o[3].trim());
    return out.length > 3 ? out.length + '個すべて' : out.join(',');
  };
  let total = '?';
  try { total = parseTaxSummary_(html).total; } catch (e) { total = '読めず'; }
  return '日付の基準=' + sel('daytype') + ' 注文区分=' + sel('odtype[]') + ' 状態=' + sel('odstatus') + ' 注文合計=' + total;
}
