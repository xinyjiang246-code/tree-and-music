/* =========================================================
   EXIF 文本解码（app.js 与 world3d.js 共用这一份，别再各写一套）
   ---------------------------------------------------------
   ImageDescription (0x010E)：UTF-8 严格 → GBK → Latin-1；
     都解不干净时，选「可显示字符最多」的那种，不猜。
   UserComment (0x9286)：识别 ASCII\0\0\0 / UNICODE\0 / JIS 前缀，
     以及无前缀（先看 BOM，再看是不是 UTF-16，最后按 UTF-8 → GBK → Latin-1）。
   XPTitle / XPComment (0x9C9B / 0x9C9E)：UTF-16LE。
   任何一步失败都返回原始字节的可读摘要（hex + 长度），不静默吞掉。
   ========================================================= */
(function () {
  'use strict';

  function tryDecode(label, bytes, fatal) {
    if (!window.TextDecoder) return null;
    try {
      return new window.TextDecoder(label, fatal ? { fatal: true } : undefined).decode(bytes);
    } catch (e) {
      return null;
    }
  }

  /* 可显示字符占比：替换符与控制符不算。
     GBK 与 Latin-1 都能解时，含中日韩字符的那种更可能是原意（其次按 GBK 优先）。 */
  function printableScore(s) {
    if (!s || !s.length) return -1;
    var ok = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c === 0xFFFD) continue;
      if (c < 32 && c !== 9 && c !== 10 && c !== 13) continue;
      ok++;
    }
    return ok / s.length;
  }
  function hasCJK(s) {
    return /[\u3000-\u9FFF\uAC00-\uD7AF\uFF01-\uFF60]/.test(s || '');
  }

  function summary(bytes, cap) {
    cap = cap || 24;
    var out = [];
    var n = Math.min(bytes.length, cap);
    for (var i = 0; i < n; i++) out.push(('0' + bytes[i].toString(16)).slice(-2));
    return out.join(' ') + (bytes.length > cap ? ' …' : '') + ' (' + bytes.length + 'B)';
  }

  function cutAtNul(bytes) {
    for (var i = 0; i < bytes.length; i++) {
      if (bytes[i] === 0) return bytes.subarray(0, i);
    }
    return bytes;
  }

  function decodeUtf16(bytes, le) {
    var b = bytes;
    if (b.length >= 2 && b[0] === 0xFF && b[1] === 0xFE) { le = true; b = b.subarray(2); }
    else if (b.length >= 2 && b[0] === 0xFE && b[1] === 0xFF) { le = false; b = b.subarray(2); }
    while (b.length >= 2 && b[b.length - 1] === 0 && b[b.length - 2] === 0) b = b.subarray(0, b.length - 2);
    if (b.length % 2) b = b.subarray(0, b.length - 1);
    var s = tryDecode(le ? 'utf-16le' : 'utf-16be', b, false);
    if (s == null) return null;
    return { text: s.replace(/\0/g, ''), enc: le ? 'utf-16le' : 'utf-16be' };
  }

  /* 看起来像 UTF-16：一半以上是 0x00，且集中在奇数位或偶数位 */
  function looksUtf16(bytes) {
    if (bytes.length < 4 || bytes.length % 2) return false;
    var zeroOdd = 0, zeroEven = 0, total = bytes.length / 2;
    for (var i = 0; i < bytes.length; i += 2) {
      if (bytes[i] === 0) zeroEven++;
      if (bytes[i + 1] === 0) zeroOdd++;
    }
    return zeroOdd > total * 0.5 || zeroEven > total * 0.5;
  }

  function decodePlain(bytes) {
    var b = cutAtNul(bytes);
    if (!b.length) return null;

    // 1) UTF-8 严格
    var u8 = tryDecode('utf-8', b, true);
    if (u8 != null) return { text: u8, enc: 'utf-8' };

    // 有些软件不写 UNICODE 前缀，直接给带 BOM 的 UTF-16
    if (b.length >= 2 && ((b[0] === 0xFF && b[1] === 0xFE) || (b[0] === 0xFE && b[1] === 0xFF))) {
      var bo = decodeUtf16(b, true);
      if (bo) return bo;
    }

    // 2) GBK / 3) Latin-1：取可显示字符多的那个；打平时看谁解出了中日韩字符
    var gbk = tryDecode('gbk', b, false);
    var lat = tryDecode('latin1', b, false);
    var g = gbk != null ? printableScore(gbk) : -1;
    var l = lat != null ? printableScore(lat) : -1;
    if (gbk != null && (g > l || (g === l && (hasCJK(gbk) || !hasCJK(lat))))) {
      return { text: gbk, enc: 'gbk' };
    }
    if (lat != null) return { text: lat, enc: 'latin1' };
    return null;
  }

  var PREFIX_ASCII = 'ASCII\0\0\0';
  var PREFIX_UNICODE = 'UNICODE\0';
  var PREFIX_JIS = 'JIS\0\0\0\0\0';

  function decodeUserComment(bytes) {
    if (!bytes || bytes.length < 2) return null;
    var head = '';
    for (var i = 0; i < Math.min(8, bytes.length); i++) head += String.fromCharCode(bytes[i]);
    var body = bytes.length > 8 ? bytes.subarray(8) : new Uint8Array(0);

    if (head.slice(0, 8) === PREFIX_ASCII) {
      var b = cutAtNul(body);
      if (!b.length) return null;
      var u8 = tryDecode('utf-8', b, true);
      if (u8 != null) return { text: u8, enc: 'ascii/utf-8' };
      var lat = tryDecode('latin1', b, false);
      return lat != null ? { text: lat, enc: 'ascii/latin1' } : null;
    }
    if (head.slice(0, 8) === PREFIX_UNICODE) {
      return decodeUtf16(body, true);         // 无 BOM 时按 LE
    }
    if (head.slice(0, 8) === PREFIX_JIS) {
      var bj = cutAtNul(body);
      var sj = tryDecode('shift_jis', bj, false);
      if (sj != null) return { text: sj, enc: 'shift_jis' };
      return null;
    }
    // 无前缀：先看 BOM / 像不像 UTF-16，再按纯文本那套走
    if (bytes.length >= 2 && ((bytes[0] === 0xFF && bytes[1] === 0xFE) || (bytes[0] === 0xFE && bytes[1] === 0xFF))) {
      return decodeUtf16(bytes, true);
    }
    if (looksUtf16(bytes)) return decodeUtf16(bytes, true);
    return decodePlain(bytes);
  }

  window.ExifText = {
    /* kind: 'description' | 'usercomment' | 'xp' */
    decode: function (bytes, kind) {
      if (!bytes || !bytes.length) return null;
      var r = kind === 'usercomment' ? decodeUserComment(bytes)
        : kind === 'xp' ? decodeUtf16(bytes, true)
          : decodePlain(bytes);
      if (!r || !r.text) return { text: '', enc: null, raw: summary(bytes) };
      r.raw = summary(bytes, 16);
      return r;
    },
    forTag: function (tag, bytes) {
      if (tag === 0x9286) return this.decode(bytes, 'usercomment');
      if (tag === 0x9C9B || tag === 0x9C9E) return this.decode(bytes, 'xp');
      return this.decode(bytes, 'description');
    },
    summary: summary
  };
})();
