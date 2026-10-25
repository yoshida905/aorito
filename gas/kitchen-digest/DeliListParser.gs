/**
 * デリプロ「集配管理(deli.php)」の検索結果HTMLを解析する純粋関数群。
 * Node.jsでもテストできる(tests/kitchen-parser.test.js)。
 */

/**
 * @return {{total:number|null, amount:number|null, orders:{odid:string, status:string, date:string, time:string, office:string, staff:string, orderType:string}[]}}
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
    const dateM = block.match(/(\d{4}-\d{2}-\d{2})(?:\s*<br\s*\/?>\s*<span[^>]*>\s*(\d{1,2}:\d{2}))?/);
    // 1行目の「alignCenter」セル: [受付(事業所), 配送指示(配送員)]。2行目の1つ目は注文区分
    const rowEnd = block.indexOf('</tr>');
    const firstRow = rowEnd === -1 ? block : block.slice(0, rowEnd);
    const secondRow = rowEnd === -1 ? '' : block.slice(rowEnd + 5);
    const first = alignCenterCells_(firstRow);
    const second = alignCenterCells_(secondRow);
    orders.push({
      odid: st.odid,
      status: /font-weight:\s*bold"?>\s*保留\s*</.test(block) ? '保留' : '確定',
      date: dateM ? dateM[1] : '',
      time: dateM && dateM[2] ? dateM[2] : '',
      office: first[0] || '',
      staff: first[1] || '',
      orderType: second[0] || '',
    });
  });
  const amountMatch = s.match(/合計金額\s*[￥¥]\s*([\d,]+)/);
  return {
    total: totalMatch ? Number(totalMatch[1]) : null,
    // 検索結果全体の合計金額(税込)
    amount: amountMatch ? Number(amountMatch[1].replace(/,/g, '')) : null,
    orders: orders,
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
