/**
 * デリプロPDF(見積書・発注請書)から抽出したテキストを解析する純粋関数群。
 * GASのサービスに依存しないので、Node.jsでもテストできる(tests/order-digest-parser.test.js)。
 */

/** ファイル名から書類の種類を判定する。優先度は 控え > 発注請書 > 見積書 */
function classifyDocByName_(fileName) {
  const name = String(fileName || '');
  if (/発注請書[（(]控/.test(name)) return 'order_copy';
  if (/発注請書/.test(name)) return 'order';
  if (/見積書/.test(name)) return 'estimate';
  return null;
}

/** 書類種類の優先度(大きいほど優先して採用する) */
function docRank_(docType) {
  return { order_copy: 3, order: 2, estimate: 1 }[docType] || 0;
}

/**
 * PDFテキストを解析して案件情報を返す。
 * 改行やページ順はPDF変換方法で変わるため、空白を1つにまとめてから正規表現で拾う。
 */
function parseDeliproText_(rawText) {
  const t = String(rawText || '').replace(/\s+/g, ' ').trim();
  const result = {
    docType: null,
    deliveryDate: null, // 'YYYY-MM-DD'
    deliveryTime: '',
    place: '',
    client: '',
    contact: '',
    total: null,
    office: '',
    number: '',
    memo: '',
    changeDeadlineDays: null,
    items: [],
    headcount: null,
  };

  if (/発\s?注\s?請\s?書\s?[（(]\s?控/.test(t)) result.docType = 'order_copy';
  else if (/発\s?注\s?請\s?書/.test(t)) result.docType = 'order';
  else if (/お\s?見\s?積\s?書/.test(t)) result.docType = 'estimate';

  let m = t.match(/納品日\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (m) result.deliveryDate = m[1] + '-' + pad2_(m[2]) + '-' + pad2_(m[3]);

  m = t.match(/納品時間\s*(.+?)\s*納品場所/);
  if (m) result.deliveryTime = m[1].trim();

  m = t.match(/納品場所\s*(.+?)\s*ご担当者/);
  if (m) result.place = m[1].trim();

  m = t.match(/ご担当者\s*(.+?)\s*様/);
  if (m) result.contact = m[1].trim();

  // タイトル(発注請書/見積書)の直後〜「御中/様 下記の通り」の間が宛名。間に別のタイトルを挟まないようにする
  m = t.match(/(?:請\s?書(?:\s?[（(]\s?控\s?[）)])?|見\s?積\s?書)\s+((?:(?!請\s?書|見\s?積\s?書).)+?)\s*(?:御中|様)\s*下記の通り/);
  if (m) result.client = m[1].trim();

  m = t.match(/合計金額\s*[¥￥]\s*(-?[\d,]+)/);
  if (m) result.total = toNumber_(m[1]);

  m = t.match(/担当：\s*(\S+)/);
  if (m) result.office = m[1].replace(/事業所$/, '');

  m = t.match(/(?:発注|見積)番号：\s*(?:発行日：\s*)?(\d+)/);
  if (m) result.number = m[1];

  m = t.match(/【社内メモ】\s*(.+?)\s*(?:Powered by|発\s?注\s?請\s?書|お\s?見\s?積\s?書|<?https?:|$)/);
  if (m) result.memo = m[1].trim();

  m = t.match(/確定・変更は開催日の\s*(\d+)\s*日前まで/);
  if (m) result.changeDeadlineDays = Number(m[1]);

  result.items = parseItems_(t);
  result.headcount = estimateHeadcount_(result.items);
  return result;
}

/** 「内容 単価 数量 金額(税込) 税率」〜「税率別内訳」の明細行を取り出す */
function parseItems_(t) {
  const start = t.search(/内容\s*単価\s*数量\s*金額/);
  if (start === -1) return [];
  const afterHeader = t.slice(start).replace(/^内容\s*単価\s*数量\s*金額\s*[（(]税込[）)]\s*税率\s*/, '');
  const endIdx = afterHeader.search(/税率別内訳/);
  const body = endIdx === -1 ? afterHeader : afterHeader.slice(0, endIdx);

  const items = [];
  const re = /(.+?)\s(-?[\d,]+)\s(\d+)\s(-?[\d,]+)\s(?:8|10)%対象/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    items.push({
      name: m[1].trim(),
      unitPrice: toNumber_(m[2]),
      qty: Number(m[3]),
      amount: toNumber_(m[4]),
    });
  }
  return items;
}

/**
 * 人数の推定: 料理・ドリンクプランの数量の最大値。
 * 諸経費・値引・配送・容器回収・単品・追加メニューなど、人数と関係ない行は除外する。
 */
function estimateHeadcount_(items) {
  const excluded = /^\(雑\)|（雑）|諸経費|値引|配送費|容器回収|\(単品\)|（単品）|追加メニュー|ドリンクセット/;
  let max = null;
  (items || []).forEach(function (it) {
    if (excluded.test(it.name)) return;
    if (it.qty > 0 && (max === null || it.qty > max)) max = it.qty;
  });
  return max;
}

/**
 * 案件フォルダ名「MMDD_★顧客名」の日付が、[from, to] の期間に入るか判定し、入るならその日付を返す。
 * 年の記載がないため、今年・来年の両方を試す(12月に1月の案件を拾うため)。
 * @param {number[]} fromYmd [y, m, d]
 * @param {number[]} toYmd [y, m, d]
 * @return {string|null} 'YYYY-MM-DD'
 */
function folderDateInRange_(folderName, pattern, fromYmd, toYmd) {
  const m = String(folderName || '').match(pattern);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const from = ymdKey_(fromYmd[0], fromYmd[1], fromYmd[2]);
  const to = ymdKey_(toYmd[0], toYmd[1], toYmd[2]);
  for (let y = fromYmd[0]; y <= toYmd[0]; y++) {
    const key = ymdKey_(y, month, day);
    if (key >= from && key <= to) return key;
  }
  return null;
}

/**
 * 同じ案件フォルダ内のPDFから、一覧に載せる1件を選ぶ。
 * 発注請書があれば「確定」、見積書しかなければ「保留」。同じ種類が複数あれば新しいものを採用。
 * @param {{name:string, created:number}[]} files
 * @return {{file:Object, status:string, estimateCount:number}|null}
 */
function pickRepresentativeFile_(files) {
  let best = null;
  let estimateCount = 0;
  (files || []).forEach(function (f) {
    const type = classifyDocByName_(f.name);
    if (!type) return;
    if (type === 'estimate') estimateCount++;
    const rank = docRank_(type);
    if (!best || rank > best.rank || (rank === best.rank && f.created > best.file.created)) {
      best = { file: f, rank: rank, type: type };
    }
  });
  if (!best) return null;
  return {
    file: best.file,
    docType: best.type,
    status: best.type === 'estimate' ? '保留' : '確定',
    estimateCount: estimateCount,
  };
}

function ymdKey_(y, m, d) {
  return y + '-' + pad2_(m) + '-' + pad2_(d);
}

function pad2_(n) {
  return ('0' + Number(n)).slice(-2);
}

function toNumber_(s) {
  return Number(String(s).replace(/,/g, ''));
}

/** 'YYYY-MM-DD' に日数を足す(タイムゾーンの影響を受けないようUTCで計算) */
function addDaysYmd_(ymd, days) {
  const p = ymd.split('-').map(Number);
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + days));
  return ymdKey_(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** 2つの 'YYYY-MM-DD' の差(日数) */
function diffDaysYmd_(fromYmd, toYmd) {
  const a = fromYmd.split('-').map(Number);
  const b = toYmd.split('-').map(Number);
  return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86400000);
}

/** 'YYYY-MM-DD' → 'M/D(曜)' */
function formatYmdJa_(ymd) {
  const p = ymd.split('-').map(Number);
  const w = ['日', '月', '火', '水', '木', '金', '土'][new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay()];
  return p[1] + '/' + p[2] + '(' + w + ')';
}

/** 数量最大の料理・ドリンクプラン名(一覧で「何を作るか」を一目で分かるようにする) */
function mainPlanName_(items) {
  const excluded = /^\(雑\)|（雑）|諸経費|値引|配送費|容器回収|追加メニュー/;
  let best = null;
  (items || []).forEach(function (it) {
    if (excluded.test(it.name)) return;
    if (!best || it.qty > best.qty) best = it;
  });
  return best ? best.name : '';
}

/** 納品時間「9:00～10:00」を並び替え用に '09:00' 形式へ。読めなければ最後尾 */
function timeSortKey_(timeText) {
  const m = String(timeText || '').match(/(\d{1,2})\s*[:：]\s*(\d{2})/);
  return m ? pad2_(m[1]) + ':' + m[2] : '99:99';
}
