// デリプロ売上集計(gas/delipro-sales の全ファイルを1つにまとめたもの)
// このファイルの中身を Apps Script のコード.gs に丸ごと貼り付けてください

// ===== Config.gs =====
/**
 * デリプロ売上集計(PLの売上欄)の設定。キッチン指示書メールとは別のApps Scriptプロジェクトで動かす。
 * デリプロのID・パスワードはここではなく、スクリプトプロパティに登録します(docs/delipro-sales.md)。
 */
const SALES_CONFIG = {
  // 集計する注文区分。id は集配管理の検索条件「注文区分」の値
  ORDER_TYPES: [
    { id: '4', name: '大阪直販' },
    { id: '5', name: '大阪CS' },
    { id: '6', name: '大阪ごちクル' },
    { id: '12', name: '大阪南海' },
    { id: '1', name: '東京直販' },
    { id: '2', name: '東京CS' },
    { id: '3', name: '東京ごちクル' },
    { id: '9', name: '東海直販' },
    { id: '11', name: '東海CS' },
    { id: '10', name: '東海ごちくる' },
    { id: '15', name: '東海結膳' },
    { id: '13', name: '東海ROK' },
    { id: '14', name: '東海卸' },
    { id: '7', name: '山口/福岡' },
    { id: '8', name: '愛媛' },
  ],
  // 集計表の支払区分の並び。ここに無い支払区分が出たら右端に自動で足す
  PAYMENT_ORDER: ['現金', 'クレジットカード', '請求書', 'Cqree代理請求', 'ごちくる代理請求', '未定'],

  // 集計結果を書き込むスプレッドシート。初回実行時に自動で作り、IDをスクリプトプロパティ SALES_SHEET_ID に保存する
  SHEET_NAME: 'デリプロ売上集計',

  // PL(事業別PL)の売上欄の並び。PL転記用のシートは、ここに書いた行番号どおりに数字を置く
  // (PL側は同じシート名・同じセル番地を IMPORTRANGE で参照すればよい)。
  // 支払区分はデリプロの名前で書く。r10/r8/r0 = 10%・8%・0%対象(税込)、ex = 計(税抜)
  // 月の列: PL_FIRST_MONTH 月が PL_FIRST_COLUMN 列で、1か月ごとに2列ずつ右へ
  PL_FIRST_MONTH: 3,
  PL_FIRST_COLUMN: 'D',
  PL_LAYOUT: [
    { sheet: 'PL_Mr.BUFFET_関西', blocks: [
      { type: '大阪直販', rows: { 現金: 3, クレジットカード: 4, 請求書: 5, 未定: 6, r10: 7, r8: 8, r0: 9, ex: 10 } },
      { type: '大阪CS', rows: { 現金: 11, クレジットカード: 12, 請求書: 13, Cqree代理請求: 14, r10: 15, r8: 16, ex: 17 } },
      { type: '大阪ごちクル', rows: { 現金: 18, クレジットカード: 19, 請求書: 20, ごちくる代理請求: 21, r10: 22, r8: 23, ex: 24 } },
    ] },
    { sheet: 'PL_南海(グラン天空)', blocks: [
      // 南海のPLには「未定」の欄がないため、請求書の欄に含める(2026/8・9月の手入力と同じ扱い)
      { type: '大阪南海', rows: { 請求書: 25, 未定: 25, r8: 26, ex: 27 } },
    ] },
    { sheet: 'PL_Mr.BUFFET_東京', blocks: [
      { type: '東京直販', rows: { 現金: 3, クレジットカード: 4, 請求書: 5, r10: 6, r8: 7, ex: 8 } },
      { type: '東京CS', rows: { 現金: 9, クレジットカード: 10, 請求書: 11, Cqree代理請求: 12, r10: 13, r8: 14, ex: 15 } },
      { type: '東京ごちクル', rows: { 現金: 16, クレジットカード: 17, 請求書: 18, ごちくる代理請求: 19, r10: 20, r8: 21, ex: 22 } },
    ] },
    // 東海は消費税の行の入れ方(対象額か税額か)が未確認のため、支払区分と税抜だけ
    { sheet: 'PL_Mr.BUFFET_東海', blocks: [
      { type: '東海直販', rows: { 現金: 3, クレジットカード: 4, 請求書: 5, ex: 8 } },
      { type: '東海CS', rows: { 現金: 9, クレジットカード: 10, 請求書: 11, Cqree代理請求: 12, ex: 15 } },
      { type: '東海ごちくる', rows: { 現金: 16, クレジットカード: 17, 請求書: 18, ごちくる代理請求: 19, ex: 22 } },
      { type: '東海結膳', rows: { 現金: 23, クレジットカード: 24, 請求書: 25, Cqree代理請求: 26, ex: 28 } },
      { type: '東海ROK', rows: { 現金: 29, クレジットカード: 30, 請求書: 31, ex: 33 } },
    ] },
  ],

  // comparePlMonths の「PL照合まとめ」に載せるPLのシート(PLの数式を自動にしたもの)
  COMPARE_SUMMARY_SHEETS: ['PL_Mr.BUFFET_関西', 'PL_南海(グラン天空)'],

  // 毎朝の自動実行の時刻(時)。GASの仕様上、この時刻から1時間以内のどこかで実行される
  TRIGGER_HOUR: 6,
  // 月初の何日間、前月分も更新して「保留が残っていないか」を確認するか
  CLOSE_CHECK_DAYS: 5,

  // インフォマートの仕入れ(買掛)のCSV → PLの食材費・資材費の欄(importInfomartCsv)。
  // 金額は伝票の［総合計］(インフォマートでは消費税0円で登録されているため税抜と同じ)。計上月は［伝票日付］の月
  // 事業所の決め方: 取引先の行が1つの事業所にしかなければその事業所。両方にある取引先は［自社担当者］で分ける。
  // 例外は集計用スプレッドシートの「インフォマート振替」シートに伝票Noで書く(振替先: 関西 / 南海 / 除外)
  INFOMART: {
    FOLDER: 'infomart_csv', // CSVを置くマイドライブのフォルダ(スクリプトプロパティ INFOMART_FOLDER_ID があればそちら)。
    // インフォマートのCSVでないもの(見出しに［データ区分］がない)は読み飛ばす
    SITES: { 関西: 'PL_Mr.BUFFET_関西', 南海: 'PL_南海(グラン天空)' },
    // linkPlInfomartFormulas でPLの欄を自動(IMPORTRANGE)に切り替える事業所。南海は手入力との差の原因が分かってから足す
    LINK_SITES: ['関西'],
    PERSONS: { 吉田裕紀: '関西', 花川瑞紀: '南海' }, // 名前の空白は無視して照合する
    SUPPLIERS: [
      { match: '広栄', item: '広栄', rows: { 関西: 66, 南海: 66 } },
      { match: '日本食研', item: '日本食研', rows: { 関西: 69, 南海: 67 } },
      { match: 'ベジプラス', item: 'ベジプラス', rows: { 関西: 71, 南海: 68 } },
      { match: '三和物産', item: '三和物産', rows: { 関西: 72 } },
      { match: '山久', item: '山久', rows: { 関西: 73 } },
      { match: 'LightHouseiRene', item: '食材費(社内卸)本町SB(iRene)', rows: { 関西: 77 } },
      { match: 'タムラ容器', item: '資材費 タムラ容器', rows: { 関西: 90 } },
      { match: '日本パッケージ', item: '資材費 日本パッケージ', rows: { 関西: 93 } },
      { match: '比那フーズ', item: '比那フーズ', rows: { 南海: 70 } },
      { match: '肉のふじた', item: '肉のふじた', rows: { 南海: 71 } },
      { match: '源氏', item: 'GENJI(源氏)', rows: { 南海: 72 } },
      { match: '和田商店', item: '和田商店', rows: { 南海: 73 } },
      { match: 'プリュスプリュス', item: 'プリュスプリュス', rows: { 南海: 75 } },
      { match: 'シンポフーズ', item: 'シンポフーズ', rows: { 南海: 76 } },
      { match: 'スタイルブレッド', item: 'スタイルブレッド', rows: { 南海: 78 } },
      { match: '全笑', item: '全笑平野清椒庵', rows: { 南海: 79 } },
      { match: 'かつらぎ産業', item: 'かつらぎ産業', rows: { 南海: 80 } },
    ],
  },

  // アルバイト人件費(PLの111・112行)。CSVを置くフォルダは LABOR.FOLDER(スクリプトプロパティ LABOR_FOLDER_ID があればそちら)
  LABOR: {
    FOLDER: 'payroll_csv',
    // タイミーの利用明細のCSV → 112行。金額は［合計報酬額］(利用料は含めない)。計上月は［求人日］の月
    // 事業所は［求人タイトル］で決める(上から順に、最初に含まれていた言葉)
    // マネーフォワード クラウド勤怠の「日次勤怠」のCSV → 111行。金額は 総労働時間×時給 ＋ 法定外×時給×0.25
    // ＋ 深夜×時給×0.25 ＋ 交通費(1日あたり×出勤日数、または月額)。計上月は日付の月(働いた月)
    // 時給・交通費は payroll_csv フォルダのスプレッドシート「時給表」に書く(集計用スプレッドシートには書かない)
    // 事業所はファイル名で決める(上から順に、最初に含まれていた言葉)。時給表の「事業所」欄があればそちらを優先
    ATTENDANCE: {
      ROW: 111,
      FILE_RULES: [
        { match: '南海', site: '南海' },
        { match: '大阪GB', site: '関西' },
        { match: '関西', site: '関西' },
      ],
      OVERTIME_RATE: 0.25,
      NIGHT_RATE: 0.25,
      WAGE_SHEET: '時給表',
    },
    TIMEE: {
      ROW: 112,
      // 利用料(税抜)を入れる行(アルバイト人件費の113行)
      FEE_ROWS: { 関西: 113, 南海: 113 },
      RULES: [
        { match: '盛付', site: '関西' },
        { match: '盛り付け', site: '関西' },
        { match: '食器洗浄', site: '南海' },
        { match: '洗い物', site: '南海' },
      ],
    },
  },

  // 調査用のダウンロードを保存するマイドライブのフォルダ名
  PROBE_FOLDER: 'delipro_probe',
  TIME_ZONE: 'Asia/Tokyo',
};

// ===== SalesParser.gs =====
/**
 * デリプロの「ダウンロード」CSVの解析と集計(純粋関数。Node.jsでもテストできる: tests/delipro-sales.test.js)。
 */

/**
 * 1行目は「注文データ：,作成日時,…」、2行目が見出し。列は見出しの名前で探す。
 * @return {{odid:string, company:string, payment:string, amount:number}[]}
 */
function parseDeliDownloadCsv_(text) {
  const rows = parseCsv_(text);
  const h = rows.findIndex(function (r) { return r.indexOf('注文番号') !== -1 && r.indexOf('合計金額') !== -1; });
  if (h === -1) throw new Error('ダウンロードCSVの見出し(注文番号・合計金額)が見つかりません。デリプロの仕様変更の可能性があります');
  const col = function (name) {
    const i = rows[h].indexOf(name);
    if (i === -1) throw new Error('ダウンロードCSVに「' + name + '」の列がありません');
    return i;
  };
  const cId = col('注文番号'), cPay = col('支払区分'), cAmt = col('合計金額');
  const cName = rows[h].indexOf('会社名');
  return rows.slice(h + 1).filter(function (r) { return r[cId]; }).map(function (r) {
    return { odid: r[cId], company: cName === -1 ? '' : r[cName], payment: r[cPay] || '(空欄)', amount: Number(String(r[cAmt]).replace(/,/g, '')) || 0 };
  });
}

/**
 * @param typeOf 注文番号→注文区分名。無い注文は「区分なし」に入れる
 * @return {{types:string[], payments:string[], cells:Object, rowTotal:Object, rowCount:Object, colTotal:Object, total:number, count:number}}
 */
function summarizeOrders_(orders, typeOf, typeOrder, paymentOrder) {
  const NONE = '区分なし';
  const cells = {}, rowTotal = {}, rowCount = {}, colTotal = {};
  const payments = paymentOrder.slice();
  let total = 0;
  orders.forEach(function (o) {
    const t = typeOf[o.odid] || NONE;
    if (payments.indexOf(o.payment) === -1) payments.push(o.payment);
    cells[t] = cells[t] || {};
    cells[t][o.payment] = (cells[t][o.payment] || 0) + o.amount;
    rowTotal[t] = (rowTotal[t] || 0) + o.amount;
    rowCount[t] = (rowCount[t] || 0) + 1;
    colTotal[o.payment] = (colTotal[o.payment] || 0) + o.amount;
    total += o.amount;
  });
  const types = typeOrder.concat(rowCount[NONE] ? [NONE] : []);
  return { types: types, payments: payments, cells: cells, rowTotal: rowTotal, rowCount: rowCount, colTotal: colTotal, total: total, count: orders.length };
}

