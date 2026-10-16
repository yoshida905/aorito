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
  cfg.LINK_SITES.forEach(function (site) {
    const name = cfg.SITES[site];
    const sh = pl.getSheetByName(name);
    if (!sh) throw new Error('PLに「' + name + '」シートがありません');
    cfg.SUPPLIERS.forEach(function (x) {
      if (!(site in x.rows)) return;
      months.forEach(function (ym) {
        const cell = sh.getRange(x.rows[site], plColumnOf_(ym, SALES_CONFIG.PL_FIRST_MONTH, SALES_CONFIG.PL_FIRST_COLUMN));
        const a1 = cell.getA1Notation();
        const next = '=IMPORTRANGE("' + ss.getId() + '","\'' + name + '\'!' + a1 + '")';
        const f = cell.getFormula();
        if (f === next) return;
        if (f && !/^=IMPORTRANGE\(/i.test(f)) { skipped.push(name + '!' + a1 + ' ' + f); return; }
        log.push([now, name, a1, "'" + (f || cell.getValue()), "'" + next]);
        cell.setFormula(next);
      });
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
