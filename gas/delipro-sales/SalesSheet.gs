/**
 * 集計結果を専用のスプレッドシート(SALES_CONFIG.SHEET_NAME)に書き込む。月ごとに1シート(例: 2026-10)。
 * PLのファイルには書き込まない(PL側からは数式で参照するか、数字を写す)。
 */
function writeSummarySheet_(fromYmd, toYmd, summary) {
  const ss = openSalesSpreadsheet_();
  const name = fromYmd.slice(0, 7);
  const sh = ss.getSheetByName(name) || ss.insertSheet(name, 0);
  sh.clear();
  const table = summaryToTable_(summary);
  const now = Utilities.formatDate(new Date(), SALES_CONFIG.TIME_ZONE, 'yyyy/MM/dd HH:mm');
  sh.getRange(1, 1).setValue('配達日 ' + fromYmd + '〜' + toYmd + '・確定のみ・税込(デリプロの合計金額)・更新 ' + now);
  sh.getRange(3, 1, table.length, table[0].length).setValues(table);
  sh.getRange(3, 1, 1, table[0].length).setFontWeight('bold').setBackground('#eeeeee');
  sh.getRange(3 + table.length - 1, 1, 1, table[0].length).setFontWeight('bold');
  sh.getRange(4, 2, table.length - 1, table[0].length - 1).setNumberFormat('#,##0');
  const none = summary.types.indexOf('区分なし');
  if (none !== -1) {
    sh.getRange(4 + none, 1, 1, table[0].length).setBackground('#fff2cc');
    sh.getRange(3 + table.length + 1, 1).setValue('※「区分なし」はデリプロで注文区分が未入力の注文です。デリプロで区分を入れてから再実行してください');
  }
  sh.autoResizeColumns(1, table[0].length);
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