const TAX_KEYS = ['r10', 'r8', 'r0', 'exTax'];

/**
 * 集計結果を表(2次元配列)にする。1行目が見出し、最終行が合計。
 * s.tax(注文区分名→売上分析(期間)の税率別の金額)があれば、税率別の列と、支払区分別の合計との照合の列を足す
 */
function summaryToTable_(s) {
  const head = ['注文区分', '件数'].concat(s.payments, ['合計(税込)']);
  const withTax = !!s.tax;
  const zero = { total: 0, exTax: 0, r10: 0, r8: 0, r0: 0 };
  const taxRow = function (total, t) {
    if (!withTax) return [];
    const diff = total - t.total;
    return TAX_KEYS.map(function (k) { return t[k]; }).concat([diff === 0 ? '一致' : '差 ' + diff]);
  };
  const table = [withTax ? head.concat(['10%対象(税込)', '8%対象(税込)', '0%対象', '税抜', '照合']) : head];
  const sumTax = Object.assign({}, zero);
  const types = s.types.slice();
  if (withTax && s.tax['区分なし'] && s.tax['区分なし'].total && types.indexOf('区分なし') === -1) types.push('区分なし');
  types.forEach(function (t) {
    const c = s.cells[t] || {};
    const tx = (withTax && s.tax[t]) || zero;
    Object.keys(sumTax).forEach(function (k) { sumTax[k] += tx[k]; });
    table.push([t, s.rowCount[t] || 0].concat(s.payments.map(function (p) { return c[p] || 0; }), [s.rowTotal[t] || 0], taxRow(s.rowTotal[t] || 0, tx)));
  });
  table.push(['合計', s.count].concat(s.payments.map(function (p) { return s.colTotal[p] || 0; }), [s.total], taxRow(s.total, sumTax)));
  return table;
}

/** 売上分析(期間)の結果を、注文区分ごとに足し合わせる(確定＋保留の表用) */
function addTax_(a, b) {
  const out = {};
  Object.keys(a).concat(Object.keys(b)).forEach(function (t) {
    const x = a[t] || {}, y = b[t] || {};
    out[t] = {};
    ['total'].concat(TAX_KEYS).forEach(function (k) { out[t][k] = (x[k] || 0) + (y[k] || 0); });
  });
  return out;
}

/** ダブルクォート・改行入りのセルに対応した最小限のCSV解析 */
function parseCsv_(text) {
  const s = String(text || '').replace(/^﻿/, '');
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

if (typeof module !== 'undefined') module.exports = { parseDeliDownloadCsv_, summarizeOrders_, summaryToTable_, addTax_, parseCsv_ };

// ===== TaxParser.gs =====
/**
 * デリプロ「売上分析(期間)」(analyze_sale_time.php)の画面から、注文合計と税率別の金額を読む(純粋関数)。
 * 画面の表示: 注文合計 8,504,047 / 税抜: 7,801,630 / (10%対象 5,809,360) (8%対象 2,352,710) (0%対象 341,977)
 * 税率別の金額は税込。該当がない税率は画面に出ないので0とする。
 * @return {{total:number, exTax:number, r10:number, r8:number, r0:number}}
 */
function parseTaxSummary_(html) {
  const text = String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  const num = function (re) {
    const m = text.match(re);
    return m ? Number(m[1].replace(/,/g, '')) : null;
  };
  const m = text.match(/注文合計 客単価 点単価 ([\d,]+) ([\d,]+) ([\d,]+) ([\d,]+) 税抜\s*[:：]\s*([\d,]+)/);
  if (!m) throw new Error('売上分析(期間)の画面から注文合計を読めませんでした。デリプロの画面の仕様変更の可能性があります');
  const r = {
    total: Number(m[4].replace(/,/g, '')),
    exTax: Number(m[5].replace(/,/g, '')),
    r10: num(/10\s*[%％]\s*対象\s*([\d,]+)/) || 0,
    r8: num(/8\s*[%％]\s*対象\s*([\d,]+)/) || 0,
    r0: num(/(?:^|[^0-9])0\s*[%％]\s*対象\s*([\d,]+)/) || 0,
  };
  if (r.r10 + r.r8 + r.r0 !== r.total) {
    throw new Error('売上分析(期間)の税率別の合計(' + (r.r10 + r.r8 + r.r0) + ')が注文合計(' + r.total + ')と合いません');
  }
  return r;
}

/**
 * 返ってきた画面の検索条件の欄で、選ばれている値を読む(送った条件が効いたかの確認用)
 * @return {{daytype:string[], odtype:string[], odstatus:string[]}} それぞれ選ばれているoptionのvalue
 */
function parseTaxForm_(html) {
  const s = String(html || '');
  const sel = function (name) {
    const m = s.match(new RegExp('<select[^>]*name="' + name.replace(/[[\]]/g, '\\$&') + '"[\\s\\S]*?</select>'));
    if (!m) return [];
    const out = [];
    const re = /<option value="([^"]*)"([^>]*)>/g;
    let o;
    while ((o = re.exec(m[0])) !== null) if (/selected/.test(o[2])) out.push(o[1]);
    return out;
  };
  return { daytype: sel('daytype'), odtype: sel('odtype[]'), odstatus: sel('odstatus') };
}

if (typeof module !== 'undefined') module.exports = { parseTaxSummary_, parseTaxForm_ };

// ===== PlLayout.gs =====
/**
 * 集計結果を、PL(事業別PL)の売上欄と同じ行・列に並べる(純粋関数。tests/delipro-sales.test.js)。
 */

/** 'yyyy-MM' の月が、PLの何列目(1始まり)か */
function plColumnOf_(ym, firstMonth, firstColumn) {
  const m = Number(ym.slice(5, 7));
  const idx = (m - firstMonth + 12) % 12;
  return firstColumn.charCodeAt(0) - 64 + idx * 2;
}

/**
 * @param summary summarizeOrders_ の結果(tax 付き)
 * 同じ行番号を複数の項目に書いたときは、その行に合計を置く(例: 南海は「未定」も請求書の行に入れる)
 * @return {{cells:{sheet:string,row:number,value:number}[], unmapped:{type:string,item:string,amount:number}[]}}
 *   unmapped はPLに置き場所がない金額(例: 東京直販の「未定」)。PLに載らず漏れるので知らせる
 */
function buildPlCells_(summary, layout) {
  const cells = [], unmapped = [];
  const placed = {};
  const at = {}; // 同じセルに複数の項目を割り当てたとき(例: 南海の請求書と未定)は足し合わせる
  layout.forEach(function (sh) {
    sh.blocks.forEach(function (b) {
      placed[b.type] = true;
      const c = summary.cells[b.type] || {};
      const tx = (summary.tax && summary.tax[b.type]) || { r10: 0, r8: 0, r0: 0, exTax: 0 };
      Object.keys(b.rows).forEach(function (key) {
        const value = key === 'ex' ? tx.exTax : /^r(10|8|0)$/.test(key) ? tx[key] : (c[key] || 0);
        const k = sh.sheet + '!' + b.rows[key];
        if (k in at) { at[k].value += value; return; }
        at[k] = { sheet: sh.sheet, row: b.rows[key], value: value };
        cells.push(at[k]);
      });
      Object.keys(c).forEach(function (p) {
        if (!(p in b.rows) && c[p]) unmapped.push({ type: b.type, item: p, amount: c[p] });
      });
      if (!('r0' in b.rows) && tx.r0) unmapped.push({ type: b.type, item: '0%対象', amount: tx.r0 });
    });
  });
  // PLに欄がない注文区分(例: 東海卸・山口/福岡・愛媛・区分なし)
  summary.types.forEach(function (t) {
    if (!placed[t] && summary.rowTotal[t]) unmapped.push({ type: t, item: '合計', amount: summary.rowTotal[t] });
  });
  return { cells: cells, unmapped: unmapped };
}

if (typeof module !== 'undefined') module.exports = { plColumnOf_, buildPlCells_ };

// ===== SalesSummary.gs =====
/**
 * デリプロの確定注文を「注文区分×支払区分」で集計し、スプレッドシートに書き込む。
 * 金額はデリプロの「合計金額」(税込)。計上月は配達日の月。確定・保留・その合計の3つの表を出す。
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

/**
 * 毎朝の自動実行(setupSalesTrigger で登録)。今月分を更新し、月初の数日は前月分も更新して締めの確認をする。
 * 次のどれかがあれば、通知先にメールを送る(何もなければ送らない)
 * - 前月分に保留の注文が残っている(月初 CLOSE_CHECK_DAYS 日間のみ)
 * - 注文区分が未設定の注文がある / 支払区分別の合計と売上分析の合計が合わない
 */
function dailySalesJob() {
  const cfg = SALES_CONFIG;
  try {
    const now = new Date();
    const fmt = function (d) { return Utilities.formatDate(d, cfg.TIME_ZONE, 'yyyy-MM-dd'); };
    const today = fmt(now);
    const issues = [];
    if (Number(today.slice(8, 10)) <= cfg.CLOSE_CHECK_DAYS) {
      const from = fmt(new Date(now.getFullYear(), now.getMonth() - 1, 1));
      const r = summarizeDeliproSales_(from, fmt(new Date(now.getFullYear(), now.getMonth(), 0)));
      if (r.pendingOrders.length) {
        issues.push('【' + from.slice(0, 7) + '・締め前の確認】保留のままの注文が' + r.pendingOrders.length + '件あります。確定か取消にしてください');
        r.pendingOrders.forEach(function (o) { issues.push('  No.' + o.odid + ' ' + o.company + ' ' + o.amount.toLocaleString() + '円'); });
      }
      issues.push.apply(issues, r.problems.map(function (m) { return '【' + from.slice(0, 7) + '】' + m; }));
    }
    const r = summarizeDeliproSales_(today.slice(0, 8) + '01', today);
    issues.push.apply(issues, r.problems.map(function (m) { return '【' + today.slice(0, 7) + '】' + m; }));
    // インフォマートのCSVが新しく置かれていたら取り込む(月1回)。取り込んだときは結果を知らせる
    try {
      const im = infomartDailyCheck_();
      if (im) {
        issues.push('【インフォマート】CSVを取り込みました(' + im.months.join(',') + ')。「仕入_yyyy-MM」シートを確認してください');
        im.unmapped.forEach(function (u) {
          issues.push('  PLに入っていない伝票: No.' + u.no + ' ' + u.date + ' ' + u.supplier + ' ' + u.amount.toLocaleString() + '円(' + u.reason + ')');
        });
      }
    } catch (e) {
      issues.push('【インフォマート】取り込みでエラー: ' + e);
    }
    try {
      const lb = laborDailyCheck_();
      if (lb) {
        issues.push('【人件費】勤怠・タイミーのCSVを取り込みました(' + lb.months.join(',') + ')。「人件費_yyyy-MM」シートを確認してください');
        if (lb.missing.length) issues.push('  時給表に時給がない人: ' + lb.missing.map(function (u) { return u.emp + ' ' + u.name; }).join('、'));
        if (lb.noSite.length) issues.push('  事業所が決まらない勤怠のCSV: ' + lb.noSite.join('、'));
        lb.unmapped.forEach(function (u) {
          issues.push('  事業所が決まらない求人: ' + u.ym + ' ' + u.title + ' ' + u.count + '件 ' + u.amount.toLocaleString() + '円');
        });
      }
    } catch (e) {
      issues.push('【人件費】取り込みでエラー: ' + e);
    }
    if (issues.length) {
      MailApp.sendEmail(salesNotifyTo_(), '【デリプロ売上集計】確認が必要な項目があります',
        issues.join('\n') + '\n\n集計シート: ' + openSalesSpreadsheet_().getUrl());
    }
  } catch (e) {
    MailApp.sendEmail(salesNotifyTo_(), '【デリプロ売上集計】エラー', String(e && e.stack || e));
    throw e;
  }
}

/** 毎朝の自動実行を登録する(1回だけ実行。再実行しても重複しない) */
function setupSalesTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dailySalesJob') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dailySalesJob').timeBased().everyDays(1).atHour(SALES_CONFIG.TRIGGER_HOUR).inTimezone(SALES_CONFIG.TIME_ZONE).create();
  Logger.log('毎朝' + SALES_CONFIG.TRIGGER_HOUR + '時台に dailySalesJob を実行するよう登録しました');
}

/** 通知先: スクリプトプロパティ NOTIFY_TO(カンマ区切り)。未登録ならこのスクリプトを実行しているアカウント */
function salesNotifyTo_() {
  return PropertiesService.getScriptProperties().getProperty('NOTIFY_TO') || Session.getEffectiveUser().getEmail();
}

