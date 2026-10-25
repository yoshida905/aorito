/**
 * デリプロ「集配管理(deli.php)」の検索結果HTMLを解析する純粋関数群。
 * Node.jsでもテストできる(tests/kitchen-parser.test.js)。
 */

/**
 * @return {{total:number|null, amount:number|null, orders:{odid:string, status:string, date:string, time:string, office:string, staff:string, orderType:string, car:string, depart:string}[]}}
 */
function parseDeliList_(html) {
  const s = String(html || '');
  const totalMatch = s.match(/全\s*(\d+)\s*件/);
  const orders = [];
  const re = /<tr[^>]*class="tr_order[^"]*"[^>]*data-odid="(\d+)"/g;
  const starts = [];
  let m;
  while ((m = re.exec(s)) !== null) starts.push({ index: m.index, odid: m[1] });

  starts.forEach(function (st, i) {
    const block = s.slice(st.index, i + 1 < starts.length ? starts[i + 1].index : s.length);
    orders.push(isNewLayout_(block) ? parseNewRow_(st.odid, block) : parseOldRow_(st.odid, block));
  });

  const amountMatch = s.match(/合計金額\s*[￥¥]\s*([\d,]+)/);
  return {
    total: totalMatch ? Number(totalMatch[1]) : null,
    // 検索結果全体の合計金額(税込)
    amount: amountMatch ? Number(amountMatch[1].replace(/,/g, '')) : null,
    orders: orders,
  };
}

/**
 * 2026年10月以降の新しい集配管理画面の1件分。
 * 受付欄(div_reception)に注文区分・受付事業所、配達欄(div_delidate)に配達日時・配達スタッフ、
 * 隠し項目に配車(hid_odtruck)・出発日時(hid_oddeparttime)がある
 */
function parseNewRow_(odid, block) {
  const deli = (block.match(/class="div_delidate">([\s\S]*?)<div class="div_inst">/) || [])[1] ||
    (block.match(/class="div_delidate">([\s\S]*?)<\/td>/) || [])[1] || '';
  // 受付欄は「div_reception」から配達欄の手前まで
  const recStart = block.indexOf('div_reception');
  const recText = recStart === -1 ? '' : block.slice(recStart, block.indexOf('div_delidate'));
  const date = deli.match(/(\d{4}-\d{2}-\d{2})\s*<\/span>/);
  const time = deli.match(/<\/span>\s*<span[^>]*>\s*(\d{1,2}:\d{2})\s*<\/span>/);
  const staff = deli.match(/icon_staff[^>]*><\/i>\s*([^<]+?)\s*<\/div>/);
  const office = recText.match(/icon_staff[^>]*><\/i>\s*([^<]+?)\s*<\/div>/);
  const orderType = block.match(/class="chip_odtype[^"]*">\s*([^<]+?)\s*<\/span>/);
  const hidden = function (name) {
    const m = block.match(new RegExp('id="hid_' + name + '_' + odid + '"\\s*value="([^"]*)"'));
    return m ? m[1].trim() : '';
  };
  const truck = hidden('odtruck');
  const depart = hidden('oddeparttime').match(/(\d{1,2}:\d{2})/);
  const staffName = staff ? staff[1].trim() : '';
  return {
    odid: odid,
    status: /font-weight:\s*bold"?>\s*保留\s*</.test(block) ? '保留' : '確定',
    date: date ? date[1] : '',
    time: time ? time[1] : '',
    office: office ? office[1].trim() : '',
    staff: staffName === '未設定' ? '' : staffName,
    orderType: orderType ? orderType[1].trim() : '',
    car: truck && truck !== '0' ? truck + '号車' : '',
    depart: depart ? ('0' + depart[1]).slice(-5) : '',
  };
}

function isNewLayout_(block) {
  return block.indexOf('div_delidate') !== -1;
}

/** 2026年10月より前の集配管理画面の1件分 */
function parseOldRow_(odid, block) {
  const dateM = block.match(/(\d{4}-\d{2}-\d{2})(?:\s*<br\s*\/?>\s*<span[^>]*>\s*(\d{1,2}:\d{2}))?/);
  // 1行目の「alignCenter」セル: [受付(事業所), 配送指示(配送員)]。2行目の1つ目は注文区分
  const rowEnd = block.indexOf('</tr>');
  const first = alignCenterCells_(rowEnd === -1 ? block : block.slice(0, rowEnd));
  const second = alignCenterCells_(rowEnd === -1 ? '' : block.slice(rowEnd + 5));
  return {
    odid: odid,
    status: /font-weight:\s*bold"?>\s*保留\s*</.test(block) ? '保留' : '確定',
    date: dateM ? dateM[1] : '',
    time: dateM && dateM[2] ? dateM[2] : '',
    office: first[0] || '',
    staff: first[1] || '',
    orderType: second[0] || '',
    car: '',
    depart: '',
  };
}

/** タグを含まない「alignCenter」セルの文字を、空欄も含めて順に返す */
function alignCenterCells_(html) {
  const out = [];
  const re = /<td[^>]*class="alignCenter"[^>]*>([^<]*)<\/td>/g;
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1].replace(/\s+/g, ' ').trim());
  return out;
}
