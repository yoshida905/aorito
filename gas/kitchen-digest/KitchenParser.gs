/**
 * デリプロ「キッチン指示書(注文別:メイン)」PDFのテキストを注文ごとに分解する純粋関数群。
 * GASのサービスに依存しないので、Node.jsでもテストできる(tests/kitchen-parser.test.js)。
 */

/**
 * @param {string} rawText PDFから取り出したテキスト
 * @param {string} todayYmd 'YYYY-MM-DD'。PDFに年の記載がないため、年の補完に使う
 * @return {Object[]} 注文の配列(お届け日時順)
 */
function parseKitchenText_(rawText, todayYmd) {
  const t = String(rawText || '').replace(/\s+/g, ' ').trim();
  const headRe = /注文番号\s*No\.\s*(\d+)\s+(\d{1,2})\/(\d{1,2})\s*[（(](.)[）)]\s*(?:(\d{1,2}:\d{2})\s*)?お届け/g;
  const heads = [];
  let m;
  while ((m = headRe.exec(t)) !== null) {
    heads.push({ index: m.index, end: headRe.lastIndex, m: m });
  }

  return heads.map(function (h, i) {
    const bodyEnd = i + 1 < heads.length ? heads[i + 1].index : t.length;
    const body = t.slice(h.end, bodyEnd).replace(/\s*Powered by TCPDF.*$/, '').trim();
    return buildKitchenOrder_(h.m, body, todayYmd);
  });
}

function buildKitchenOrder_(m, body, todayYmd) {
  const order = {
    number: m[1],
    date: inferYear_(Number(m[2]), Number(m[3]), todayYmd),
    weekday: m[4],
    time: m[5] || '',
    client: '',
    place: '',
    plans: [],
    headcount: null,
    details: '',
  };

  // 先頭の「1/1」(ページ番号)を外し、「【プラン × 数量】」の手前までを宛名・住所とみなす
  const text = body.replace(/^\d+\/\d+\s*/, '');
  const firstPlan = text.indexOf('【');
  const header = firstPlan === -1 ? text : text.slice(0, firstPlan);

  const plansAndItems = firstPlan === -1 ? '' : text.slice(firstPlan);
  const planRe = /【(.+?)\s*[×x]\s*(\d+)】/g;
  let pm;
  let lastPlanEnd = 0;
  while ((pm = planRe.exec(plansAndItems)) !== null) {
    order.plans.push({ name: pm[1].trim(), qty: Number(pm[2]) });
    lastPlanEnd = planRe.lastIndex;
  }

  // 宛名と住所の区切りは「様」か「御中」。南海などプラン欄がない注文は、明細が宛名行に続くため
  // 住所の後ろの明細は別途 details として扱う
  const hm = header.match(/^(.+?(?:様|御中))\s*(.*)$/);
  if (hm) {
    order.client = hm[1].replace(/\s*(?:様|御中)$/, '').trim();
    order.place = hm[2].trim();
  } else {
    order.place = header.trim();
  }
  order.details = firstPlan === -1 ? '' : plansAndItems.slice(lastPlanEnd).trim();
  if (firstPlan === -1) {
    // プラン欄なし: 住所の後ろに「商品名 数量」が続く。数字で始まる番地と区別できないため、
    // 住所は宛名直後の最初の空白区切りまでとし、残りを明細とする
    const parts = order.place.split(' ');
    order.place = parts.shift() || '';
    order.details = parts.join(' ');
  }

  order.headcount = estimateKitchenHeadcount_(order.plans, order.details);
  return order;
}

/**
 * 人数の推定。次の最大値を採用する。
 * - プラン欄(【プラン × 数量】)の数量。諸経費・単品・ドリンク単品・LIVE・ケーキなど人数と関係ない行は除外
 * - 料理明細の数量(複数プランを足した人数分の料理があるため。例: (C)×20 + (H)×16 → 料理36)
 * - 「(20人前) 1」のような大皿は 人前×数量
 */
function estimateKitchenHeadcount_(plans, details) {
  const excluded = /^\(雑\)|（雑）|諸経費|\(単品\)|（単品）|追加メニュー|ドリンクセット|\d(?:\.\d)?L$|LIVE|ケーキ/;
  let max = null;
  const take = function (n) {
    if (n > 0 && (max === null || n > max)) max = n;
  };
  (plans || []).forEach(function (p) {
    if (!excluded.test(p.name)) take(p.qty);
  });

  const text = String(details || '');
  const servingRe = /[（(](\d+)人前[）)]\s+(\d+)/g;
  let sm;
  while ((sm = servingRe.exec(text)) !== null) take(Number(sm[1]) * Number(sm[2]));

  const numRe = /(?:^|\s)(\d{1,4})(?=\s|$)/g;
  let nm;
  while ((nm = numRe.exec(text)) !== null) take(Number(nm[1]));
  return max;
}

/** 月日だけの日付に年を補う。今日から見て半年以上前なら翌年とみなす(12月に1月分を出す場合) */
function inferYear_(month, day, todayYmd) {
  const p = todayYmd.split('-').map(Number);
  let year = p[0];
  if (month < p[1] - 6) year++;
  return year + '-' + ('0' + month).slice(-2) + '-' + ('0' + day).slice(-2);
}
