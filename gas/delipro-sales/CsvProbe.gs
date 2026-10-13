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
