/**
 * デリプロ(TCPDF)が出力するPDFから、GoogleのOCRを使わずに文字を取り出す。
 * デリプロのPDFは日本語をUTF-16BE(Identity-H)で埋め込んでいるため、
 * 圧縮(FlateDecode)を展開して文字列を読むだけで正確な文字が得られる。
 * GASのサービスに依存しないので、Node.jsでもテストできる。
 */

/**
 * @param {number[]|Uint8Array} bytes PDFのバイト列(GASの blob.getBytes() は負の値を含むがそのまま渡してよい)
 * @return {string} 1行=PDF上の1つの文字列ブロック
 */
function extractPdfText_(bytes) {
  const data = toUint8_(bytes);
  const latin = bytesToLatin1_(data);
  const objects = indexPdfObjects_(latin);
  const fontIsUnicode = mapFontEncodings_(latin, objects);

  const lines = [];
  const streamRe = /<<((?:(?!>>\s*stream)[\s\S])*?)>>\s*stream\r?\n/g;
  let m;
  while ((m = streamRe.exec(latin)) !== null) {
    const dict = m[1];
    if (/\/Subtype\s*\/(Image|Type1C|CIDFontType0C|OpenType)|\/Length1|\/FontFile/.test(dict)) continue;
    const start = streamRe.lastIndex;
    const lenMatch = dict.match(/\/Length\s+(\d+)(?!\s+\d+\s+R)/);
    const end = lenMatch ? start + Number(lenMatch[1]) : latin.indexOf('endstream', start);
    let content = data.subarray(start, end);
    if (/\/FlateDecode/.test(dict)) {
      try {
        content = inflateZlib_(content);
      } catch (e) {
        continue;
      }
    }
    const text = bytesToLatin1_(content);
    if (!/T[Jj]/.test(text)) continue;
    readContentStream_(text, fontIsUnicode, lines);
    streamRe.lastIndex = end;
  }
  return lines.join('\n');
}

/** 「1 0 obj ... endobj」の位置を番号で引けるようにする */
function indexPdfObjects_(latin) {
  const map = {};
  const re = /(\d+)\s+0\s+obj\b/g;
  let m;
  while ((m = re.exec(latin)) !== null) {
    const end = latin.indexOf('endobj', re.lastIndex);
    map[m[1]] = latin.slice(re.lastIndex, end === -1 ? re.lastIndex + 2000 : Math.min(end, re.lastIndex + 4000));
  }
  return map;
}

/** フォント名(/F1 など) → 2バイト文字(UTF-16BE)のフォントか */
function mapFontEncodings_(latin, objects) {
  const result = {};
  const re = /\/Font\s*<<([^>]*)>>/g;
  let m;
  while ((m = re.exec(latin)) !== null) {
    const entryRe = /\/([A-Za-z0-9_+-]+)\s+(\d+)\s+0\s+R/g;
    let e;
    while ((e = entryRe.exec(m[1])) !== null) {
      const obj = objects[e[2]] || '';
      result[e[1]] = /Identity-H|Type0/.test(obj);
    }
  }
  return result;
}

/** 内容ストリームから BT〜ET ごとに文字列を集めて1行にする */
function readContentStream_(text, fontIsUnicode, lines) {
  let font = '';
  let unicode = true;
  const tokenRe = /\/([A-Za-z0-9_+-]+)\s+[\d.]+\s+Tf|\bBT\b|\bET\b|\((?:\\[\s\S]|[^\\)])*\)|<[0-9A-Fa-f\s]*>/g;
  let current = null;
  let m;
  while ((m = tokenRe.exec(text)) !== null) {
    const tok = m[0];
    if (m[1]) {
      font = m[1];
      unicode = fontIsUnicode[font] !== undefined ? fontIsUnicode[font] : true;
    } else if (tok === 'BT') {
      current = '';
    } else if (tok === 'ET') {
      if (current && current.trim()) lines.push(current.trim());
      current = null;
    } else if (current !== null) {
      const bytes = tok.charAt(0) === '(' ? unescapePdfString_(tok.slice(1, -1)) : hexToBytes_(tok.slice(1, -1));
      current += unicode ? decodeUtf16be_(bytes) : String.fromCharCode.apply(null, bytes);
    }
  }
}

function unescapePdfString_(s) {
  const out = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c !== 0x5c) { out.push(c & 0xff); continue; }
    const n = s.charAt(++i);
    if (n === 'n') out.push(10);
    else if (n === 'r') out.push(13);
    else if (n === 't') out.push(9);
    else if (n === 'b') out.push(8);
    else if (n === 'f') out.push(12);
    else if (/[0-7]/.test(n)) {
      let oct = n;
      while (oct.length < 3 && /[0-7]/.test(s.charAt(i + 1))) oct += s.charAt(++i);
      out.push(parseInt(oct, 8) & 0xff);
    } else if (n === '\r' || n === '\n') {
      if (n === '\r' && s.charAt(i + 1) === '\n') i++;
    } else out.push(n.charCodeAt(0) & 0xff);
  }
  return out;
}

