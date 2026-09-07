/**
 * 設定ファイル。実際の環境に合わせてここだけ書き換えれば動作します。
 */
const CONFIG = {
  // 案件管理スプレッドシート(既存の案件管理シート)への連携設定
  PROJECT_SHEET: {
    // 案件管理スプレッドシートのID(URLの https://docs.google.com/spreadsheets/d/【ここ】/edit の部分)
    SPREADSHEET_ID: '',
    // 案件一覧が入っているシート名
    SHEET_NAME: '案件一覧',
    // 案件管理シート側のヘッダー名(実際のシートのヘッダー行に合わせて調整してください)
    COLUMNS: {
      PROJECT_NAME: '案件名',
      SURVEY_STATUS: 'アンケート回収',
      SURVEY_SUMMARY: '現場振り返りメモ',
      SURVEY_URGENT: '要対応フラグ',
    },
  },

  // フォーム側の質問タイトル(docs/form-questions.md のNo.列と対応)
  // Googleフォームの質問文をそのままキーの値として設定してください
  FORM_COLUMNS: {
    PROJECT_NAME: '案件名',
    EVENT_DATE: '実施日',
    VENUE: '会場',
    RESPONDENT: '回答者(あなたの名前)',
    STAFF: '現場担当スタッフ',
    SETUP_SCORE: '準備・搬入はスムーズだったか',
    GOOD_POINTS: '良かった点',
    IMPROVEMENTS: '改善が必要な点・気づき',
    TROUBLE: '現場で発生したトラブル・ハプニング',
    SUPPLY_BALANCE: '備品・食材の過不足',
    SUPPLY_DETAIL: '過不足の詳細',
    HEADCOUNT: '実際の来場者数/喫食数',
    FOOD_LOSS: '食材ロス量の目安',
    EXTRA_ORDER: '追加発注・追加対応の有無',
    EXTRA_ORDER_DETAIL: '追加発注・追加対応の内容',
    CLIENT_REACTION: 'クライアントの反応',
    CLIENT_COMMENT: 'クライアントからの追加要望・コメント',
    NEXT_ORDER_LIKELIHOOD: '次回受注の見込み',
    CLAIM_FLAG: 'クレーム・要対応事項の有無',
    CLAIM_DETAIL: 'クレーム・要対応事項の内容',
  },

  // 「クレーム・要対応事項の有無」がこの値のとき緊急メール通知する
  CLAIM_FLAG_VALUE: 'あり(要対応)',

  // 緊急通知・エラー通知の宛先(カンマ区切りで複数可)
  NOTIFY_EMAILS: 'yoshida@lit-house.jp',

  // 案件管理シートに一致する案件名が見つからなかった場合の記録先(自動作成)
  UNMATCHED_LOG_SHEET_NAME: '未突合ログ',
};