function summarizeDeliproSales_(fromYmd, toYmd) {
  const cfg = SALES_CONFIG;
  const client = deliproLogin_();
  const typeNames = cfg.ORDER_TYPES.map(function (t) { return t.name; });
  const fixed = fetchOrders_(client, fromYmd, toYmd, '0');
  const pending = fetchOrders_(client, fromYmd, toYmd, '1');
  const taxFixed = fetchTax_(client, fromYmd, toYmd, '0');
  const taxPending = fetchTax_(client, fromYmd, toYmd, '1');
  const sum = function (o, tax) {
    const s = summarizeOrders_(o.orders, o.typeOf, typeNames, cfg.PAYMENT_ORDER);
    s.tax = tax;
    return s;
  };
  const both = { orders: fixed.orders.concat(pending.orders), typeOf: Object.assign({}, fixed.typeOf, pending.typeOf) };
  const blocks = [
    { title: '確定＋保留(分析画面で注文状態を空欄にしたときと同じ)', summary: sum(both, addTax_(taxFixed, taxPending)) },
    { title: '確定のみ', summary: sum(fixed, taxFixed) },
    { title: '保留のみ(取り消される可能性あり)', summary: sum(pending, taxPending) },
  ];
  writeSummarySheet_(fromYmd, toYmd, blocks);
  // PL転記用のシートは「確定＋保留」で更新する(月の途中は確定＋保留、締めで保留が残っていないことを確認する運用)
  const unmapped = writePlSheets_(fromYmd.slice(0, 7), blocks[0].summary);
  blocks.forEach(function (b) { Logger.log(b.title + ': ' + b.summary.count + '件 ' + b.summary.total + '円'); });

  // 確認が必要な点(区分なし・照合の差)。確定＋保留の表で判定する
  const problems = [];
  summaryToTable_(blocks[0].summary).slice(1).forEach(function (r) {
    if (r[0] === '区分なし') problems.push('注文区分が未設定の注文があります。デリプロで区分を入れてください');
    else if (/^差/.test(String(r[r.length - 1])) && r[0] !== '合計') problems.push(r[0] + ': 支払区分別の合計と売上分析の合計が合いません(' + r[r.length - 1] + '円)');
  });
  unmapped.filter(function (u) { return u.item !== '合計'; }).forEach(function (u) {
    problems.push(u.type + 'の「' + u.item + '」' + u.amount.toLocaleString() + '円はPLに入れる欄がありません');
  });
  return { blocks: blocks, problems: problems, pendingOrders: pending.orders };
}

/**
 * 指定した注文状態('0'=確定 / '1'=保留)の注文を取得し、注文区分を付ける
 * @return {{orders:{odid:string,payment:string,amount:number}[], typeOf:Object}}
 */
function fetchOrders_(client, fromYmd, toYmd, status) {
  // 注文区分ごとに検索して、注文番号→区分名の対応を作る
  const typeOf = {};
  SALES_CONFIG.ORDER_TYPES.forEach(function (t) {
    deliproSearch_(client, fromYmd, toYmd, status, '0', t.id).forEach(function (o) { typeOf[o.odid] = t.name; });
  });
  // 区分を指定しない検索(全件)。区分の付け漏れを見つけるため、こちらを正とする
  const ids = deliproSearch_(client, fromYmd, toYmd, status, '0').map(function (o) { return o.odid; });
  const orders = ids.length ? parseDeliDownloadCsv_(deliproDownloadCsv_(client, ids)) : [];
  if (orders.length !== ids.length) {
    throw new Error('ダウンロードの件数が合いません(検索' + ids.length + '件・ダウンロード' + orders.length + '件)');
  }
  return { orders: orders, typeOf: typeOf };
}

/** 売上分析(期間)から、注文区分ごとの税率別の金額を取る。注文区分が未設定の注文は「区分なし」 */
function fetchTax_(client, fromYmd, toYmd, status) {
  const tax = {};
  SALES_CONFIG.ORDER_TYPES.concat([{ id: '0', name: '区分なし' }]).forEach(function (t) {
    tax[t.name] = deliproTaxSummary_(client, fromYmd, toYmd, t.id, status);
  });
  return tax;
}

/** 集配管理の「ダウンロード」(注文ごと1行のCSV)を文字列で取得する */
function deliproDownloadCsv_(client, odids) {
  const res = deliproRequest_(client, 'deli_download.php', { method: 'post', payload: { odids: odids.join(','), user: 'dp0100' } });
  return res.getBlob().getDataAsString('Shift_JIS');
}

// ===== SalesSheet.gs =====
/**
 * 集計結果を専用のスプレッドシート(SALES_CONFIG.SHEET_NAME)に書き込む。月ごとに1シート(例: 2026-10)。
 * PLのファイルには書き込まない(PL側からは数式で参照するか、数字を写す)。
 */
function writeSummarySheet_(fromYmd, toYmd, blocks) {
  const ss = openSalesSpreadsheet_();
  const name = fromYmd.slice(0, 7);
  const sh = ss.getSheetByName(name) || ss.insertSheet(name, 0);
  sh.clear();
  const now = Utilities.formatDate(new Date(), SALES_CONFIG.TIME_ZONE, 'yyyy/MM/dd HH:mm');
  sh.getRange(1, 1).setValue('配達日 ' + fromYmd + '〜' + toYmd + '・税込(デリプロの合計金額)・更新 ' + now);
  let row = 3, width = 1, hasNone = false;
  blocks.forEach(function (b) {
    const table = summaryToTable_(b.summary);
    width = Math.max(width, table[0].length);
    sh.getRange(row, 1).setValue('■ ' + b.title).setFontWeight('bold');
    sh.getRange(row + 1, 1, table.length, table[0].length).setValues(table);
    sh.getRange(row + 1, 1, 1, table[0].length).setFontWeight('bold').setBackground('#eeeeee');
    sh.getRange(row + table.length, 1, 1, table[0].length).setFontWeight('bold');
    sh.getRange(row + 2, 2, table.length - 1, table[0].length - 1).setNumberFormat('#,##0');
    table.forEach(function (r, i) {
      if (r[0] === '区分なし') {
        sh.getRange(row + 1 + i, 1, 1, r.length).setBackground('#fff2cc');
        hasNone = true;
      }
      // 照合の列: 支払区分別の合計と、売上分析(期間)の注文合計が合わない行を赤くする
      if (/^差/.test(String(r[r.length - 1]))) sh.getRange(row + 1 + i, r.length).setBackground('#f4cccc');
    });
    row += table.length + 3;
  });
  if (hasNone) {
    sh.getRange(row, 1).setValue('※「区分なし」はデリプロで注文区分が未入力の注文です。デリプロで区分を入れてから再実行してください');
  }
  sh.autoResizeColumns(1, width);
}

function openSalesSpreadsheet_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('SALES_SHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  const ss = SpreadsheetApp.create(SALES_CONFIG.SHEET_NAME);
  props.setProperty('SALES_SHEET_ID', ss.getId());
  Logger.log('集計用のスプレッドシートを作りました: ' + ss.getUrl());
  return ss;
}

// ===== PlExport.gs =====
/**
 * PL転記用のシート(PLと同じシート名・同じセル番地)への書き込みと、PLの手入力の数字との照合。
 * PLのファイルには書き込まない。照合のときだけ読み取る(スクリプトプロパティ PL_SHEET_ID)。
 */

/** 集計結果(確定＋保留)を、転記用シートの該当月の列に書く */
function writePlSheets_(ym, summary) {
  const cfg = SALES_CONFIG;
  const ss = openSalesSpreadsheet_();
  const col = plColumnOf_(ym, cfg.PL_FIRST_MONTH, cfg.PL_FIRST_COLUMN);
  const built = buildPlCells_(summary, cfg.PL_LAYOUT);
  cfg.PL_LAYOUT.forEach(function (sh) {
    const s = ss.getSheetByName(sh.sheet) || initPlSheet_(ss, sh);
    s.getRange(2, col).setValue(Number(ym.slice(5, 7)) + '月');
  });
  built.cells.forEach(function (c) {
    ss.getSheetByName(c.sheet).getRange(c.row, col).setValue(c.value).setNumberFormat('#,##0');
  });
  return built.unmapped;
}

/** 転記用シートを作り、A〜C列に区分・項目名を書く */
function initPlSheet_(ss, sh) {
  const s = ss.insertSheet(sh.sheet);
  const label = { r10: '10%対象(税込)', r8: '8%対象(税込)', r0: '0%対象', ex: '計(税抜)' };
  s.getRange(1, 1).setValue(sh.sheet + '(デリプロから自動・確定＋保留)。PLの同じセル番地に対応');
  sh.blocks.forEach(function (b) {
    Object.keys(b.rows).forEach(function (k) {
      s.getRange(b.rows[k], 2, 1, 2).setValues([[b.type, label[k] || k]]);
    });
  });
  return s;
}

/**
 * 前月(またはスクリプトプロパティ COMPARE_MONTH に書いた月。例: 2026-09)をデリプロから集計し、
 * PLの手入力の数字と照合する(手動実行用)。結果は「PL照合_2026-09」シートに出す。PLは読むだけで書き込まない
 */
function comparePlMonth() {
  const ym = PropertiesService.getScriptProperties().getProperty('COMPARE_MONTH')
    || Utilities.formatDate(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1), SALES_CONFIG.TIME_ZONE, 'yyyy-MM');
  comparePlMonth_(ym);
}

/**
 * 過去の月をまとめて照合する(手動実行用)。対象の月はスクリプトプロパティ COMPARE_QUEUE(カンマ区切り。例: 2026-03,2026-04)、
 * なければ PL_FIRST_MONTH 月から前月まで。GASの実行時間(6分)の制限があるため、4分を過ぎたら残りを COMPARE_QUEUE に
 * 保存して止まる。「すべて完了」と出るまで続けて実行する。結果は月ごとの「PL照合_yyyy-MM」と、差のある行だけを集めた「PL照合まとめ」
 */
function comparePlMonths() {
  const cfg = SALES_CONFIG;
  const props = PropertiesService.getScriptProperties();
  let queue = (props.getProperty('COMPARE_QUEUE') || '').split(',').map(function (x) { return x.trim(); }).filter(String);
  const fresh = !queue.length;
  if (fresh) {
    const now = new Date();
    for (let d = new Date(now.getMonth() + 1 >= cfg.PL_FIRST_MONTH ? now.getFullYear() : now.getFullYear() - 1, cfg.PL_FIRST_MONTH - 1, 1);
      d < new Date(now.getFullYear(), now.getMonth(), 1); d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      queue.push(Utilities.formatDate(d, cfg.TIME_ZONE, 'yyyy-MM'));
    }
  }
  const ss = openSalesSpreadsheet_();
  let sum = ss.getSheetByName('PL照合まとめ');
  if (fresh || !sum) {
    sum = sum || ss.insertSheet('PL照合まとめ');
    sum.clear();
    sum.getRange(1, 1, 1, 8).setValues([['月', 'PLのシート', '行', '区分', '項目', 'PL(手入力)', 'デリプロ(自動)', '差']]).setFontWeight('bold');
  }
  const started = Date.now();
  while (queue.length && Date.now() - started < 4 * 60 * 1000) {
    const ym = queue.shift();
    // まとめには、自動化した関西・南海の行だけを載せる。計(税抜)はデリプロが注文ごとに端数を処理するため、千円未満の差は載せない
    const diffs = comparePlMonth_(ym).filter(function (r) {
      if (cfg.COMPARE_SUMMARY_SHEETS.indexOf(r[0]) === -1 || r[6] === 0) return false;
      return !(r[3] === '計(税抜)' && Math.abs(r[6]) < 1000);
    });
    const rows = diffs.length ? diffs.map(function (r) { return [ym].concat(r); }) : [[ym, '(差なし)', '', '', '', '', '', 0]];
    sum.getRange(sum.getLastRow() + 1, 1, rows.length, 8).setValues(rows);
    props.setProperty('COMPARE_QUEUE', queue.join(','));
    Logger.log(ym + ': 差のある行 ' + diffs.length + '件');
  }
  sum.getRange(2, 6, Math.max(sum.getLastRow() - 1, 1), 3).setNumberFormat('#,##0');
  if (queue.length) {
    Logger.log('時間切れのため止めました。残り: ' + queue.join(',') + '。もう一度 comparePlMonths を実行してください');
  } else {
    props.deleteProperty('COMPARE_QUEUE');
    Logger.log('すべて完了: ' + ss.getUrl() + ' の「PL照合まとめ」シート');
  }
}

