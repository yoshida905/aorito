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
        issues.push('【人件費】タイミーのCSVを取り込みました(' + lb.months.join(',') + ')。「人件費_yyyy-MM」シートを確認してください');
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
