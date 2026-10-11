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
 * 調査用(1回だけ実行): 税率別の金額を出している「分析」画面の場所を調べるため、
 * メインメニューと、その中の「分析」を含むリンク先の画面を「delipro_probe」フォルダに保存する。
 */
function probeDeliproAnalysis() {
  const cfg = SALES_CONFIG;
  const client = deliproLogin_();
  const it = DriveApp.getFoldersByName(cfg.PROBE_FOLDER);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(cfg.PROBE_FOLDER);

  const menu = deliproRequest_(client, 'index.php', { method: 'get' }).getContentText('UTF-8');
  folder.createFile('page_menu.html', menu, MimeType.HTML);
  const re = /<a[^>]*href="([^"#][^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
  const seen = {};
  let m, n = 0;
  while ((m = re.exec(menu)) !== null) {
    const href = m[1], text = m[2].replace(/<[^>]+>/g, '').trim();
    if (text.indexOf('分析') === -1 || /^javascript:/.test(href) || seen[href]) continue;
    seen[href] = true;
    const html = deliproRequest_(client, href.replace(/&amp;/g, '&'), { method: 'get' }).getContentText('UTF-8');
    folder.createFile('page_analysis_' + (++n) + '.html', html, MimeType.HTML);
    Logger.log('分析の画面: ' + text + ' → ' + href);
  }
  Logger.log('保存先: ' + folder.getUrl() + ' / 分析の画面 ' + n + '件');
}
