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

  // 毎日の「1週間スケジュール+やることリスト」メール(WeeklyDigest.gs)の設定
  DIGEST: {
    // 送信先(カンマ区切りで複数可)
    RECIPIENT: 'yoshida@lit-house.jp',
    // 送信する時刻(0〜23時)。installDigestTrigger() を実行すると、この時刻台に毎日送信されます
    SEND_HOUR: 7,
    // 今日から何日分を載せるか
    DAYS: 7,
    // 載せるカレンダー。TYPE が PROJECT のものは件名から「確定/未確定/キャンセル」を判定して集計します
    CALENDARS: [
      { LABEL: '吉田 裕紀', ID: 'yoshida@lit-house.jp', TYPE: 'PERSONAL' },
      {
        LABEL: 'Mr.BUFFET関西',
        ID: 'c_074feb03cd6e75fba2abc4b4f8aa87a09efaed5e76eff69eb7c7cb6558bbcb32@group.calendar.google.com',
        TYPE: 'PROJECT',
        // 大阪案件はカレンダー既定色(茶色)で登録されているため、色を個別に変えた予定(福岡・愛媛など)は除外する
        ONLY_DEFAULT_COLOR: true,
        // 色の付け忘れに備え、件名にこの地域タグがある予定も除外する
        EXCLUDE_TAGS: ['【福岡】', '【愛媛】'],
        // 1日に対応できる確定案件数の上限。確定が上限を超える日は「要人員調整」、未確定を足すと超える日は「注意」と表示する
        DAILY_CAPACITY: 5,
      },
    ],
    // Google ToDoリスト(カレンダー右側のToDo)を載せるか
    INCLUDE_TASKS: true,
    // 期限なしのToDoが、最終更新からこの日数を超えたら「停滞」と表示する
    STALE_TASK_DAYS: 7,
    // 件名が「キャンセル」で始まる案件をメールから除外するか(件数だけ末尾に表示)
    EXCLUDE_CANCELLED: true,
    // 個人カレンダーの終日予定にこの語が含まれる日は休日扱いにし、同じ日の予定を警告する
    HOLIDAY_KEYWORDS: ['公休', '有給', '休み'],
    // 未確定案件の件名・説明から「10/5午前中人数確定予定」のような期日を拾い、その日のやることとして表示する
    // 「重複の疑い」から外す会社名(連日の正しい案件など)。「株式会社」「様」・空白の有無は区別しない
    // 例: ['株式会社オリバー']
    DUPLICATE_IGNORE: [],
    // 前回送信時との違い(新規・変更・キャンセル・削除)を表示するか
    SHOW_CHANGES: true,
    FOLLOWUP_PATTERN: /(\d{1,2})\/(\d{1,2})[^\s※/]{0,12}?(確定|連絡|返答|回答|返事)(予定|待ち)/,
  },
};
