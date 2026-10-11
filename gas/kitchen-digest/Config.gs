/**
 * キッチン指示書メールの設定。実環境に合わせてここだけ書き換えれば動作します。
 * デリプロのID・パスワードはここではなく、スクリプトプロパティに登録します(docs/kitchen-digest.md)。
 */
const KITCHEN_CONFIG = {
  // 集配管理の「受付」で絞り込む事業所ID。'0'=すべて / '8'=東京 / '9'=大阪 / '24'=東海 / '22'=福岡・山口 / '23'=愛媛
  OFFICE_ID: '9',

  // 一覧に載せる期間: 今日から何日先まで
  DAYS_AHEAD: 7,
  // 大型案件だけはさらに先まで拾う(発注の前倒し用)。0にすると無効
  LARGE_LOOKAHEAD_DAYS: 21,
  // 大型案件の判定: この人数以上
  LARGE_HEADCOUNT: 50,

  // 送信先(カンマ区切りで複数可)
  MAIL_TO: 'buffet@lit-house.jp',
  // エラー通知とテスト送信の宛先
  ADMIN_EMAIL: 'yoshida@lit-house.jp',
  // 毎日の送信時刻(時)。GASの仕様上、この時刻から1時間以内のどこかで実行されます
  TRIGGER_HOUR: 7,

  // PDF読み取りの小分け: 1回に読む注文数と、読み取りの間隔(ミリ秒)
  OCR_CHUNK_SIZE: 10,
  OCR_INTERVAL_MS: 3000,

  TIME_ZONE: 'Asia/Tokyo',
};