/** 指定した月をデリプロから集計し、PLの手入力と照合して「PL照合_yyyy-MM」に書く。照合の行(見出しなし)を返す */
function comparePlMonth_(ym) {
  const cfg = SALES_CONFIG;
  const plId = PropertiesService.getScriptProperties().getProperty('PL_SHEET_ID');
  if (!plId) throw new Error('スクリプトプロパティ PL_SHEET_ID にPLのスプレッドシートIDを登録してください');
  const from = ym + '-01';
  const last = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0);
  const r = summarizeDeliproSales_(from, Utilities.formatDate(last, cfg.TIME_ZONE, 'yyyy-MM-dd'));
  const summary = r.blocks[0].summary;
  const col = plColumnOf_(ym, cfg.PL_FIRST_MONTH, cfg.PL_FIRST_COLUMN);
  const pl = SpreadsheetApp.openById(plId);
  const out = [['PLのシート', '行', '区分', '項目', 'PL(手入力)', 'デリプロ(自動)', '差']];
  const label = { r10: '10%対象', r8: '8%対象', r0: '0%対象', ex: '計(税抜)' };
  cfg.PL_LAYOUT.forEach(function (sh) {
    const plSheet = pl.getSheetByName(sh.sheet);
    sh.blocks.forEach(function (b) {
      Object.keys(b.rows).forEach(function (k) {
        const auto = buildPlCells_(summary, [{ sheet: sh.sheet, blocks: [b] }]).cells.filter(function (c) { return c.row === b.rows[k]; })[0].value;
        const manual = plSheet ? Number(plSheet.getRange(b.rows[k], col).getValue()) || 0 : 0;
        out.push([sh.sheet, b.rows[k], b.type, label[k] || k, manual, auto, auto - manual]);
      });
    });
  });
  const ss = openSalesSpreadsheet_();
  const name = 'PL照合_' + ym;
  const s = ss.getSheetByName(name) || ss.insertSheet(name);
  s.clear();
  s.getRange(1, 1, out.length, out[0].length).setValues(out);
  s.getRange(1, 1, 1, out[0].length).setFontWeight('bold').setBackground('#eeeeee');
  s.getRange(2, 5, out.length - 1, 3).setNumberFormat('#,##0');
  out.slice(1).forEach(function (row, i) {
    if (row[6] !== 0) s.getRange(i + 2, 7).setBackground('#f4cccc');
  });
  s.autoResizeColumns(1, out[0].length);
  Logger.log(name + ' を作りました: ' + ss.getUrl());
  return out.slice(1);
}

/**
 * 1回だけ実行: PL(関西・南海)の消費税の計算式を直す。税込の対象額に「*0.1」「*0.08」を掛けていたのを
 * 「*10/110」「*8/108」にする。対象はPL_TAX_FIX_SHEETS の7〜26行(売上欄)だけで、109行目の法定福利費などは触らない。
 * 直したセルは集計用スプレッドシートの「PL修正記録」シートに残す(元に戻すときに使う)
 */
function fixPlTaxFormulas() {
  const plId = PropertiesService.getScriptProperties().getProperty('PL_SHEET_ID');
  if (!plId) throw new Error('スクリプトプロパティ PL_SHEET_ID にPLのスプレッドシートIDを登録してください');
  const pl = SpreadsheetApp.openById(plId);
  const log = [['日時', 'シート', 'セル', '修正前', '修正後']];
  const now = Utilities.formatDate(new Date(), SALES_CONFIG.TIME_ZONE, 'yyyy/MM/dd HH:mm');
  ['PL_Mr.BUFFET_関西', 'PL_南海(グラン天空)'].forEach(function (name) {
    const sh = pl.getSheetByName(name);
    if (!sh) throw new Error('PLに「' + name + '」シートがありません');
    const range = sh.getRange('D7:AC26');
    const formulas = range.getFormulas();
    let n10 = 0, n8 = 0;
    formulas.forEach(function (row, i) {
      row.forEach(function (f, j) {
        let next = null;
        if (/\*0\.1$/.test(f)) { next = f.replace(/\*0\.1$/, '*10/110'); n10++; }
        else if (/\*0\.08$/.test(f)) { next = f.replace(/\*0\.08$/, '*8/108'); n8++; }
        if (next === null) return;
        const cell = range.getCell(i + 1, j + 1);
        cell.setFormula(next); // 値や IMPORTRANGE のセルには触らないよう、1セルずつ書く
        log.push([now, name, cell.getA1Notation(), "'" + f, "'" + next]);
      });
    });
    Logger.log(name + ': 10%の式 ' + n10 + '件・8%の式 ' + n8 + '件を直しました');
  });
  const ss = openSalesSpreadsheet_();
  const s = ss.getSheetByName('PL修正記録') || ss.insertSheet('PL修正記録');
  const start = s.getLastRow() === 0 ? 1 : s.getLastRow() + 1;
  const rows = start === 1 ? log : log.slice(1);
  if (rows.length) s.getRange(start, 1, rows.length, 5).setValues(rows);
  Logger.log('修正の記録: ' + ss.getUrl() + ' の「PL修正記録」シート');
}

// ===== InfomartParser.gs =====
/**
 * インフォマートの仕入れのCSV(cp932を文字列にしたもの)を読み、PLの食材費・資材費の欄に割り当てる
 * (純粋関数。tests/delipro-sales.test.js)。
 */

/** 名前の比べ方: 全角英数を半角にし、空白と「株式会社」「有限会社」を除く */
function normalizeName_(s) {
  return String(s || '').normalize('NFKC').replace(/\s+/g, '').replace(/株式会社|有限会社|\(株\)|\(有\)/g, '');
}

/**
 * データ区分 D の行のうち、伝票の最初の行(［総合計］が入っている行)を伝票として返す
 * @return {{id:string,no:string,date:string,ym:string,person:string,supplier:string,amount:number}[]}
 */
function parseInfomartCsv_(text) {
  const rows = parseCsv_(text);
  const header = rows.filter(function (r) { return r[0] === '［データ区分］'; })[0];
  if (!header) throw new Error('インフォマートのCSVの見出し(［データ区分］)が見つかりません');
  const ix = {};
  header.forEach(function (n, i) { ix[n] = i; });
  ['［伝票日付］', '［伝票No］', '［自社担当者］', '［取引先名］', '［総合計］', '［取引ID_SYSTEM］'].forEach(function (n) {
    if (!(n in ix)) throw new Error('インフォマートのCSVに列 ' + n + ' がありません');
  });
  return rows.filter(function (r) { return r[0] === 'D' && r[ix['［総合計］']] !== '' && r[ix['［総合計］']] != null; })
    .map(function (r) {
      const date = r[ix['［伝票日付］']];
      return {
        id: r[ix['［取引ID_SYSTEM］']], no: r[ix['［伝票No］']], date: date, ym: date.slice(0, 7).replace('/', '-'),
        person: r[ix['［自社担当者］']], supplier: r[ix['［取引先名］']], amount: Number(r[ix['［総合計］']]) || 0,
      };
    });
}

/**
 * 伝票を、月×事業所×PLの行に集計する
 * @param slips parseInfomartCsv_ の結果(複数ファイル分を足してよい。取引IDが同じ伝票は1回だけ数える)。
 *   site を持つもの(インフォマート外の手入力)は、その事業所に入れる
 * @param transfers { 伝票No: '関西' | '南海' | '除外' }
 * @return {{cells:{ym,sheet,row,value}[], lines:{ym,site,item,row,count,amount,how}[], unmapped:{ym,no,date,person,supplier,amount,reason}[]}}
 */
function assignInfomartSlips_(slips, cfg, transfers) {
  transfers = transfers || {};
  const persons = {};
  Object.keys(cfg.PERSONS).forEach(function (p) { persons[normalizeName_(p)] = cfg.PERSONS[p]; });
  const seen = {}, cellAt = {}, lineAt = {};
  const cells = [], lines = [], unmapped = [];
  slips.forEach(function (s) {
    if (seen[s.id]) return;
    seen[s.id] = true;
    const sup = cfg.SUPPLIERS.filter(function (x) { return normalizeName_(s.supplier).indexOf(normalizeName_(x.match)) !== -1; })[0];
    const miss = function (reason) {
      unmapped.push({ ym: s.ym, no: s.no, date: s.date, person: s.person, supplier: s.supplier, amount: s.amount, reason: reason });
    };
    const t = s.site || transfers[String(s.no)];
    if (t === '除外') return;
    if (!sup) return miss('取引先の割り当てがない');
    const sites = Object.keys(sup.rows);
    let site, how;
    if (t) { site = t; how = s.site ? 'インフォマート外' : '振替'; }
    else if (sites.length === 1) { site = sites[0]; how = '取引先'; }
    else { site = persons[normalizeName_(s.person)]; how = '担当者'; }
    if (!site) return miss('担当者から事業所が決まらない');
    if (!(site in sup.rows)) return miss(site + 'のPLにこの取引先の行がない(振替先を確認)');
    const sheet = cfg.SITES[site], row = sup.rows[site];
    const ck = s.ym + '|' + sheet + '|' + row;
    if (!cellAt[ck]) { cellAt[ck] = { ym: s.ym, sheet: sheet, row: row, value: 0 }; cells.push(cellAt[ck]); }
    cellAt[ck].value += s.amount;
    const lk = ck + '|' + how;
    if (!lineAt[lk]) { lineAt[lk] = { ym: s.ym, site: site, item: sup.item, row: row, count: 0, amount: 0, how: how }; lines.push(lineAt[lk]); }
    lineAt[lk].count++;
    lineAt[lk].amount += s.amount;
  });
  return { cells: cells, lines: lines, unmapped: unmapped };
}

if (typeof module !== 'undefined') module.exports = { normalizeName_, parseInfomartCsv_, assignInfomartSlips_ };

// ===== InfomartImport.gs =====
/**
 * インフォマートのCSV(月1回、フォルダに置く)から、PLの食材費・資材費を集計する。
 * 書き込み先は集計用スプレッドシートのPL転記用シート(PLと同じシート名・同じセル番地)。PLのファイルには書き込まない。
 */

/**
 * フォルダ内のCSVをすべて読み、含まれる月の食材費・資材費を転記用シートに書く(手動実行・自動実行用)。
 * 同じ伝票が複数のファイルに入っていても1回だけ数えるので、何度実行してもよい。
 * 明細は「仕入_yyyy-MM」シート、割り当てられなかった伝票は同じシートの下に黄色で出す
 */
function importInfomartCsv() {
  const cfg = SALES_CONFIG.INFOMART;
  const files = infomartCsvFiles_();
  if (!files.length) {
    Logger.log('フォルダ「' + infomartFolder_().getName() + '」にCSVがありません');
    return { months: [], unmapped: [] };
  }
  const slips = readInfomartSlips_(files).concat(readOutsideEntries_());
  const r = assignInfomartSlips_(slips, cfg, readInfomartTransfers_());
  const ss = openSalesSpreadsheet_();
  const months = {};
  slips.forEach(function (s) { months[s.ym] = true; });
  Object.keys(months).sort().forEach(function (ym) {
    const col = plColumnOf_(ym, SALES_CONFIG.PL_FIRST_MONTH, SALES_CONFIG.PL_FIRST_COLUMN);
    Object.keys(cfg.SITES).forEach(function (site) {
      const name = cfg.SITES[site];
      const sh = ss.getSheetByName(name) || ss.insertSheet(name);
      sh.getRange(2, col).setValue(Number(ym.slice(5, 7)) + '月');
      // その月の欄をいったん0にしてから書く(振替で行が変わったときに古い数字が残らないように)
      cfg.SUPPLIERS.forEach(function (x) {
        if (!(site in x.rows)) return;
        sh.getRange(x.rows[site], 2, 1, 2).setValues([['インフォマート', x.item]]);
        sh.getRange(x.rows[site], col).setValue(0).setNumberFormat('#,##0');
      });
    });
    r.cells.filter(function (c) { return c.ym === ym; }).forEach(function (c) {
      ss.getSheetByName(c.sheet).getRange(c.row, col).setValue(c.value);
    });
    writeInfomartDetail_(ss, ym, r);
  });
  Logger.log('取り込み: ' + files.length + 'ファイル・伝票' + slips.length + '件・月 ' + Object.keys(months).sort().join(',')
    + (r.unmapped.length ? '。割り当てられなかった伝票 ' + r.unmapped.length + '件(「仕入_yyyy-MM」シートの下)' : ''));
  return { months: Object.keys(months).sort(), unmapped: r.unmapped };
}

