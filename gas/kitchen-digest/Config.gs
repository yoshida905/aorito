/**
 * キッチン指示書メールの設定。実環境に合わせてここだけ書き換えれば動作します。
 * デリプロのID・パスワードはここではなく、スクリプトプロパティに登録します(docs/kitchen-digest.md)。
 */
const KITCHEN_CONFIG = {
  // 送信する事業所の一覧。集配管理の「受付」の事業所IDごとに1通ずつ送る。
  // 送信先はコードに書かず、mailToProperty に書いた名前のスクリプトプロパティにカンマ区切りで登録する
  // (GitHubが公開設定のため、社員のメールアドレスを載せない)。
  // 送信先が未登録の事業所は送らない(東京・東海は宛先を登録した日から送られる)
  // 事業所ID: '8'=東京 / '9'=大阪 / '24'=東海 / '22'=福岡・山口 / '23'=愛媛
  OFFICES: [
    { id: '9', title: '大阪キッチン指示書', mailToProperty: 'MAIL_TO' },
    { id: '8', title: '東京キッチン指示書', mailToProperty: 'MAIL_TO_TOKYO' },
    { id: '24', title: '東海キッチン指示書', mailToProperty: 'MAIL_TO_TOKAI' },
  ],

  // 一覧に載せる期間: 今日から何日先まで
  DAYS_AHEAD: 7,
  // 大型案件だけはさらに先まで拾う(発注の前倒し用)。0にすると無効
  LARGE_LOOKAHEAD_DAYS: 21,
  // 大型案件の判定: この人数以上
  LARGE_HEADCOUNT: 50,

  // 保留でも色分けしない(保留件数にも数えない)お客様。名前の一部で判定
  // 南海は3日前に数量が確定する運用のため、保留が通常状態
  NO_PENDING_HIGHLIGHT_CLIENTS: ['南海電気鉄道'],

  // 受注(人数・メニュー確定)の締切: 配達日の何日前か。プラン名の先頭の記号で判定する
  // (C)=ケータリング 5日前 / (H)=オードブル 3日前 / どちらもない注文は DEFAULT
  ORDER_DEADLINE_DAYS: { C: 5, H: 3, DEFAULT: 3 },
  // 保留のまま、受注締切まであと何日以内(締切超過を含む)になったら「確定の催促」に出すか
  PENDING_ALERT_MARGIN_DAYS: 2,

  // エラー通知とテスト送信の宛先
  ADMIN_EMAIL: 'yoshida@lit-house.jp',
  // 毎日の送信時刻(時)。GASの仕様上、この時刻から1時間以内のどこかで実行されます
  TRIGGER_HOUR: 7,

  TIME_ZONE: 'Asia/Tokyo',
};
