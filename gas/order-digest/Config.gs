/**
 * デリプロ注文一覧メールの設定。実環境に合わせてここだけ書き換えれば動作します。
 */
const DIGEST_CONFIG = {
  // デリプロの見積書・発注請書PDFが保存されている親フォルダ「09_見積・受注書類」のID
  ROOT_FOLDER_ID: '1WaXwH4n1dzqUCCcIB_3U4OiDo5bBYHyv',

  // 探索しないフォルダ名(失注・過去分など)
  EXCLUDE_FOLDER_NAMES: ['失注', 'old'],

  // 案件フォルダ名の形式「MMDD_★顧客名」から開催日を読み取る正規表現
  CASE_FOLDER_PATTERN: /^(\d{2})(\d{2})[_＿]/,

  // 一覧に載せる期間: 今日から何日先まで
  DAYS_AHEAD: 7,

  // 大型案件だけはさらに先まで拾う(発注の前倒し用)。0にすると無効
  LARGE_LOOKAHEAD_DAYS: 21,

  // 大型案件の判定: この人数以上
  LARGE_HEADCOUNT: 50,

  // PDF添付: 'none' = リンクのみ / 'large' = 大型案件のみ添付 / 'all' = 全件添付
  ATTACH_MODE: 'large',
  // 添付の合計サイズ上限(Gmailの上限25MBに余裕を持たせる)
  ATTACH_MAX_BYTES: 18 * 1024 * 1024,

  // 送信先(カンマ区切りで複数可)
  MAIL_TO: 'buffet@lit-house.jp',
  // エラー通知とテスト送信の宛先
  ADMIN_EMAIL: 'yoshida@lit-house.jp',

  // 毎日の送信時刻(時)。GASの仕様上、この時刻から1時間以内のどこかで実行されます
  TRIGGER_HOUR: 7,

  // 1回の実行で解析に使う最大時間(ミリ秒)。GASの実行上限6分に対する安全マージン
  TIME_BUDGET_MS: 4.5 * 60 * 1000,

  // 解析結果キャッシュを保持する日数(同じPDFを毎日解析し直さないため)
  CACHE_RETENTION_DAYS: 45,

  TIME_ZONE: 'Asia/Tokyo',
};