/** 「仕入_yyyy-MM」シートに、事業所×取引先の集計と、割り当てられなかった伝票を書く */
function writeInfomartDetail_(ss, ym, r) {
  const name = '仕入_' + ym;
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.clear();
  const out = [['事業所', '取引先(PLの項目)', 'PLの行', '決め方', '伝票数', '金額']];
  r.lines.filter(function (l) { return l.ym === ym; })
    .sort(function (a, b) { return a.site === b.site ? a.row - b.row : a.site < b.site ? -1 : 1; })
    .forEach(function (l) { out.push([l.site, l.item, l.row, l.how, l.count, l.amount]); });
  sh.getRange(1, 1).setValue(ym + ' インフォマート(伝票日付の月・総合計)・更新 '
    + Utilities.formatDate(new Date(), SALES_CONFIG.TIME_ZONE, 'yyyy/MM/dd HH:mm'));
  sh.getRange(3, 1, out.length, out[0].length).setValues(out);
  sh.getRange(3, 1, 1, out[0].length).setFontWeight('bold').setBackground('#eeeeee');
  sh.getRange(4, 6, Math.max(out.length - 1, 1), 1).setNumberFormat('#,##0');
  const miss = r.unmapped.filter(function (u) { return u.ym === ym; });
  if (!miss.length) return;
  const at = out.length + 5;
  const m = [['伝票No', '伝票日付', '担当者', '取引先', '金額', '理由']].concat(miss.map(function (u) {
    return [u.no, u.date, u.person, u.supplier, u.amount, u.reason];
  }));
  sh.getRange(at - 1, 1).setValue('■ PLに入っていない伝票(Config.gs の SUPPLIERS に足すか、「インフォマート振替」シートに書く)').setFontWeight('bold');
  sh.getRange(at, 1, m.length, m[0].length).setValues(m).setBackground('#fff2cc');
  sh.getRange(at, 1, 1, m[0].length).setFontWeight('bold');
}

/**
 * 「仕入_インフォマート外」シート(なければ作る)を読む。インフォマートを通さずに直接発注した分(例: タムラ容器)を
 * 1行に1件、A列 月(2026-09)、B列 事業所(関西/南海)、C列 取引先(Config.gs の SUPPLIERS の名前)、D列 金額(税抜) で書く。
 * インフォマートの伝票と同じ行に足し合わせる
 */
function readOutsideEntries_() {
  const ss = openSalesSpreadsheet_();
  let sh = ss.getSheetByName('仕入_インフォマート外');
  if (!sh) {
    sh = ss.insertSheet('仕入_インフォマート外');
    sh.getRange(1, 1, 1, 5).setValues([['月(2026-09)', '事業所(関西/南海)', '取引先', '金額(税抜)', 'メモ']]).setFontWeight('bold');
    sh.getRange('A:A').setNumberFormat('@');
    return [];
  }
  return sh.getDataRange().getValues().slice(1).map(function (r, i) {
    const ym = r[0] instanceof Date ? Utilities.formatDate(r[0], SALES_CONFIG.TIME_ZONE, 'yyyy-MM') : String(r[0]).trim().replace('/', '-');
    const site = String(r[1]).trim();
    if (!ym && !site && !r[2] && !r[3]) return null;
    if (!/^\d{4}-\d{2}$/.test(ym)) throw new Error('「仕入_インフォマート外」' + (i + 2) + '行目の月は 2026-09 の形で書いてください: ' + r[0]);
    if (['関西', '南海'].indexOf(site) === -1) throw new Error('「仕入_インフォマート外」' + (i + 2) + '行目の事業所は 関西 か 南海 にしてください: ' + site);
    return { id: 'outside:' + (i + 2), no: 'インフォマート外' + (i + 2) + '行目', date: ym, ym: ym, person: '', site: site,
      supplier: String(r[2]), amount: Number(r[3]) || 0 };
  }).filter(Boolean);
}

/** 「インフォマート振替」シート(なければ作る)を読む。A列 伝票No、C列 振替先(関西 / 南海 / 除外) */
function readInfomartTransfers_() {
  const ss = openSalesSpreadsheet_();
  let sh = ss.getSheetByName('インフォマート振替');
  if (!sh) {
    sh = ss.insertSheet('インフォマート振替');
    sh.getRange(1, 1, 1, 4).setValues([['伝票No', '取引先(メモ)', '振替先(関西/南海/除外)', '理由(メモ)']]).setFontWeight('bold');
    return {};
  }
  const out = {};
  sh.getDataRange().getValues().slice(1).forEach(function (r) {
    const no = String(r[0]).trim(), to = String(r[2]).trim();
    if (!no) return;
    if (['関西', '南海', '除外'].indexOf(to) === -1) throw new Error('「インフォマート振替」の伝票No ' + no + ' の振替先は 関西・南海・除外 のどれかにしてください: ' + to);
    out[no] = to;
  });
  return out;
}

/** CSVを置くフォルダ(スクリプトプロパティ INFOMART_FOLDER_ID、なければマイドライブの INFOMART.FOLDER。なければ作る) */
function infomartFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('INFOMART_FOLDER_ID');
  if (id) return DriveApp.getFolderById(id);
  const it = DriveApp.getFoldersByName(SALES_CONFIG.INFOMART.FOLDER);
  const f = it.hasNext() ? it.next() : DriveApp.createFolder(SALES_CONFIG.INFOMART.FOLDER);
  props.setProperty('INFOMART_FOLDER_ID', f.getId());
  return f;
}

/** CSVを読み、伝票をまとめて返す。インフォマートのCSVでないファイルは読み飛ばす */
function readInfomartSlips_(files) {
  let slips = [];
  files.forEach(function (f) {
    const text = f.getBlob().getDataAsString('Shift_JIS');
    if (text.indexOf('［データ区分］') === -1) {
      Logger.log('インフォマートのCSVではないため読み飛ばしました: ' + f.getName());
      return;
    }
    slips = slips.concat(parseInfomartCsv_(text));
  });
  return slips;
}

function infomartCsvFiles_() {
  const out = [];
  const it = infomartFolder_().getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (/\.csv$/i.test(f.getName())) out.push(f);
  }
  return out;
}

/**
 * 毎朝の自動実行から呼ぶ。前回から新しいCSVが置かれたか、CSVが更新されたときだけ取り込み、結果をメールする
 */
function infomartDailyCheck_() {
  const props = PropertiesService.getScriptProperties();
  const last = Number(props.getProperty('INFOMART_LAST_IMPORT') || 0);
  const newest = infomartCsvFiles_().reduce(function (m, f) { return Math.max(m, f.getLastUpdated().getTime()); }, 0);
  if (!newest || newest <= last) return null;
  const r = importInfomartCsv();
  props.setProperty('INFOMART_LAST_IMPORT', String(newest));
  return r;
}

/**
 * 前月(またはスクリプトプロパティ COMPARE_MONTH の月)について、インフォマートの集計とPLの手入力を照合する(手動実行用)。
 * 結果は「仕入照合_yyyy-MM」シート。PLは読むだけで書き込まない
 */
function compareInfomartMonth() {
  const cfg = SALES_CONFIG.INFOMART;
  const props = PropertiesService.getScriptProperties();
  const ym = props.getProperty('COMPARE_MONTH')
    || Utilities.formatDate(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1), SALES_CONFIG.TIME_ZONE, 'yyyy-MM');
  const plId = props.getProperty('PL_SHEET_ID');
  if (!plId) throw new Error('スクリプトプロパティ PL_SHEET_ID にPLのスプレッドシートIDを登録してください');
  const slips = readInfomartSlips_(infomartCsvFiles_()).concat(readOutsideEntries_());
  const r = assignInfomartSlips_(slips.filter(function (s) { return s.ym === ym; }), cfg, readInfomartTransfers_());
  const col = plColumnOf_(ym, SALES_CONFIG.PL_FIRST_MONTH, SALES_CONFIG.PL_FIRST_COLUMN);
  const pl = SpreadsheetApp.openById(plId);
  const out = [['事業所', 'PLの行', '項目', 'PL(手入力)', 'インフォマート(自動)', '差']];
  Object.keys(cfg.SITES).forEach(function (site) {
    const plSheet = pl.getSheetByName(cfg.SITES[site]);
    cfg.SUPPLIERS.forEach(function (x) {
      if (!(site in x.rows)) return;
      const row = x.rows[site];
      const auto = r.cells.filter(function (c) { return c.sheet === cfg.SITES[site] && c.row === row; }).reduce(function (a, c) { return a + c.value; }, 0);
      const manual = plSheet ? Number(plSheet.getRange(row, col).getValue()) || 0 : 0;
      out.push([site, row, x.item, manual, auto, auto - manual]);
    });
  });
  const ss = openSalesSpreadsheet_();
  const name = '仕入照合_' + ym;
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.clear();
  sh.getRange(1, 1, out.length, out[0].length).setValues(out);
  sh.getRange(1, 1, 1, out[0].length).setFontWeight('bold').setBackground('#eeeeee');
  sh.getRange(2, 4, out.length - 1, 3).setNumberFormat('#,##0');
  out.forEach(function (row, i) { if (i && row[5] !== 0) sh.getRange(i + 1, 6).setBackground('#f4cccc'); });
  Logger.log(ym + ': 差のある行 ' + out.filter(function (x, i) { return i && x[5] !== 0; }).length + '件。' + ss.getUrl() + ' の「' + name + '」');
}

/**
 * PLの食材費・資材費の欄に、集計用スプレッドシートの同じセルを参照する IMPORTRANGE の式を入れる(手動実行。1回でよい)。
 * 対象は INFOMART.LINK_SITES の事業所の、SUPPLIERS に書いた行。月はスクリプトプロパティ LINK_FROM_MONTH(例: 2026-10)から
 * PLの年度の最後の月まで。ほかの式が入っているセルは書き換えずに知らせる。書き換えたセルの前の内容は「PL修正記録」に残す
 */
function linkPlInfomartFormulas() {
  const cfg = SALES_CONFIG.INFOMART;
  const targets = [];
  cfg.LINK_SITES.forEach(function (site) {
    cfg.SUPPLIERS.forEach(function (x) {
      if (site in x.rows) targets.push({ sheet: cfg.SITES[site], row: x.rows[site] });
    });
  });
  linkPlRows_(targets);
}

/**
 * PLの指定の行(targets: {sheet,row}[])に、スクリプトプロパティ LINK_FROM_MONTH の月から年度末まで、
 * 集計用スプレッドシートの同じセルを参照する IMPORTRANGE の式を入れる。ほかの式が入っているセルは書き換えない
 */
function linkPlRows_(targets) {
  const props = PropertiesService.getScriptProperties();
  const plId = props.getProperty('PL_SHEET_ID');
  if (!plId) throw new Error('スクリプトプロパティ PL_SHEET_ID にPLのスプレッドシートIDを登録してください');
  const from = props.getProperty('LINK_FROM_MONTH');
  if (!/^\d{4}-\d{2}$/.test(from || '')) throw new Error('スクリプトプロパティ LINK_FROM_MONTH に、式に切り替える最初の月(例: 2026-10)を書いてください');
  const ss = openSalesSpreadsheet_();
  const pl = SpreadsheetApp.openById(plId);
  const now = Utilities.formatDate(new Date(), SALES_CONFIG.TIME_ZONE, 'yyyy/MM/dd HH:mm');
  const log = [], skipped = [];
  // 年度の最後の月(PL_FIRST_MONTH の前の月)まで
  const months = [];
  for (let y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7)); ; m++) {
    if (m > 12) { m = 1; y++; }
    months.push(y + '-' + ('0' + m).slice(-2));
    if (m === (SALES_CONFIG.PL_FIRST_MONTH + 10) % 12 + 1) break;
  }
  targets.forEach(function (t) {
    const sh = pl.getSheetByName(t.sheet);
    if (!sh) throw new Error('PLに「' + t.sheet + '」シートがありません');
    months.forEach(function (ym) {
      const cell = sh.getRange(t.row, plColumnOf_(ym, SALES_CONFIG.PL_FIRST_MONTH, SALES_CONFIG.PL_FIRST_COLUMN));
      const a1 = cell.getA1Notation();
      const next = '=IMPORTRANGE("' + ss.getId() + '","\'' + t.sheet + '\'!' + a1 + '")';
      const f = cell.getFormula();
      if (f === next) return;
      if (f && !/^=IMPORTRANGE\(/i.test(f)) { skipped.push(t.sheet + '!' + a1 + ' ' + f); return; }
      log.push([now, t.sheet, a1, "'" + (f || cell.getValue()), "'" + next]);
      cell.setFormula(next);
    });
  });
  if (log.length) {
    const s = ss.getSheetByName('PL修正記録') || ss.insertSheet('PL修正記録');
    if (s.getLastRow() === 0) s.getRange(1, 1, 1, 5).setValues([['日時', 'シート', 'セル', '修正前', '修正後']]);
    s.getRange(s.getLastRow() + 1, 1, log.length, 5).setValues(log);
  }
  Logger.log('式を入れたセル: ' + log.length + '件(' + months[0] + '〜' + months[months.length - 1] + ')。記録は「PL修正記録」');
  if (skipped.length) Logger.log('ほかの式が入っていたため、そのままにしたセル:\n' + skipped.join('\n'));
}

// ===== LaborParser.gs =====
/**
 * アルバイト人件費のCSVを読み、事業所ごとに合計する(純粋関数。tests/delipro-sales.test.js)。
 * 個人ごとの金額は返さない(呼び出し側がシートに書かないように、合計だけにする)
 */

/** タイミーの利用明細のCSVか(見出しで判定) */
function isTimeeCsv_(text) {
  const head = String(text || '').replace(/^﻿/, '').split(/\r?\n/)[0];
  return head.indexOf('求人タイトル') !== -1 && head.indexOf('合計報酬額') !== -1;
}