function hexToBytes_(hex) {
  const h = hex.replace(/\s+/g, '');
  const out = [];
  for (let i = 0; i < h.length; i += 2) out.push(parseInt((h.substr(i, 2) + '0').slice(0, 2), 16));
  return out;
}

function decodeUtf16be_(bytes) {
  let s = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const code = (bytes[i] << 8) | bytes[i + 1];
    s += String.fromCharCode(code);
  }
  return s;
}

function toUint8_(bytes) {
  if (bytes instanceof Uint8Array) return bytes;
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] & 0xff;
  return out;
}

function bytesToLatin1_(bytes) {
  let s = '';
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, Array.prototype.slice.call(bytes.subarray(i, i + CHUNK)));
  }
  return s;
}

/**
 * zlib形式(FlateDecode)の展開。RFC1950/1951 に沿った最小限の実装。
 * GASには生のdeflateを展開する関数がないため自前で持つ。
 */
function inflateZlib_(input) {
  const src = toUint8_(input);
  let pos = 2; // zlibヘッダ(2バイト)を飛ばす
  let bitBuf = 0;
  let bitCnt = 0;
  let out = new Uint8Array(Math.max(1024, src.length * 4));
  let outLen = 0;

  function ensure(n) {
    if (outLen + n <= out.length) return;
    let size = out.length * 2;
    while (size < outLen + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(out.subarray(0, outLen));
    out = next;
  }
  function bits(n) {
    while (bitCnt < n) {
      if (pos >= src.length) throw new Error('inflate: 入力が途中で終わりました');
      bitBuf |= src[pos++] << bitCnt;
      bitCnt += 8;
    }
    const v = bitBuf & ((1 << n) - 1);
    bitBuf >>>= n;
    bitCnt -= n;
    return v;
  }
  function buildTable(lengths) {
    const counts = new Uint16Array(16);
    for (let i = 0; i < lengths.length; i++) counts[lengths[i]]++;
    counts[0] = 0;
    const offs = new Uint16Array(16);
    for (let i = 1; i < 16; i++) offs[i] = offs[i - 1] + counts[i - 1];
    const symbols = new Uint16Array(lengths.length);
    for (let i = 0; i < lengths.length; i++) if (lengths[i]) symbols[offs[lengths[i]]++] = i;
    return { counts: counts, symbols: symbols };
  }
  function decode(t) {
    let code = 0, first = 0, index = 0;
    for (let len = 1; len < 16; len++) {
      code |= bits(1);
      const count = t.counts[len];
      if (code - count < first) return t.symbols[index + (code - first)];
      index += count;
      first += count;
      first <<= 1;
      code <<= 1;
    }
    throw new Error('inflate: 符号が不正です');
  }
  const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

  let fixedL = null, fixedD = null;
  let last = 0;
  while (!last) {
    last = bits(1);
    const type = bits(2);
    if (type === 0) {
      bitBuf = 0; bitCnt = 0;
      const len = src[pos] | (src[pos + 1] << 8);
      pos += 4;
      ensure(len);
      out.set(src.subarray(pos, pos + len), outLen);
      outLen += len;
      pos += len;
      continue;
    }
    let lt, dt;
    if (type === 1) {
      if (!fixedL) {
        const l = new Uint8Array(288);
        for (let i = 0; i < 288; i++) l[i] = i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8;
        fixedL = buildTable(l);
        const d = new Uint8Array(30);
        for (let i = 0; i < 30; i++) d[i] = 5;
        fixedD = buildTable(d);
      }
      lt = fixedL; dt = fixedD;
    } else if (type === 2) {
      const hlit = bits(5) + 257, hdist = bits(5) + 1, hclen = bits(4) + 4;
      const order = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
      const cl = new Uint8Array(19);
      for (let i = 0; i < hclen; i++) cl[order[i]] = bits(3);
      const clt = buildTable(cl);
      const lens = new Uint8Array(hlit + hdist);
      for (let i = 0; i < hlit + hdist;) {
        const sym = decode(clt);
        if (sym < 16) lens[i++] = sym;
        else {
          let rep = 0, val = 0;
          if (sym === 16) { val = lens[i - 1]; rep = 3 + bits(2); }
          else if (sym === 17) rep = 3 + bits(3);
          else rep = 11 + bits(7);
          while (rep--) lens[i++] = val;
        }
      }
      lt = buildTable(lens.subarray(0, hlit));
      dt = buildTable(lens.subarray(hlit));
    } else {
      throw new Error('inflate: 不正なブロック形式です');
    }
    for (;;) {
      const sym = decode(lt);
      if (sym < 256) { ensure(1); out[outLen++] = sym; continue; }
      if (sym === 256) break;
      const li = sym - 257;
      const len = LBASE[li] + bits(LEXT[li]);
      const di = decode(dt);
      const dist = DBASE[di] + bits(DEXT[di]);
      ensure(len);
      for (let k = 0; k < len; k++) { out[outLen] = out[outLen - dist]; outLen++; }
    }
  }
  return out.subarray(0, outLen);
}
