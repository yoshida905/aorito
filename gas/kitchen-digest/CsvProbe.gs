/**
 * 調査用(1回だけ実行): 今月1日〜今日に配達した確定注文で、集配管理の3種類のダウンロード
 * (ダウンロード / 明細DL / 発注書DL)を取得し、マイドライブの「delipro_probe」フォルダにそのまま保存する。
 * PLの売上(注文区分×支払方法×税率)を自動集計するために、CSVの列を確認する目的で使う。
 */
function probeDeliproCsv() {
  const cfg = KITCHEN_CONFIG;
  const today = Utilities.formatDate(new Date(), cfg.TIME_ZONE, 'yyyy-MM-dd');
  const first = today.slice(0, 8) + '01';
  const client = deliproLogin_();
  const orders = deliproSearch_(client, first, today, '0', '0');
  const ids = orders.map(function (o) { return o.odid; });
  if (!ids.length) throw new Error('対象の注文がありません');

  const it = DriveApp.getFoldersByName('delipro_probe');
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder('delipro_probe');
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
 * 調査用(1回だけ実行): 今日〜7日先の大阪の注文で集配一覧PDFを取得し、PDFと読み取った文字を
 * 「delipro_probe」フォルダに保存する。配車・出発時間の読み取りが正しいかの確認に使う。
 */
function probeDeliSheet() {
  const cfg = KITCHEN_CONFIG;
  const today = Utilities.formatDate(new Date(), cfg.TIME_ZONE, 'yyyy-MM-dd');
  const client = deliproLogin_();
  const ids = deliproSearch_(client, today, kAddDays_(today, cfg.DAYS_AHEAD), '0', cfg.OFFICES[0].id)
    .map(function (o) { return o.odid; });
  if (!ids.length) throw new Error('対象の注文がありません');
  const pdf = deliproDeliSheetPdf_(client, ids);
  const text = extractPdfText_(pdf.getBytes());
  const it = DriveApp.getFoldersByName('delipro_probe');
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder('delipro_probe');
  folder.createFile(pdf.setName('deli_sheet_' + ids.length + '件.pdf'));
  folder.createFile('deli_sheet_text_' + ids.length + '件.txt', text + '\n\n---- 読み取り結果 ----\n' +
    JSON.stringify(parseDeliSheetText_(text), null, 1));
  Logger.log('保存先: ' + folder.getUrl());
}