/**
 * タイミーの利用明細を、月×事業所に集計する
 * @param rules [{match, site}] 求人タイトルに match が含まれれば site
 * @return {{cells:{ym,site,value}[], lines:{ym,site,title,count,hours,amount,fee}[], unmapped:{ym,title,count,amount}[]}}
 */
function summarizeTimee_(text, rules) {
  const rows = parseCsv_(String(text || '').replace(/^﻿/, ''));
  const ix = {};
  rows[0].forEach(function (n, i) { ix[n] = i; });
  ['求人タイトル', '求人日', '合計報酬額', '実働時間', '利用料'].forEach(function (n) {
    if (!(n in ix)) throw new Error('タイミーのCSVに列「' + n + '」がありません');
  });
  const cellAt = {}, lineAt = {}, missAt = {};
  const cells = [], lines = [], unmapped = [];
  rows.slice(1).forEach(function (r) {
    if (r.length < 2 || !r[ix['求人日']]) return;
    const ym = r[ix['求人日']].slice(0, 7).replace('/', '-');
    const title = r[ix['求人タイトル']].replace(/^.*】/, '');
    const amount = Number(r[ix['合計報酬額']]) || 0;
    const rule = rules.filter(function (x) { return title.indexOf(x.match) !== -1; })[0];
    if (!rule) {
      const mk = ym + '|' + title;
      if (!missAt[mk]) { missAt[mk] = { ym: ym, title: title, count: 0, amount: 0 }; unmapped.push(missAt[mk]); }
      missAt[mk].count++;
      missAt[mk].amount += amount;
      return;
    }
    const ck = ym + '|' + rule.site;
    if (!cellAt[ck]) { cellAt[ck] = { ym: ym, site: rule.site, value: 0 }; cells.push(cellAt[ck]); }
    cellAt[ck].value += amount;
    const lk = ck + '|' + title;
    if (!lineAt[lk]) { lineAt[lk] = { ym: ym, site: rule.site, title: title, count: 0, hours: 0, amount: 0, fee: 0 }; lines.push(lineAt[lk]); }
    const l = lineAt[lk];
    l.count++;
    l.hours += Number(r[ix['実働時間']]) || 0;
    l.amount += amount;
    l.fee += Number(r[ix['利用料']]) || 0;
  });
  return { cells: cells, lines: lines, unmapped: unmapped };
}

if (typeof module !== 'undefined') module.exports = { isTimeeCsv_, summarizeTimee_ };

/** マネーフォワード クラウド勤怠の日次勤怠のCSVか(見出しで判定) */
function isAttendanceCsv_(text) {
  const head = String(text || '').replace(/^﻿/, '').split(/\r?\n/)[0];
  return head.indexOf('従業員番号') !== -1 && head.indexOf('総労働時間') !== -1;
}

/** 'hh:mm' を時間(小数)にする */
function hoursOf_(s) {
  const m = String(s || '').match(/^(\d+):(\d{2})$/);
  return m ? Number(m[1]) + Number(m[2]) / 60 : 0;
}

/**
 * 日次勤怠のCSVを、1人1日1行で返す
 * @return {{emp,name,date,ym,total,overtime,night,worked}[]}
 */
function parseAttendanceCsv_(text) {
  const rows = parseCsv_(String(text || '').replace(/^﻿/, ''));
  const ix = {};
  rows[0].forEach(function (n, i) { ix[n] = i; });
  ['従業員番号', '氏名', '日付', '総労働時間', '法定外', '深夜所定', '深夜所定外', '深夜法定外'].forEach(function (n) {
    if (!(n in ix)) throw new Error('勤怠のCSVに列「' + n + '」がありません');
  });
  return rows.slice(1).filter(function (r) { return r.length > 3 && r[ix['日付']]; }).map(function (r) {
    const total = hoursOf_(r[ix['総労働時間']]);
    return {
      emp: r[ix['従業員番号']], name: r[ix['氏名']], date: r[ix['日付']], ym: r[ix['日付']].slice(0, 7).replace('/', '-'),
      total: total, overtime: hoursOf_(r[ix['法定外']]),
      night: hoursOf_(r[ix['深夜所定']]) + hoursOf_(r[ix['深夜所定外']]) + hoursOf_(r[ix['深夜法定外']]),
      worked: total > 0,
    };
  });
}

/**
 * 勤怠×時給で、月×事業所の人件費を出す。同じ人・同じ日が複数のファイルにあれば、あとのものを使う
 * @param records [{...parseAttendanceCsv_の1行, site}] site はファイル名から決めた事業所
 * @param wages { 従業員番号: {wage, dailyFare, monthlyFare, site, exclude} }
 * @return {{cells:{ym,site,value}[], lines:{ym,site,people,hours,overtime,night,days,amount}[], missing:{ym,emp,name}[]}}
 *   個人ごとの金額は返さない。missing は時給が登録されていない人(名前だけ)
 */
function calcAttendancePay_(records, wages, rates) {
  const byDay = {};
  records.forEach(function (r) { byDay[r.emp + '|' + r.date] = r; });
  const person = {};
  Object.keys(byDay).forEach(function (k) {
    const r = byDay[k];
    const w = wages[r.emp] || {};
    if (w.exclude) return;
    const site = w.site || r.site;
    const pk = r.ym + '|' + site + '|' + r.emp;
    if (!person[pk]) person[pk] = { ym: r.ym, site: site, emp: r.emp, name: r.name, hours: 0, overtime: 0, night: 0, days: 0 };
    const p = person[pk];
    p.hours += r.total;
    p.overtime += r.overtime;
    p.night += r.night;
    if (r.worked) p.days++;
  });
  const cellAt = {}, cells = [], lines = [], missing = [];
  Object.keys(person).sort().forEach(function (pk) {
    const p = person[pk];
    if (!p.days) return;
    const w = wages[p.emp];
    if (!w || !w.wage) { missing.push({ ym: p.ym, emp: p.emp, name: p.name }); return; }
    const pay = Math.round(p.hours * w.wage + p.overtime * w.wage * rates.overtime + p.night * w.wage * rates.night)
      + Math.round((w.dailyFare || 0) * p.days + (w.monthlyFare || 0));
    const ck = p.ym + '|' + p.site;
    if (!cellAt[ck]) {
      cellAt[ck] = { ym: p.ym, site: p.site, value: 0 };
      cells.push(cellAt[ck]);
      cellAt[ck].line = { ym: p.ym, site: p.site, people: 0, hours: 0, overtime: 0, night: 0, days: 0, amount: 0 };
      lines.push(cellAt[ck].line);
    }
    const c = cellAt[ck], l = c.line;
    c.value += pay;
    l.people++; l.hours += p.hours; l.overtime += p.overtime; l.night += p.night; l.days += p.days; l.amount += pay;
  });
  cells.forEach(function (c) { delete c.line; });
  return { cells: cells, lines: lines, missing: missing };
}

/** ファイル名から事業所を決める(rules: [{match, site}]) */
function siteOfFileName_(name, rules) {
  const r = rules.filter(function (x) { return String(name).indexOf(x.match) !== -1; })[0];
  return r ? r.site : '';
}

if (typeof module !== 'undefined') module.exports = Object.assign(module.exports, { isAttendanceCsv_, hoursOf_, parseAttendanceCsv_, calcAttendancePay_, siteOfFileName_ });

// ===== LaborImport.gs =====
/**
 * アルバイト人件費のCSV(月1回、フォルダ payroll_csv に置く)から、PLの111行(勤怠×時給)・112行(タイミー)・
 * タイミー利用料の行を集計する。
 * 書き込み先は集計用スプレッドシートのPL転記用シート(PLと同じシート名・同じセル番地)。PLのファイルには書き込まない。
 * 個人の名前・金額はシートに書かず、事業所ごとの合計だけを書く
 */

/**
 * フォルダ内のCSVをすべて読み、含まれる月の111行(勤怠×時給)・112行(タイミー)・タイミー利用料の行を書く
 * (手動実行・自動実行用。何度実行してもよい)
 */
function importLaborCsv() {
  const cfg = SALES_CONFIG.LABOR;
  const sites = SALES_CONFIG.INFOMART.SITES;
  const tm = { cells: [], lines: [], unmapped: [] };
  const seen = {};
  let att = [];
  const noSite = [];
  laborCsvFiles_().forEach(function (f) {
    const utf8 = f.getBlob().getDataAsString('UTF-8');
    if (isTimeeCsv_(utf8)) {
      // 同じ締めの明細を2回置いても二重に数えないよう、ファイル名ごとに1回だけ読む
      const key = f.getName().replace(/\s*\(\d+\)(?=\.csv$)/i, '');
      if (seen[key]) return;
      seen[key] = true;
      const x = summarizeTimee_(utf8, cfg.TIMEE.RULES);
      tm.cells = tm.cells.concat(x.cells);
      tm.lines = tm.lines.concat(x.lines);
      tm.unmapped = tm.unmapped.concat(x.unmapped);
      return;
    }
    const sjis = f.getBlob().getDataAsString('Shift_JIS');
    if (!isAttendanceCsv_(sjis)) return;
    const site = siteOfFileName_(f.getName(), cfg.ATTENDANCE.FILE_RULES);
    if (!site) noSite.push(f.getName());
    att = att.concat(parseAttendanceCsv_(sjis).map(function (r) { r.site = site; return r; }));
  });
  const pay = calcAttendancePay_(att, att.length ? readWages_() : {},
    { overtime: cfg.ATTENDANCE.OVERTIME_RATE, night: cfg.ATTENDANCE.NIGHT_RATE });
  const ss = openSalesSpreadsheet_();
  const months = {};
  tm.lines.concat(tm.unmapped, pay.lines, pay.missing).forEach(function (l) { months[l.ym] = true; });
  const sum = function (list, ym, site, key) {
    return list.filter(function (c) { return c.ym === ym && c.site === site; }).reduce(function (a, c) { return a + c[key]; }, 0);
  };
  Object.keys(months).sort().forEach(function (ym) {
    const col = plColumnOf_(ym, SALES_CONFIG.PL_FIRST_MONTH, SALES_CONFIG.PL_FIRST_COLUMN);
    const hasTm = tm.lines.concat(tm.unmapped).some(function (l) { return l.ym === ym; });
    const hasAtt = pay.lines.concat(pay.missing).some(function (l) { return l.ym === ym; });
    Object.keys(sites).forEach(function (site) {
      const sh = ss.getSheetByName(sites[site]) || ss.insertSheet(sites[site]);
      sh.getRange(2, col).setValue(Number(ym.slice(5, 7)) + '月');
      const put = function (row, label, v) {
        sh.getRange(row, 2, 1, 2).setValues([[label[0], label[1]]]);
        sh.getRange(row, col).setValue(v).setNumberFormat('#,##0');
      };
      if (hasTm) {
        put(cfg.TIMEE.ROW, ['タイミー', 'アルバイト人件費(タイミー・合計報酬額)'], sum(tm.cells, ym, site, 'value'));
        if (cfg.TIMEE.FEE_ROWS[site]) put(cfg.TIMEE.FEE_ROWS[site], ['タイミー', 'タイミー利用料(税抜)'], sum(tm.lines, ym, site, 'fee'));
      }
      if (hasAtt) put(cfg.ATTENDANCE.ROW, ['勤怠×時給', 'アルバイト人件費(勤怠×時給＋交通費)'], sum(pay.cells, ym, site, 'value'));
    });
    writeLaborDetail_(ss, ym, tm, pay);
  });
  if (noSite.length) Logger.log('事業所が決まらない勤怠のCSV(ファイル名に「南海」か「大阪GB」を入れてください): ' + noSite.join(', '));
  Logger.log('人件費: 月 ' + Object.keys(months).sort().join(',')
    + (tm.unmapped.length ? '。事業所が決まらないタイミーの求人 ' + tm.unmapped.length + '件' : '')
    + (pay.missing.length ? '。時給表に時給がない人 ' + pay.missing.length + '人(「人件費_yyyy-MM」シート)' : ''));
  return { months: Object.keys(months).sort(), unmapped: tm.unmapped, missing: pay.missing, noSite: noSite };
}

