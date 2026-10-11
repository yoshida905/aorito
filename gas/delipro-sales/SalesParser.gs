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
