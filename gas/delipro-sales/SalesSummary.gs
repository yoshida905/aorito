/**
 * デリプロの確定注文を「注文区分×支払区分」で集計し、スプレッドシートに書き込む。
 * 金額はデリプロの「合計金額」(税込)。計上月は配達日の月。
 */

/** 今月1日〜今日の配達分を集計する(手動実行・毎朝の自動実行用) */
function summarizeThisMonth() {
  const today = Utilities.formatDate(new Date(), SALES_CONFIG.TIME_ZONE, 'yyyy-MM-dd');
  summarizeDeliproSales_(today.slice(0, 8) + '01', today);
}

/** 前月1日〜末日の配達分を集計する(月初の確定用) */
function summarizeLastMonth() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const last = new Date(now.getFullYear(), now.getMonth(), 0);
  const fmt = function (d) { return Utilities.formatDate(d, SALES_CONFIG.TIME_ZONE, 'yyyy-MM-dd'); };
  summarizeDeliproSales_(fmt(first), fmt(last));
}

function summarizeDeliproSales_(fromYmd, toYmd) {
  const cfg = SALES_CONFIG;
  const client = deliproLogin_();

  // 注文区分ごとに検索して、注文番号→区分名の対応を作る
  const typeOf = {};
  cfg.ORDER_TYPES.forEach(function (t) {
    deliproSearch_(client, fromYmd, toYmd, '0', '0', t.id).forEach(function (o) { typeOf[o.odid] = t.name; });
  });
  // 区分を指定しない検索(全件)。区分の付け漏れを見つけるため、こちらを正とする
  const ids = deliproSearch_(client, fromYmd, toYmd, '0', '0').map(function (o) { return o.odid; });

  const orders = ids.length ? parseDeliDownloadCsv_(deliproDownloadCsv_(client, ids)) : [];
  if (orders.length !== ids.length) {
    throw new Error('ダウンロードの件数が合いません(検索' + ids.length + '件・ダウンロード' + orders.length + '件)');
  }
  const summary = summarizeOrders_(orders, typeOf, cfg.ORDER_TYPES.map(function (t) { return t.name; }), cfg.PAYMENT_ORDER);
  writeSummarySheet_(fromYmd, toYmd, summary);
  Logger.log(fromYmd + '〜' + toYmd + ': ' + summary.count + '件 ' + summary.total + '円');
}

/** 集配管理の「ダウンロード」(注文ごと1行のCSV)を文字列で取得する */
function deliproDownloadCsv_(client, odids) {
  const res = deliproRequest_(client, 'deli_download.php', { method: 'post', payload: { odids: odids.join(','), user: 'dp0100' } });
  return res.getBlob().getDataAsString('Shift_JIS');
}