/** 「人件費_yyyy-MM」シートに、事業所ごとの合計を書く(個人ごとの金額は書かない) */
function writeLaborDetail_(ss, ym, tm, pay) {
  const name = '人件費_' + ym;
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.clear();
  sh.getRange(1, 1).setValue(ym + ' アルバイト人件費(働いた月)・更新 ' + Utilities.formatDate(new Date(), SALES_CONFIG.TIME_ZONE, 'yyyy/MM/dd HH:mm'));
  let row = 3;
  const block = function (title, table, moneyCols) {
    sh.getRange(row, 1).setValue(title).setFontWeight('bold');
    sh.getRange(row + 1, 1, table.length, table[0].length).setValues(table);
    sh.getRange(row + 1, 1, 1, table[0].length).setFontWeight('bold').setBackground('#eeeeee');
    moneyCols.forEach(function (c) { if (table.length > 1) sh.getRange(row + 2, c, table.length - 1, 1).setNumberFormat('#,##0'); });
    row += table.length + 3;
  };
  const a = [['事業所', '人数', '出勤日数', '総労働時間', 'うち法定外', 'うち深夜', '人件費(111行)']];
  pay.lines.filter(function (l) { return l.ym === ym; }).forEach(function (l) {
    a.push([l.site, l.people, l.days, Math.round(l.hours * 100) / 100, Math.round(l.overtime * 100) / 100, Math.round(l.night * 100) / 100, l.amount]);
  });
  block('■ 勤怠×時給(マネーフォワード)', a, [7]);
  const t = [['事業所', '求人', '件数', '実働時間', '合計報酬額(112行)', '利用料(税抜)']];
  tm.lines.filter(function (l) { return l.ym === ym; }).forEach(function (l) { t.push([l.site, l.title, l.count, l.hours, l.amount, l.fee]); });
  block('■ タイミー', t, [5, 6]);
  const miss = pay.missing.filter(function (u) { return u.ym === ym; }).map(function (u) { return [u.emp, u.name, '時給表に時給を書いてから再実行']; })
    .concat(tm.unmapped.filter(function (u) { return u.ym === ym; }).map(function (u) { return ['タイミー', u.title, '求人タイトルから事業所が決まらない(Config.gs の LABOR.TIMEE.RULES)']; }));
  if (miss.length) {
    sh.getRange(row, 1).setValue('■ 計算に入っていないもの').setFontWeight('bold');
    sh.getRange(row + 1, 1, miss.length, 3).setValues(miss).setBackground('#fff2cc');
  }
}

/**
 * payroll_csv フォルダのスプレッドシート「時給表」(なければ作る)に、勤怠のCSVに出てくる人を足す(手動実行)。
 * 足した人の時給・交通費は空欄なので、書き込んでから importLaborCsv を実行する
 */
function prepareWageTable() {
  const ss = openWageTable_();
  const sh = ss.getSheets()[0];
  const have = {};
  sh.getDataRange().getValues().slice(1).forEach(function (r) { have[String(r[0]).trim()] = true; });
  const add = [];
  laborCsvFiles_().forEach(function (f) {
    const text = f.getBlob().getDataAsString('Shift_JIS');
    if (!isAttendanceCsv_(text)) return;
    const site = siteOfFileName_(f.getName(), SALES_CONFIG.LABOR.ATTENDANCE.FILE_RULES);
    parseAttendanceCsv_(text).forEach(function (r) {
      if (have[r.emp]) return;
      have[r.emp] = true;
      add.push([r.emp, r.name, site, '', '', '', '']);
    });
  });
  if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, 7).setValues(add);
  Logger.log('時給表に ' + add.length + '人を足しました: ' + ss.getUrl());
}

/** 時給表を開く(なければ payroll_csv フォルダに作る)。集計用スプレッドシートとは別のファイルにして、共有を分ける */
function openWageTable_() {
  const name = SALES_CONFIG.LABOR.ATTENDANCE.WAGE_SHEET;
  const it = laborFolder_().getFilesByName(name);
  if (it.hasNext()) return SpreadsheetApp.open(it.next());
  const ss = SpreadsheetApp.create(name);
  DriveApp.getFileById(ss.getId()).moveTo(laborFolder_());
  ss.getSheets()[0].getRange(1, 1, 1, 7).setValues([['従業員番号', '氏名', '事業所(関西/南海。空欄ならファイル名で判定)', '時給', '交通費(1日あたり)', '交通費(月額)', '対象外(社員など。対象外なら「対象外」)']])
    .setFontWeight('bold');
  ss.getSheets()[0].getRange('A:A').setNumberFormat('@');
  return ss;
}

/** 時給表を読む。{ 従業員番号: {wage, dailyFare, monthlyFare, site, exclude} } */
function readWages_() {
  const out = {};
  openWageTable_().getSheets()[0].getDataRange().getValues().slice(1).forEach(function (r) {
    const emp = String(r[0]).trim();
    if (!emp) return;
    const site = String(r[2]).trim();
    out[emp] = {
      wage: Number(r[3]) || 0, dailyFare: Number(r[4]) || 0, monthlyFare: Number(r[5]) || 0,
      site: site === '関西' || site === '南海' ? site : '', exclude: String(r[6]).trim() === '対象外',
    };
  });
  return out;
}

/** CSVを置くフォルダ(スクリプトプロパティ LABOR_FOLDER_ID、なければマイドライブの LABOR.FOLDER) */
function laborFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('LABOR_FOLDER_ID');
  if (id) return DriveApp.getFolderById(id);
  const it = DriveApp.getFoldersByName(SALES_CONFIG.LABOR.FOLDER);
  if (!it.hasNext()) throw new Error('マイドライブにフォルダ「' + SALES_CONFIG.LABOR.FOLDER + '」がありません');
  const f = it.next();
  props.setProperty('LABOR_FOLDER_ID', f.getId());
  return f;
}

function laborCsvFiles_() {
  const out = [];
  const it = laborFolder_().getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (/\.csv$/i.test(f.getName())) out.push(f);
  }
  return out;
}

/** 毎朝の自動実行から呼ぶ。前回からCSVが置かれたか更新されたときだけ取り込む */
function laborDailyCheck_() {
  const props = PropertiesService.getScriptProperties();
  const last = Number(props.getProperty('LABOR_LAST_IMPORT') || 0);
  const newest = laborCsvFiles_().reduce(function (m, f) { return Math.max(m, f.getLastUpdated().getTime()); }, 0);
  if (!newest || newest <= last) return null;
  const r = importLaborCsv();
  props.setProperty('LABOR_LAST_IMPORT', String(newest));
  return r;
}

/**
 * 前月(またはスクリプトプロパティ COMPARE_MONTH の月)のタイミーの集計を、PLの112行の手入力と照合する(手動実行用)。
 * 結果は「人件費照合_yyyy-MM」シート。PLは読むだけ。先に importLaborCsv を実行しておく
 */
function compareLaborMonth() {
  const props = PropertiesService.getScriptProperties();
  const ym = props.getProperty('COMPARE_MONTH')
    || Utilities.formatDate(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1), SALES_CONFIG.TIME_ZONE, 'yyyy-MM');
  const plId = props.getProperty('PL_SHEET_ID');
  if (!plId) throw new Error('スクリプトプロパティ PL_SHEET_ID にPLのスプレッドシートIDを登録してください');
  const ss = openSalesSpreadsheet_();
  const pl = SpreadsheetApp.openById(plId);
  const cfg = SALES_CONFIG.LABOR;
  const col = plColumnOf_(ym, SALES_CONFIG.PL_FIRST_MONTH, SALES_CONFIG.PL_FIRST_COLUMN);
  const sites = SALES_CONFIG.INFOMART.SITES;
  const out = [['事業所', 'PLの行', '項目', 'PL(手入力)', '自動', '差']];
  Object.keys(sites).forEach(function (site) {
    [[cfg.ATTENDANCE.ROW, 'アルバイト(勤怠×時給)'], [cfg.TIMEE.ROW, 'タイミー'], [cfg.TIMEE.FEE_ROWS[site], 'タイミー利用料']].forEach(function (x) {
      if (!x[0]) return;
      const auto = Number(ss.getSheetByName(sites[site]).getRange(x[0], col).getValue()) || 0;
      const manual = Number(pl.getSheetByName(sites[site]).getRange(x[0], col).getValue()) || 0;
      out.push([site, x[0], x[1], manual, auto, auto - manual]);
    });
  });
  const name = '人件費照合_' + ym;
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.clear();
  sh.getRange(1, 1, out.length, out[0].length).setValues(out);
  sh.getRange(1, 1, 1, out[0].length).setFontWeight('bold').setBackground('#eeeeee');
  sh.getRange(2, 4, out.length - 1, 3).setNumberFormat('#,##0');
  Logger.log(ym + ': ' + out.slice(1).map(function (x) { return x[0] + ' 差 ' + x[5]; }).join(' / '));
}

/**
 * PLの人件費の行を、LINK_FROM_MONTH の月から IMPORTRANGE の式に切り替える(手動実行)。
 * 対象はスクリプトプロパティ LINK_LABOR_ROWS(カンマ区切り。例: 111,112,fee)。なければ 111・112・タイミー利用料の行。
 * fee はタイミー利用料の行。全角の数字やカンマでも読める
 */
function linkPlLaborFormulas() {
  const cfg = SALES_CONFIG.LABOR;
  const sites = SALES_CONFIG.INFOMART.SITES;
  const prop = PropertiesService.getScriptProperties().getProperty('LINK_LABOR_ROWS');
  const keys = String(prop || ('' + cfg.ATTENDANCE.ROW + ',' + cfg.TIMEE.ROW + ',fee')).normalize('NFKC')
    .split(/[,、\s]+/).map(function (x) { return x.trim(); }).filter(String);
  Logger.log('対象の行: ' + keys.join(',') + (prop ? '(スクリプトプロパティ LINK_LABOR_ROWS)' : '(LINK_LABOR_ROWS がないため、決まった行)'));
  const targets = [];
  Object.keys(sites).forEach(function (site) {
    keys.forEach(function (k) {
      const row = k === 'fee' ? cfg.TIMEE.FEE_ROWS[site] : Number(k);
      if (row) targets.push({ sheet: sites[site], row: row });
    });
  });
  linkPlRows_(targets);
}

// ===== DeliListParser.gs =====
/**
 * デリプロ「集配管理(deli.php)」の検索結果HTMLを解析する純粋関数群。
 * キッチン指示書メール(gas/kitchen-digest)と同じもの。
 */

/**
 * @return {{total:number|null, orders:{odid:string, status:string, date:string, time:string, office:string}[]}}
 */
function parseDeliList_(html) {
  const s = String(html || '');
  const totalMatch = s.match(/全\s*(\d+)\s*件/);
  const orders = [];
  const re = /<tr[^>]*class="tr_order[^"]*"[^>]*data-odid="(\d+)"/g;
  const starts = [];
  let m;
  while ((m = re.exec(s)) !== null) starts.push({ index: m.index, odid: m[1] });

  starts.forEach(function (st, i) {
    const block = s.slice(st.index, i + 1 < starts.length ? starts[i + 1].index : s.length);
    const dateM = block.match(/(\d{4}-\d{2}-\d{2})(?:\s*<br\s*\/?>\s*<span[^>]*>\s*(\d{1,2}:\d{2}))?/);
    // 1つ目の「alignCenter」で中身のあるセルが受付(事業所)
    const cells = [];
    const cellRe = /<td[^>]*class="alignCenter"[^>]*>([^<]*)<\/td>/g;
    let cm;
    while ((cm = cellRe.exec(block)) !== null) {
      const text = cm[1].replace(/\s+/g, ' ').trim();
      if (text) cells.push(text);
    }
    orders.push({
      odid: st.odid,
      status: /font-weight:\s*bold"?>\s*保留\s*</.test(block) ? '保留' : '確定',
      date: dateM ? dateM[1] : '',
      time: dateM && dateM[2] ? dateM[2] : '',
      office: cells[0] || '',
    });
  });
  return { total: totalMatch ? Number(totalMatch[1]) : null, orders: orders };
}

// ===== DeliproClient.gs =====
/**
 * デリプロ(https://asp.delipro.jp/dmanager/)へのログインとデータ取得。
 * ID・パスワードはスクリプトプロパティ DELIPRO_CONTRACT_ID / DELIPRO_STAFF_ID / DELIPRO_PASSWORD から読む。
 */
const DELIPRO_BASE = 'https://asp.delipro.jp/dmanager/';

/** ログインしてCookieを保持したクライアントを返す */
function deliproLogin_() {
  const props = PropertiesService.getScriptProperties();
  const client = { jar: {} };
  const res = deliproRequest_(client, 'login.php', {
    method: 'post',
    payload: {
      user_id: props.getProperty('DELIPRO_CONTRACT_ID') || '',
      txt_code: props.getProperty('DELIPRO_STAFF_ID') || '',
      txt_pass: props.getProperty('DELIPRO_PASSWORD') || '',
      hid_mode: 'login',
    },
  });
  if (res.getContentText('UTF-8').indexOf('logout.php') === -1) {
    throw new Error('デリプロにログインできませんでした。スクリプトプロパティのID・パスワードを確認してください');
  }
  return client;
}

/**
 * 集配管理で 配達日 from〜to の注文を検索する。
 * @param {string} status '0'=確定 / '1'=保留
 * @param {string} officeId 受付の事業所ID('0'=すべて)
 * @param {string=} orderType 注文区分のID('0'またはなし=すべて。SALES_CONFIG.ORDER_TYPES を参照)
 */
