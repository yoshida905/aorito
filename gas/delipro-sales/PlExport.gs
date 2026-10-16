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
