/**
 * アルバイト人件費のCSV(月1回、フォルダ payroll_csv に置く)から、PLの112行(タイミー)を集計する。
 * 書き込み先は集計用スプレッドシートのPL転記用シート(PLと同じシート名・同じセル番地)。PLのファイルには書き込まない。
 * 個人の名前・金額はシートに書かず、事業所ごとの合計だけを書く
 */

/** フォルダ内のタイミーのCSVをすべて読み、含まれる月の112行を書く(手動実行・自動実行用。何度実行してもよい) */
function importLaborCsv() {
  const cfg = SALES_CONFIG.LABOR;
  const sites = SALES_CONFIG.INFOMART.SITES;
  const r = { cells: [], lines: [], unmapped: [] };
  const seen = {};
  laborCsvFiles_().forEach(function (f) {
    const text = f.getBlob().getDataAsString('UTF-8');
    if (!isTimeeCsv_(text)) return; // 勤怠のCSVなどは、いまは使わない
    // 同じ締めの明細を2回置いても二重に数えないよう、ファイル名ごとに1回だけ読む
    const key = f.getName().replace(/\s*\(\d+\)(?=\.csv$)/i, '');
    if (seen[key]) return;
    seen[key] = true;
    const x = summarizeTimee_(text, cfg.TIMEE.RULES);
    r.cells = r.cells.concat(x.cells);
    r.lines = r.lines.concat(x.lines);
    r.unmapped = r.unmapped.concat(x.unmapped);
  });
  const ss = openSalesSpreadsheet_();
  const months = {};
  r.lines.concat(r.unmapped).forEach(function (l) { months[l.ym] = true; });
  Object.keys(months).sort().forEach(function (ym) {
    const col = plColumnOf_(ym, SALES_CONFIG.PL_FIRST_MONTH, SALES_CONFIG.PL_FIRST_COLUMN);
    Object.keys(sites).forEach(function (site) {
      const sh = ss.getSheetByName(sites[site]) || ss.insertSheet(sites[site]);
      sh.getRange(2, col).setValue(Number(ym.slice(5, 7)) + '月');
      sh.getRange(cfg.TIMEE.ROW, 2, 1, 2).setValues([['タイミー', 'アルバイト人件費(タイミー・合計報酬額)']]);
      const v = r.cells.filter(function (c) { return c.ym === ym && c.site === site; })
        .reduce(function (a, c) { return a + c.value; }, 0);
      sh.getRange(cfg.TIMEE.ROW, col).setValue(v).setNumberFormat('#,##0');
    });
    writeLaborDetail_(ss, ym, r);
  });
  Logger.log('タイミー: 月 ' + Object.keys(months).sort().join(',')
    + (r.unmapped.length ? '。事業所が決まらない求人 ' + r.unmapped.length + '件(「人件費_yyyy-MM」シート)' : ''));
  return { months: Object.keys(months).sort(), unmapped: r.unmapped };
}

/** 「人件費_yyyy-MM」シートに、事業所×求人ごとの件数・時間・報酬・利用料を書く(個人ごとには書かない) */
function writeLaborDetail_(ss, ym, r) {
  const name = '人件費_' + ym;
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.clear();
  const out = [['事業所', '求人', '件数', '実働時間', '合計報酬額(PLに入れる額)', '利用料(参考・PLに入れない)']];
  r.lines.filter(function (l) { return l.ym === ym; }).forEach(function (l) {
    out.push([l.site, l.title, l.count, l.hours, l.amount, l.fee]);
  });
  sh.getRange(1, 1).setValue(ym + ' タイミー(求人日の月)・更新 ' + Utilities.formatDate(new Date(), SALES_CONFIG.TIME_ZONE, 'yyyy/MM/dd HH:mm'));
  sh.getRange(3, 1, out.length, out[0].length).setValues(out);
  sh.getRange(3, 1, 1, out[0].length).setFontWeight('bold').setBackground('#eeeeee');
  sh.getRange(4, 5, Math.max(out.length - 1, 1), 2).setNumberFormat('#,##0');
  const miss = r.unmapped.filter(function (u) { return u.ym === ym; });
  if (!miss.length) return;
  const m = [['求人', '件数', '合計報酬額', '理由']].concat(miss.map(function (u) {
    return [u.title, u.count, u.amount, '求人タイトルから事業所が決まらない(Config.gs の LABOR.TIMEE.RULES に足す)'];
  }));
  sh.getRange(out.length + 5, 1, m.length, 4).setValues(m).setBackground('#fff2cc');
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
  const row = SALES_CONFIG.LABOR.TIMEE.ROW;
  const col = plColumnOf_(ym, SALES_CONFIG.PL_FIRST_MONTH, SALES_CONFIG.PL_FIRST_COLUMN);
  const sites = SALES_CONFIG.INFOMART.SITES;
  const out = [['事業所', 'PLの行', '項目', 'PL(手入力)', 'タイミー(自動)', '差']];
  Object.keys(sites).forEach(function (site) {
    const auto = Number(ss.getSheetByName(sites[site]).getRange(row, col).getValue()) || 0;
    const manual = Number(pl.getSheetByName(sites[site]).getRange(row, col).getValue()) || 0;
    out.push([site, row, 'タイミー', manual, auto, auto - manual]);
  });
  const name = '人件費照合_' + ym;
  const sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.clear();
  sh.getRange(1, 1, out.length, out[0].length).setValues(out);
  sh.getRange(1, 1, 1, out[0].length).setFontWeight('bold').setBackground('#eeeeee');
  sh.getRange(2, 4, out.length - 1, 3).setNumberFormat('#,##0');
  Logger.log(ym + ': ' + out.slice(1).map(function (x) { return x[0] + ' 差 ' + x[5]; }).join(' / '));
}

/** PLの112行(タイミー)を、LINK_FROM_MONTH の月から IMPORTRANGE の式に切り替える(手動実行。1回でよい) */
function linkPlLaborFormulas() {
  const sites = SALES_CONFIG.INFOMART.SITES;
  linkPlRows_(Object.keys(sites).map(function (site) { return { sheet: sites[site], row: SALES_CONFIG.LABOR.TIMEE.ROW }; }));
}