function deliproSearch_(client, fromYmd, toYmd, status, officeId, orderType) {
  const payload = {
    dayfield: 'oddelidate',
    datSt: fromYmd.replace(/-/g, '/'),
    datEd: toYmd.replace(/-/g, '/'),
    'odspid_s[]': '1',
    oddelistid_s: '0',
    odtype_s: orderType || '0',
    odstid_s: officeId || '0',
    odconc_s: '',
    odstatus_s: status,
    oddelitype_s: '0',
    odcpid_s: '0',
    rad_sort_s: '0',
    itname_s: '', opname_s: '', odmemo_s: '', odlocalmemo_s: '',
    csname_s: '', cstel_s: '', csadd_s: '', odcstel_s: '', txtodid: '',
    'image.x': '10', 'image.y': '10',
  };
  const html = deliproRequest_(client, 'deli.php', { method: 'post', payload: payload }).getContentText('UTF-8');
  client.lastHtml = html; // 調査用(probeDeliproPages)に画面をそのまま残す
  const parsed = parseDeliList_(html);
  if (parsed.total !== null && parsed.total !== parsed.orders.length) {
    throw new Error('集配一覧の件数が合いません(表示' + parsed.total + '件・取得' + parsed.orders.length + '件)。画面の仕様変更の可能性があります');
  }
  return parsed.orders;
}

/** Cookieを引き継ぎながらリダイレクトをたどる */
function deliproRequest_(client, path, opts) {
  let url = /^https?:/.test(path) ? path : DELIPRO_BASE + path;
  let options = opts;
  for (let i = 0; i < 6; i++) {
    const res = UrlFetchApp.fetch(url, Object.assign({}, options, {
      followRedirects: false,
      muteHttpExceptions: true,
      headers: Object.assign({}, options.headers, { Cookie: Object.keys(client.jar).map(function (k) { return k + '=' + client.jar[k]; }).join('; ') }),
    }));
    const headers = res.getAllHeaders();
    [].concat(headers['Set-Cookie'] || headers['set-cookie'] || []).forEach(function (c) {
      const kv = String(c).split(';')[0];
      const eq = kv.indexOf('=');
      if (eq > 0) client.jar[kv.slice(0, eq).trim()] = kv.slice(eq + 1).trim();
    });
    const code = res.getResponseCode();
    if (client.trace) client.trace.push((options.method || 'get') + ' ' + url.replace(DELIPRO_BASE, '') + ' → ' + code);
    const location = headers['Location'] || headers['location'];
    if (code >= 300 && code < 400 && location) {
      url = /^https?:/.test(location) ? location : DELIPRO_BASE + String(location).replace(/^\.?\//, '');
      options = { method: 'get' };
      continue;
    }
    if (code >= 400) throw new Error('デリプロへのアクセスに失敗しました(HTTP ' + code + '): ' + url);
    return res;
  }
  throw new Error('リダイレクトが多すぎます: ' + path);
}

/**
 * 売上分析(期間)で、配達日 from〜to・注文区分・注文状態を指定して、注文合計と税率別の金額を取る
 * @param {string} orderType 注文区分のID('0'=未設定)
 * @param {string} status '0'=確定 / '1'=保留
 */
function deliproTaxSummary_(client, fromYmd, toYmd, orderType, status) {
  const payload = {
    daytype: '2', // お届け日
    datSt: fromYmd.replace(/-/g, '/'), slt_sttime: '0',
    datEd: toYmd.replace(/-/g, '/'), slt_edtime: '24',
    slt_group: '1', // 月別(合計欄だけを使う)
    txt_discount_min: '', txt_discount_max: '',
    odspid_s: '1',
    txt_odcszip: '', txt_odcsadd: '', txt_odmemo: '',
    'odtype[]': orderType,
    odstatus: status,
    txt_csid: '', txt_csname: '', txt_cstel: '',
    hid_mode: '',
  };
  // 参照元(Referer/Origin)を付けないと、デリプロは「お届け日」「注文区分」の条件を無視する(2026/10 probeTaxVariants で確認)
  const html = deliproRequest_(client, 'analyze_sale_time.php', {
    method: 'post', payload: payload,
    headers: { Referer: DELIPRO_BASE + 'analyze_sale_time.php', Origin: 'https://asp.delipro.jp' },
  }).getContentText('UTF-8');
  client.lastTaxHtml = html; // 調査用(probeTaxRequest)
  // 送った条件が画面に反映されているか確かめる。違えば間違った数字を書かないようにエラーにする
  const f = parseTaxForm_(html);
  if (f.daytype.join() !== '2' || f.odtype.join() !== String(orderType) || f.odstatus.join() !== String(status)) {
    throw new Error('売上分析(期間)で検索条件が効いていません(日付の基準=' + f.daytype + ' 注文区分=' + f.odtype + ' 状態=' + f.odstatus
      + ')。デリプロの仕様変更の可能性があります');
  }
  return parseTaxSummary_(html);
}

// ===== CsvProbe.gs =====
/**
 * 調査用(1回だけ実行): 今月1日〜今日に配達した確定注文で、集配管理の3種類のダウンロード
 * (ダウンロード / 明細DL / 発注書DL)を取得し、マイドライブの「delipro_probe」フォルダにそのまま保存する。
 * PLの売上(注文区分×支払方法×税率)を自動集計するために、CSVの列を確認する目的で使う。
 * メールは送らず、デリプロのデータも変更しない。
 */
function probeDeliproCsv() {
  const cfg = SALES_CONFIG;
  const today = Utilities.formatDate(new Date(), cfg.TIME_ZONE, 'yyyy-MM-dd');
  const first = today.slice(0, 8) + '01';
  const client = deliproLogin_();
  const orders = deliproSearch_(client, first, today, '0', '0');
  const ids = orders.map(function (o) { return o.odid; });
  if (!ids.length) throw new Error('対象の注文がありません');

  const it = DriveApp.getFoldersByName(cfg.PROBE_FOLDER);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(cfg.PROBE_FOLDER);
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
 * 調査用(1回だけ実行): CSVに無い「注文区分」「事業所」「税率」の取り方を調べるため、
 * 集配管理の検索結果の画面(HTML)をそのまま「delipro_probe」フォルダに保存する。
 * 画面の中の選択肢(注文区分など)と、帳票(発注請書など)へのリンクを見る目的で使う。
 */
function probeDeliproPages() {
  const cfg = SALES_CONFIG;
  const today = Utilities.formatDate(new Date(), cfg.TIME_ZONE, 'yyyy-MM-dd');
  const client = deliproLogin_();
  const it = DriveApp.getFoldersByName(cfg.PROBE_FOLDER);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(cfg.PROBE_FOLDER);

  // 検索前の画面と、今日配達分の検索結果(件数が少なく、画面の部品を見るには十分)
  const top = deliproRequest_(client, 'deli.php', { method: 'get' }).getContentText('UTF-8');
  folder.createFile('page_deli_top.html', top, MimeType.HTML);
  deliproSearch_(client, today, today, '0', '0');
  folder.createFile('page_deli_result.html', client.lastHtml, MimeType.HTML);
  Logger.log('保存先: ' + folder.getUrl());
}

/**
 * 調査用(1回だけ実行): 税率別の金額(10%・8%・0%対象)が出る「売上分析(期間)」の画面
 * (analyze_sale_time.php)を「delipro_probe」フォルダに保存する。検索条件の項目名を確認する目的で使う。
 */
function probeDeliproAnalysis() {
  const cfg = SALES_CONFIG;
  const client = deliproLogin_();
  const it = DriveApp.getFoldersByName(cfg.PROBE_FOLDER);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(cfg.PROBE_FOLDER);
  ['analyze_sale_time.php', 'index.php'].forEach(function (path) {
    const html = deliproRequest_(client, path, { method: 'get' }).getContentText('UTF-8');
    folder.createFile('page_' + path.replace('.php', '') + '.html', html, MimeType.HTML);
  });
  Logger.log('保存先: ' + folder.getUrl());
}

/**
 * 調査用(1回だけ実行): 売上分析(期間)に検索条件(今月・大阪直販・確定)を送ったときの返事の画面を
 * 「delipro_probe」フォルダに保存する。画面の検索条件の欄に、送った条件が反映されているかを確認する目的で使う。
 */
function probeTaxRequest() {
  const cfg = SALES_CONFIG;
  const today = Utilities.formatDate(new Date(), cfg.TIME_ZONE, 'yyyy-MM-dd');
  const client = deliproLogin_();
  client.trace = [];
  const it = DriveApp.getFoldersByName(cfg.PROBE_FOLDER);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(cfg.PROBE_FOLDER);
  try {
    const r = deliproTaxSummary_(client, today.slice(0, 8) + '01', today, '4', '0');
    Logger.log('読み取り結果: ' + JSON.stringify(r));
  } catch (e) {
    Logger.log('読み取りエラー: ' + e);
  }
  folder.createFile('page_tax_result.html', client.lastTaxHtml || '', MimeType.HTML);
  Logger.log('通信の経過: ' + client.trace.join(' / '));
  Logger.log('保存先: ' + folder.getUrl());
}

/**
 * 調査用(1回だけ実行): 売上分析(期間)で「お届け日」「注文区分」の条件が効く送り方を探す。
 * 送り方を変えて今月・大阪直販・確定を検索し、返ってきた画面で選ばれている条件と注文合計を実行ログに出す。
 */
function probeTaxVariants() {
  const cfg = SALES_CONFIG;
  const today = Utilities.formatDate(new Date(), cfg.TIME_ZONE, 'yyyy/MM/dd');
  const base = [
    ['daytype', '2'], ['datSt', today.slice(0, 8) + '01'], ['slt_sttime', '0'], ['datEd', today], ['slt_edtime', '24'],
    ['slt_group', '1'], ['txt_discount_min', ''], ['txt_discount_max', ''], ['odspid_s', '1'],
    ['txt_odcszip', ''], ['txt_odcsadd', ''], ['txt_odmemo', ''], ['odtype[]', '4'], ['odstatus', '0'],
    ['txt_csid', ''], ['txt_csname', ''], ['txt_cstel', ''], ['hid_mode', ''],
  ];
  const enc = function (pairs) {
    return pairs.map(function (p) { return encodeURIComponent(p[0]) + '=' + encodeURIComponent(p[1]); }).join('&');
  };
  const obj = {};
  base.forEach(function (p) { obj[p[0]] = p[1]; });
  const variants = [
    ['A 今の送り方', function (c) { return deliproRequest_(c, 'analyze_sale_time.php', { method: 'post', payload: obj }); }],
    ['B 文字列で送る', function (c) {
      return deliproRequest_(c, 'analyze_sale_time.php', { method: 'post', payload: enc(base), contentType: 'application/x-www-form-urlencoded' });
    }],
    ['C 画面を開いてから送る', function (c) {
      deliproRequest_(c, 'analyze_sale_time.php', { method: 'get' });
      return deliproRequest_(c, 'analyze_sale_time.php', { method: 'post', payload: enc(base), contentType: 'application/x-www-form-urlencoded' });
    }],
    ['D URLに付けて送る(GET)', function (c) { return deliproRequest_(c, 'analyze_sale_time.php?' + enc(base), { method: 'get' }); }],
    ['E 参照元を付けて送る', function (c) {
      return deliproRequest_(c, 'analyze_sale_time.php', {
        method: 'post', payload: enc(base), contentType: 'application/x-www-form-urlencoded',
        headers: { Referer: DELIPRO_BASE + 'analyze_sale_time.php', Origin: 'https://asp.delipro.jp' },
      });
    }],
  ];
  variants.forEach(function (v) {
    const client = deliproLogin_();
    client.trace = [];
    try {
      const html = v[1](client).getContentText('UTF-8');
      Logger.log(v[0] + ': ' + describeTaxForm_(html) + ' / 通信: ' + client.trace.join(' → '));
    } catch (e) {
      Logger.log(v[0] + ': エラー ' + e);
    }
  });
}

/** 返ってきた画面で選ばれている日付の基準・注文区分・注文状態と、注文合計 */
function describeTaxForm_(html) {
  const sel = function (name) {
    const m = html.match(new RegExp('<select[^>]*name="' + name.replace(/[[\]]/g, '\\$&') + '"[\\s\\S]*?</select>'));
    if (!m) return '?';
    const out = [];
    const re = /<option value="([^"]*)"\s*([^>]*)>([^<]*)/g;
    let o;
    while ((o = re.exec(m[0])) !== null) if (/selected/.test(o[2])) out.push(o[3].trim());
    return out.length > 3 ? out.length + '個すべて' : out.join(',');
  };
  let total = '?';
  try { total = parseTaxSummary_(html).total; } catch (e) { total = '読めず'; }
  return '日付の基準=' + sel('daytype') + ' 注文区分=' + sel('odtype[]') + ' 状態=' + sel('odstatus') + ' 注文合計=' + total;
}
