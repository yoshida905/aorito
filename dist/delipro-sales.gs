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
      { type: '大阪南海', rows: { 請求書: 25, r8: 26, ex: 27 } },
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

  // 毎朝の自動実行の時刻(時)。GASの仕様上、この時刻から1時間以内のどこかで実行される
  TRIGGER_HOUR: 6,
  // 月初の何日間、前月分も更新して「保留が残っていないか」を確認するか
  CLOSE_CHECK_DAYS: 5,

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
 * @return {{cells:{sheet:string,row:number,value:number}[], unmapped:{type:string,item:string,amount:number}[]}}
 *   unmapped はPLに置き場所がない金額(例: 東京直販の「未定」)。PLに載らず漏れるので知らせる
 */
function buildPlCells_(summary, layout) {
  const cells = [], unmapped = [];
  const placed = {};
  layout.forEach(function (sh) {
    sh.blocks.forEach(function (b) {
      placed[b.type] = true;
      const c = summary.cells[b.type] || {};
      const tx = (summary.tax && summary.tax[b.type]) || { r10: 0, r8: 0, r0: 0, exTax: 0 };
      Object.keys(b.rows).forEach(function (key) {
        const value = key === 'ex' ? tx.exTax : /^r(10|8|0)$/.test(key) ? tx[key] : (c[key] || 0);
        cells.push({ sheet: sh.sheet, row: b.rows[key], value: value });
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
  const cfg = SALES_CONFIG;
  const ym = PropertiesService.getScriptProperties().getProperty('COMPARE_MONTH') || Utilities.formatDate(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1), cfg.TIME_ZONE, 'yyyy-MM');
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
