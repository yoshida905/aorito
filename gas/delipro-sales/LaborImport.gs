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
