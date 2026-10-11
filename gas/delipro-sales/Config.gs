/**
 * デリプロ売上集計(PLの売上欄)の設定。キッチン指示書メールとは別のApps Scriptプロジェクトで動かす。
 * デリプロのID・パスワードはここではなく、スクリプトプロパティに登録します(docs/delipro-sales.md)。
 */
const SALES_CONFIG = {
  // 調査用のダウンロードを保存するマイドライブのフォルダ名
  PROBE_FOLDER: 'delipro_probe',
  TIME_ZONE: 'Asia/Tokyo',
};
