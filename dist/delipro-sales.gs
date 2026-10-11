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
 * @return {{odid:string, payment:string, amount:number}[]}
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
  return rows.slice(h + 1).filter(function (r) { return r[cId]; }).map(function (r) {
    return { odid: r[cId], payment: r[cPay] || '(空欄)', amount: Number(String(r[cAmt]).replace(/,/g, '')) || 0 };
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

/** 集計結果を表(2次元配列)にする。1行目が見出し、最終行が合計 */
function summaryToTable_(s) {
  const table = [['注文区分', '件数'].concat(s.payments, ['合計(税込)'])];
  s.types.forEach(function (t) {
    const c = s.cells[t] || {};
    table.push([t, s.rowCount[t] || 0].concat(s.payments.map(function (p) { return c[p] || 0; }), [s.rowTotal[t] || 0]));
  });
  table.push(['合計', s.count].concat(s.payments.map(function (p) { return s.colTotal[p] || 0; }), [s.total]));
  return table;
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

if (typeof module !== 'undefined') module.exports = { parseDeliDownloadCsv_, summarizeOrders_, summaryToTable_, parseCsv_ };

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

function summarizeDeliproSales_(fromYmd, toYmd) {
  const cfg = SALES_CONFIG;
  const client = deliproLogin_();
  const typeNames = cfg.ORDER_TYPES.map(function (t) { return t.name; });
  const fixed = fetchOrders_(client, fromYmd, toYmd, '0');
  const pending = fetchOrders_(client, fromYmd, toYmd, '1');
  const sum = function (o) { return summarizeOrders_(o.orders, o.typeOf, typeNames, cfg.PAYMENT_ORDER); };
  const both = { orders: fixed.orders.concat(pending.orders), typeOf: Object.assign({}, fixed.typeOf, pending.typeOf) };
  const blocks = [
    { title: '確定＋保留(分析画面で注文状態を空欄にしたときと同じ)', summary: sum(both) },
    { title: '確定のみ', summary: sum(fixed) },
    { title: '保留のみ(取り消される可能性あり)', summary: sum(pending) },
  ];
  writeSummarySheet_(fromYmd, toYmd, blocks);
  blocks.forEach(function (b) { Logger.log(b.title + ': ' + b.summary.count + '件 ' + b.summary.total + '円'); });
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
    const none = b.summary.types.indexOf('区分なし');
    if (none !== -1) {
      sh.getRange(row + 2 + none, 1, 1, table[0].length).setBackground('#fff2cc');
      hasNone = true;
    }
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
      headers: { Cookie: Object.keys(client.jar).map(function (k) { return k + '=' + client.jar[k]; }).join('; ') },
    }));
    const headers = res.getAllHeaders();
    [].concat(headers['Set-Cookie'] || headers['set-cookie'] || []).forEach(function (c) {
      const kv = String(c).split(';')[0];
      const eq = kv.indexOf('=');
      if (eq > 0) client.jar[kv.slice(0, eq).trim()] = kv.slice(eq + 1).trim();
    });
    const code = res.getResponseCode();
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
 * 調査用(1回だけ実行): 税率別の金額を出している「分析」画面の場所を調べるため、
 * メインメニューと、その中の「分析」を含むリンク先の画面を「delipro_probe」フォルダに保存する。
 */
function probeDeliproAnalysis() {
  const cfg = SALES_CONFIG;
  const client = deliproLogin_();
  const it = DriveApp.getFoldersByName(cfg.PROBE_FOLDER);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(cfg.PROBE_FOLDER);

  const menu = deliproRequest_(client, 'index.php', { method: 'get' }).getContentText('UTF-8');
  folder.createFile('page_menu.html', menu, MimeType.HTML);
  const re = /<a[^>]*href="([^"#][^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
  const seen = {};
  let m, n = 0;
  while ((m = re.exec(menu)) !== null) {
    const href = m[1], text = m[2].replace(/<[^>]+>/g, '').trim();
    if (text.indexOf('分析') === -1 || /^javascript:/.test(href) || seen[href]) continue;
    seen[href] = true;
    const html = deliproRequest_(client, href.replace(/&amp;/g, '&'), { method: 'get' }).getContentText('UTF-8');
    folder.createFile('page_analysis_' + (++n) + '.html', html, MimeType.HTML);
    Logger.log('分析の画面: ' + text + ' → ' + href);
  }
  Logger.log('保存先: ' + folder.getUrl() + ' / 分析の画面 ' + n + '件');
}
