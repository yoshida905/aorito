/**
 * デリプロ「集配管理(deli.php)」の検索結果HTMLを解析する純粋関数群。
 * Node.jsでもテストできる(tests/kitchen-parser.test.js)。
 */

/**
 * @return {{total:number|null, orders:{odid:string, status:string, date:string, time:string, office:string}[]}}
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
    // 1つ目の「alignCenter」で中身のあるセルが受付(事業所)
    const cells = [];
    const cellRe = /<td[^>]*class="alignCenter"[^>]*>([^<]*)<\/td>/g;
    let cm;
    while ((cm = cellRe.exec(block)) !== null) {
      const text = cm[1].replace(/\s+/g, ' ').trim();
      if (text) cells.push(text);
    }
    orders.push({
      odid: st.odid,
      status: /font-weight:\s*bold"?>\s*保留\s*</.test(block) ? '保留' : '確定',
      date: dateM ? dateM[1] : '',
      time: dateM && dateM[2] ? dateM[2] : '',
      office: cells[0] || '',
    });
  });
  return { total: totalMatch ? Number(totalMatch[1]) : null, orders: orders };
}
