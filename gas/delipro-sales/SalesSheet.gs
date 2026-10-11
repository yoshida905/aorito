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
