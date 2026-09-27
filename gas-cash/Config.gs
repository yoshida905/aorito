/**
 * 現金管理(金庫)の設定ファイル。実際の運用に合わせてここだけ書き換えれば動作します。
 *
 * 金庫の中身は3つに分けて管理する:
 * - 釣銭ポーチ: 現場に持っていく釣銭。金額は固定(1万円×5個)
 * - 金庫金: 購入の現金払いに使うお金。基準額(10万円)まで補充して使う
 * - 売上封筒: ケータリング・オードブルの現金売上。支払いには使わず、全額を銀行へ入金する
 */
const CASH_CONFIG = {
  // 釣銭ポーチ
  POUCH_COUNT: 5,
  POUCH_AMOUNT: 10000,

  // 金庫金の基準額(補充するときは、この額に戻す)
  FUND_BASE: 100000,
  // 金庫金の残高がこの額を下回ったら、補充依頼のメールを送る
  FUND_LOW_ALERT: 30000,

  // 売上封筒を受け取ってからこの日数を超えて金庫に残っていたら、週次メールで警告する
  ENVELOPE_ALERT_DAYS: 14,

  // 週次メール(金庫確認の前に「あるべき金額」を知らせる)の曜日と時刻
  WEEKLY_REPORT_DAY: 'MONDAY', // SUNDAY〜SATURDAY
  WEEKLY_REPORT_HOUR: 9,

  // 通知の宛先(カンマ区切りで複数可)
  NOTIFY_EMAILS: 'yoshida@lit-house.jp',

  // 担当者名の選択肢。空のままなら自由入力になる(表記ゆれを防ぐため、登録を推奨)
  STAFF_NAMES: [],

  FORM_TITLE: '金庫 現金の出し入れ登録',

  // フォームの質問タイトル。namedValues のキーになるため、フォーム内で重複させないこと
  Q: {
    KIND: '登録の種類',
    STAFF: '担当者',

    PAY_DATE: '支払った日',
    PAY_AMOUNT: '支払った金額(円)',
    PAY_DESC: '支払先・購入したもの',
    PAY_RECEIPT: 'レシート・領収書',

    SALE_DATE: '売上金を受け取った日',
    SALE_AMOUNT: '受け取った金額(円)',
    SALE_DESC: '案件名・お客様名',
    SALE_TYPE: '売上の区分',

    DEPOSIT_DATE: '銀行に入金した日',
    DEPOSIT_ENVELOPES: '入金した売上封筒',
    DEPOSIT_AMOUNT: '銀行に入金した合計額(円)',

    REFILL_DATE: '補充した日',
    REFILL_AMOUNT: '補充した金額(円)',
    REFILL_SOURCE: '補充したお金の出どころ',
  },

  // 「登録の種類」の選択肢
  KINDS: {
    PAY: '支払い(金庫金から現金で払った)',
    SALE: '売上金を受け取った(茶封筒に入れて金庫へ)',
    DEPOSIT: '売上封筒を銀行に入金した',
    REFILL: '金庫金を補充した',
  },

  SHEETS: {
    LEDGER: '入出金台帳',
    BALANCE: '残高',
  },
};

// 入出金台帳の列(この順で書き込む)
const LEDGER_HEADERS = [
  '記録ID', '登録日時', '日付', '種類', '置き場所', '入金', '出金',
  '内容', '担当者', 'レシート', '封筒の状態', '銀行入金日', 'メモ',
];
const LEDGER_KEYS = [
  'id', 'createdAt', 'date', 'type', 'place', 'amountIn', 'amountOut',
  'desc', 'staff', 'receipt', 'status', 'depositDate', 'memo',
];

const PLACE = { FUND: '金庫金', ENVELOPE: '売上封筒' };
const ENVELOPE_STATUS = { KEPT: '金庫に保管中', DEPOSITED: '銀行入金済' };
const NO_ENVELOPE_CHOICE = '(金庫に保管中の売上封筒はありません)';
