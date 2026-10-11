/**
 * キッチン指示書メールの設定。実環境に合わせてここだけ書き換えれば動作します。
 */
const KITCHEN_CONFIG = {
  // デリプロからダウンロードしたキッチン指示書(注文別:メイン)PDFを置くフォルダのID
  INBOX_FOLDER_ID: '',
  // キッチン指示書のファイル名(デリプロの出力は kitchen_YYMMDDhhmm.pdf)
  FILE_NAME_PATTERN: /^kitchen_.*\.pdf/i,
  // この時間より古いPDFしかなければ「本日分が未保存」として警告する
  MAX_FILE_AGE_HOURS: 20,

  // 一覧に載せる期間: 今日から何日先まで
  DAYS_AHEAD: 7,
  // 大型案件の判定: この人数以上
  LARGE_HEADCOUNT: 50,

  // 送信先(カンマ区切りで複数可)
  MAIL_TO: 'buffet@lit-house.jp',
  // エラー通知とテスト送信の宛先
  ADMIN_EMAIL: 'yoshida@lit-house.jp',
  // 毎日の送信時刻(時)。GASの仕様上、この時刻から1時間以内のどこかで実行されます
  TRIGGER_HOUR: 7,

  TIME_ZONE: 'Asia/Tokyo',
};
