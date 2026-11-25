/* =========================================================
   树与音乐 · 原型
   ---------------------------------------------------------
   两个方向共用同一套「树的骨架」：
     listen —— 骨架 → 声音（枝梢是音，树干是持续低音）
     grow   —— 声音 → 光（同一个骨架，频谱驱动发光与呼吸，不改形态）
   骨架来源有两种：拍的照片（阈值 → 细化），或程序生成的一棵树。
   ========================================================= */

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var stage = $('stage');
  var ctx = stage.getContext('2d');
  var W = 0, H = 0, DPR = 1;

  var PALETTE = {
    // 夜金不是"一个金色"：乌木底 → 古铜干 → 琥珀光 → 香槟叶 → 象牙金芯
    gold: {
      bg0: [12, 9, 9], bg1: [61, 36, 21], halo: [127, 79, 32],
      sil: [87, 52, 27], silTop: [181, 125, 54],
      core: [242, 196, 119], coreTop: [255, 246, 218],
      glow: [202, 139, 54], dot: [244, 185, 87], dot2: [255, 232, 170],
      leafDark: [157, 94, 32], leafLight: [255, 216, 126], water: [190, 132, 67]
    },
    // 昼绿要单独配，不是把夜色反白：白瓷底、墨绿干、苔绿叶、少量花粉金
    day: {
      bg0: [237, 240, 229], bg1: [186, 206, 172], halo: [220, 228, 197],
      sil: [40, 66, 44], silTop: [74, 104, 56],
      core: [88, 122, 66], coreTop: [150, 172, 96],
      glow: [120, 152, 94], dot: [168, 162, 76], dot2: [112, 150, 86],
      leafDark: [47, 88, 53], leafLight: [150, 178, 96], water: [80, 118, 90]
    },
    // 参考里的蓝底金叶：钴蓝负责深远，叶群负责两级金色
    ink: {
      bg0: [3, 18, 39], bg1: [6, 48, 86], halo: [13, 71, 119],
      sil: [150, 183, 211], silTop: [211, 231, 239],
      core: [215, 232, 236], coreTop: [250, 250, 226],
      glow: [84, 137, 198], dot: [236, 207, 94], dot2: [255, 241, 166],
      leafDark: [176, 157, 57], leafLight: [255, 229, 111], water: [92, 145, 190]
    }
  };

  var state = {
    ww: 0, wh: 0,
    work: null,          // 处理用的原图画布
    mask: null,          // 二值（1 = 树）
    skel: [],            // 骨架点
    tips: [],            // 枝梢点
    box: null,
    transform: null,
    layers: null,
    tint: 'gold',
    mode: 'listen',
    threshold: 42,
    // 剪影阈值什么时候出现：照片树 + 抽屉展开；自动成功时只在角落留标签
    autoThr: null,
    autoThrFailed: false,
    // 空气：三档环境，默认微风；画面与声音共用这一个状态
    weather: 'wind',
    air: { wind: 1, rain: 0, fog: 0 },
    // 程序树与照片树共用同一套烘焙：样张定稿的 2D 画法
    art: null,
    playing: false,
    generated: true,     // 当前是不是程序生成的树
    seed: 1758,
    species: 'oak',
    leafAnchors: [],
    leaves: [],
    motes: [],
    leavesOn: true,
    waterOn: true,
    reading: false,
    focusSystem: 'energy',
    ripples: [],
    bursts: [],
    pointer: { x: 0, y: 0 },
    transition: null,
    flashes: [],
    // 点亮：光从根部往冠上爬；播完停在点亮态（下一次从它往上叠）
    light: { front: 0, lit: 0, done: false, rate: 0, len: 0 },
    // 光点的活跃度：由最近 3.2 秒落下的音数决定（不是随机噪动）
    noteTimes: [], act: 0,
    branchPaths: null,   // 每个枝梢连到根部的一小段枝条（懒算，树变即失效）
    audioEl: null,
    usingFile: false,
    audioName: '',
    // 与世界树共享的身份
    treeId: null,
    treeName: '',
    treeGps: null,
    photoFileBase: '',
    // 照片内部几乎没有叶面层次（纯逆光黑剪影）：改用"淡影 + 枝"的读法
    photoLowInfo: false,
    // —— 地点决定这棵树 ——
    // 同一个地点（80 米内）只有一个 key；种子由 key 推出来，所以树形永不变，
    // 变的只有大小：这个地点每多一张照片升一档，最多六档。
    place: null,
    tier: 1,
    fullness: 0,           // 同一地点照片数带来的繁茂度（0..1），种子不变
    localSpecies: '',      // 当地真实树种中文名
    memories: [],
    weatherSrc: 'auto',
    engine: 'pluck',       // 当前曲风（由 seed 分配或用户手选）
    // 生长演出：全屏舞台，一棵树跟着音乐从种子一笔笔长出来
    show: null
  };

  /* =========================================================
     0. 与世界树共享的存储（照片 / 位置）
     ========================================================= */
  var TREE_DB = 'tree-music', TREE_STORE = 'photos';
  var dbPromise = null;

  function treeDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error('no idb')); return; }
      var req = indexedDB.open(TREE_DB, 1);
      req.onupgradeneeded = function () {
        var d = req.result;
        if (!d.objectStoreNames.contains(TREE_STORE)) d.createObjectStore(TREE_STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbPromise;
  }
  function idbPut(key, val) {
    return treeDb().then(function (d) {
      return new Promise(function (res, rej) {
        var tx = d.transaction(TREE_STORE, 'readwrite');
        tx.objectStore(TREE_STORE).put(val, key);
        tx.oncomplete = function () { res(); };
        tx.onerror = function () { rej(tx.error); };
      });
    });
  }
  function idbGet(key) {
    return treeDb().then(function (d) {
      return new Promise(function (res, rej) {
        var tx = d.transaction(TREE_STORE, 'readonly');
        var r = tx.objectStore(TREE_STORE).get(key);
        r.onsuccess = function () { res(r.result || null); };
        r.onerror = function () { rej(r.error); };
      });
    });
  }
  function newTreeId() {
    return 't_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
  }
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function seedFrom(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return Math.abs(h) % 900000 + 1000;
  }

  /* =========================================================
     0.1 地点：树由地点长成
     ---------------------------------------------------------
     - 80 米内算同一个地点；地点 key 定下就不再变
     - 种子 = seedFrom('place:' + key)：同一地点永远同一棵树
     - 这个地点的照片数决定档位（1–6）：档位只改大小，不改形状
     - 照片退成"记忆"：存在 IndexedDB，按地点挂在一起
     ========================================================= */
  var PLACES_KEY = 'tree.places.v1';
  var PLACE_MERGE_M = 80;

  function loadPlaces() {
    try {
      var a = JSON.parse(localStorage.getItem(PLACES_KEY) || '[]');
      return Array.isArray(a) ? a : [];
    } catch (e) { return []; }
  }
  function savePlaces(list) {
    try { localStorage.setItem(PLACES_KEY, JSON.stringify(list.slice(-200))); } catch (e) {}
  }
  function metersBetween(a, b) {
    var R = 6371000, rad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    var la1 = a.lat * rad, la2 = b.lat * rad;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
  }
  // 找一个地点：80 米内算"回来了"，否则另开一处
  function placeAt(lat, lon) {
    var list = loadPlaces();
    var best = null, bestD = 1e12;
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (p.lat == null || p.lon == null) continue;
      var d = metersBetween({ lat: lat, lon: lon }, p);
      if (d < bestD) { bestD = d; best = p; }
    }
    if (best && bestD <= PLACE_MERGE_M) return best;
    var np = {
      key: 'p_' + lat.toFixed(5) + '_' + lon.toFixed(5),
      lat: lat, lon: lon, n: 0,
      first: todayStr(), last: todayStr(), name: '', memories: []
    };
    list.push(np);
    savePlaces(list);
    return np;
  }
  // 没有坐标的照片：先记在"未定位"这一处，等它被放到地球上
  function unplacedPlace() {
    var list = loadPlaces();
    for (var i = 0; i < list.length; i++) if (list[i].key === 'unplaced') return list[i];
    var p = { key: 'unplaced', lat: null, lon: null, n: 0, first: todayStr(), last: todayStr(), name: '', memories: [] };
    list.push(p);
    savePlaces(list);
    return p;
  }
  function placeSeed(place) { return seedFrom('place:' + (place ? place.key : 'unplaced')); }
  function placeInfoOf(place) {
    if (!place || place.lat == null || !window.TreePlaces) return null;
    return window.TreePlaces.lookup(place.lat, place.lon);
  }
  function bumpPlace(place, rec) {
    var list = loadPlaces();
    var i = -1;
    for (var k = 0; k < list.length; k++) if (list[k].key === place.key) { i = k; break; }
    var p = i >= 0 ? list[i] : place;
    p.n = (p.n || 0) + 1;
    p.last = todayStr();
    p.memories = (p.memories || []).concat([rec]).slice(-30);
    if (!p.name && rec.name) p.name = rec.name;
    if (i >= 0) list[i] = p; else list.push(p);
    savePlaces(list);
    return p;
  }

  // 读 EXIF：GPS 与 ImageDescription（相机/软件写的说明，可能是真实的树名）
  function readExif(file, cb) {
    var fr = new FileReader();
    fr.onload = function () {
      try {
        var dv = new DataView(fr.result);
        if (dv.getUint16(0) !== 0xFFD8) { cb(null); return; }
        var off = 2;
        for (; off + 4 < dv.byteLength;) {
          var marker = dv.getUint16(off), size = dv.getUint16(off + 2);
          if (marker === 0xFFE1 && dv.getUint32(off + 4) === 0x45786966) {
            cb(parseExif(dv, off + 4)); return;
          }
          if (size < 2) break;
          off += 2 + size;
        }
        cb(null);
      } catch (e) { cb(null); }
    };
    fr.onerror = function () { cb(null); };
    fr.readAsArrayBuffer(file);
  }
  function parseExif(dv, base) {
    try {
      var tiff = base + 6;
      var order = dv.getUint16(tiff) === 0x4949;
      var r16 = function (o) { return order ? dv.getUint16(o, true) : dv.getUint16(o, false); };
      var r32 = function (o) { return order ? dv.getUint32(o, true) : dv.getUint32(o, false); };
      var ifd0 = tiff + r32(tiff + 4);
      var n = r16(ifd0), gpsPtr = 0;
      var texts = { desc: null, title: null, comment: null, user: null };
      var rawFailed = null;

      // 取某个 tag 的原始字节：EXIF 里的偏移都是相对 TIFF 头的
      function tagBytes(e) {
        var type = r16(e + 2), cnt = r32(e + 4);
        var unit = type === 3 ? 2 : type === 4 ? 4 : type === 5 ? 8 : 1;
        var total = cnt * unit;
        if (!total) return null;
        var start = total <= 4 ? e + 8 : tiff + r32(e + 8);
        if (start < 0 || start + total > dv.byteLength) return null;
        return new Uint8Array(dv.buffer, dv.byteOffset + start, total);
      }
      function readText(tag, e) {
        var b = tagBytes(e);
        if (!b) return null;
        var r = window.ExifText ? window.ExifText.forTag(tag, b) : null;
        if (!r) return null;
        if (!r.text && r.raw && !rawFailed) rawFailed = r.raw;   // 解不出来就留摘要，不静默吞掉
        return r.text || null;
      }

      for (var i = 0; i < n; i++) {
        var e = ifd0 + 2 + i * 12;
        var tag = r16(e);
        if (tag === 0x8825) gpsPtr = tiff + r32(e + 8);
        else if (tag === 0x010E || tag === 0x9C9B || tag === 0x9C9E || tag === 0x9286) {
          var txt = readText(tag, e);
          if (!txt) continue;
          if (tag === 0x010E) texts.desc = txt;
          else if (tag === 0x9C9B) texts.title = txt;
          else if (tag === 0x9C9E) texts.comment = txt;
          else texts.user = txt;
        }
      }

      // 说明字段的优先级：ImageDescription → XPTitle → XPComment → UserComment
      var desc = (texts.desc || texts.title || texts.comment || texts.user || '').trim() || null;
      var out = { lat: null, lon: null, desc: desc, descRaw: rawFailed };
      if (!gpsPtr) return out;
      var gn = r16(gpsPtr), lat = null, lon = null, latRef = 'N', lonRef = 'E';
      for (var j = 0; j < gn; j++) {
        var ge = gpsPtr + 2 + j * 12;
        var gtag = r16(ge);
        var rat = function (o) { return r32(o) / r32(o + 4); };
        if (gtag === 1) latRef = dv.getUint8(ge + 8) === 0x4E ? 'N' : 'S';
        else if (gtag === 2) { var lp = tiff + r32(ge + 8); lat = rat(lp) + rat(lp + 8) / 60 + rat(lp + 16) / 3600; }
        else if (gtag === 3) lonRef = dv.getUint8(ge + 8) === 0x45 ? 'E' : 'W';
        else if (gtag === 4) { var op = tiff + r32(ge + 8); lon = rat(op) + rat(op + 8) / 60 + rat(op + 16) / 3600; }
      }
      if (lat != null && lon != null) {
        out.lat = latRef === 'S' ? -lat : lat;
        out.lon = lonRef === 'W' ? -lon : lon;
      }
      return out;
    } catch (e) { return null; }
  }

  /* =========================================================
     0.5 地点 → 树种（data/species.js，离线锚点）
     照片自带 EXIF 时，真实坐标与说明优先；映射只补树种与意象
     ========================================================= */
  function placeInfo() {
    if (!window.TreePlaces || !state.treeGps) return null;
    return window.TreePlaces.lookup(state.treeGps.lat, state.treeGps.lon);
  }
  function displayTitle() {
    if (state.treeName) return state.treeName;      // 用户写的 / EXIF 说明 / 地球传过来的
    var p = placeInfo();
    if (p) return p.title;                          // 「上环的石墙细叶榕」
    return state.photoFileBase || '';
  }
  function refreshPlace() {
    var el = $('treePlace');
    if (!el) return;
    var p = placeInfo();
    if (!p) { el.hidden = true; el.textContent = ''; return; }
    el.hidden = false;
    el.textContent = p.species.slice(0, 2).join(' · ') + ' · ' + p.tag +
      (p.imagery ? ' · ' + p.imagery : '');
    el.title = p.note || '';
  }
  function setTitle(extra) {
    var base = displayTitle() ||
      (state.photoLoaded ? '一棵拍下来的树' : (SPECIES_NAME[state.species] + ' · 种子 ' + state.seed));
    var note = state.photoLowInfo ? '照片内部信息少 · 按轮廓读枝' : extra;
    $('treeLabel').textContent = note ? base + ' · ' + note : base;
    document.title = base + ' · 树与音乐';
    refreshPlace();
  }

  /* =========================================================
     1. 图片 → 树
     ========================================================= */

  // 失败/降级都必须说出来：不再让提示写进会被隐藏的元素里
  var noticeTimer = null;
  function notice(msg) {
    $('treeLabel').textContent = msg;
    document.body.classList.add('notice');
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(function () {
      document.body.classList.remove('notice');
      setTitle();          // 提示是临时的：收掉之后回到这棵树的标题
    }, 4000);
  }

  /* ---------------------------------------------------------
     自动剪影阈值
     - Otsu：在亮度直方图上找前景/背景方差最大的那一刀
     - 校验：暗部占比 4%~62%，剪影至少占住画面两成宽高
     - 都不成立就返回 null，退回默认值 + 原来的「往右拉」提示
     --------------------------------------------------------- */
  var THR_DEFAULT = 42;   // 和 index.html 里滑杆的初值一致

  function setThrTag(v) {
    state.autoThr = (v == null) ? null : v;
    var tag = $('thrTag');
    if (tag) {
      if (v == null) { tag.hidden = true; }
      else {
        tag.textContent = '自动 ' + v;
        tag.title = '按这张图的亮度直方图自动选的阈值，拖滑杆可微调';
        tag.hidden = false;
      }
    }
    updateThrUI();
  }

  /* 阈值属于「照片树」的调整项，不是常驻控件：
     - 程序树：不出现
     - 照片树：抽屉展开时才出现；自动成功时另外在角落留一枚「自动 N」
     自动失败则直接展开抽屉，让滑杆看得见 */
  function updateThrUI() {
    var photo = !state.generated && !!state.photoLoaded;
    var drawer = $('tunePanel');
    var dock = $('dock');
    var open = !!(drawer && !drawer.hidden);
    if ($('thrRow')) $('thrRow').hidden = !(photo && open);

    var peek = $('thrPeek');
    if (peek) {
      var show = photo && state.autoThr != null && !open && dock && !dock.hidden;
      peek.hidden = !show;
      if (show) {
        peek.textContent = '自动 ' + state.autoThr;
        peek.title = '剪影阈值按这张图自动选的 · 点开调整';
      }
    }
  }

  function setTuneOpen(open) {
    var panel = $('tunePanel'), btn = $('tuneBtn');
    if (!panel || !btn) return;
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    updateThrUI();
  }

  /* 空态 → 有树：收掉提示，露出底栏，并按新的可用高度重排树 */
  function leaveIntro() {
    $('empty').hidden = true;
    $('dock').hidden = false;
    document.body.classList.remove('intro');
    state.transform = computeTransform();
    layoutHotspots();
    updateThrUI();
  }

  function autoThreshold(pixels, w, h) {
    var hist = new Uint32Array(256);
    var n = w * h;
    for (var p = 0; p < pixels.length; p += 4) {
      var lum = (pixels[p] * 0.299 + pixels[p + 1] * 0.587 + pixels[p + 2] * 0.114) | 0;
      hist[lum < 0 ? 0 : lum > 255 ? 255 : lum]++;
    }
    var sumAll = 0;
    for (var i = 0; i < 256; i++) sumAll += i * hist[i];
    if (!n || !sumAll) return null;

    var wB = 0, sumB = 0, best = -1, bestVar = -1;
    for (var t = 0; t < 255; t++) {
      wB += hist[t];
      if (!wB) continue;
      var wF = n - wB;
      if (!wF) break;
      sumB += t * hist[t];
      var mB = sumB / wB, mF = (sumAll - sumB) / wF;
      var v = wB * wF * (mB - mF) * (mB - mF);
      if (v > bestVar) { bestVar = v; best = t; }
    }
    if (best < 0 || bestVar <= 0) return null;

    // 直方图取值 → 滑杆刻度（滑杆本身只有 12~82）
    function toSlider(t255) {
      var v0 = Math.round(t255 / 255 * 100);
      return v0 < 12 ? 12 : v0 > 82 ? 82 : v0;
    }

    /* 这一刀切出来的剪影，像不像一棵树。
       除了"有暗部、有面积"，还要过一条最典型的失败：
       普通白天照片里地面比天空暗，阈值一旦越过地面，
       剪影底部会变成一条贯穿整幅宽的地带 —— 而树根永远比树冠窄。 */
    function plausible(v) {
      var thr = v / 100 * 255;
      var rowN = new Uint32Array(h);
      var dark = 0, x0 = w, x1 = -1, y0 = h, y1 = -1;
      for (var y = 0; y < h; y++) {
        var row = y * w;
        for (var x = 0; x < w; x++) {
          var q = (row + x) * 4;
          var l = pixels[q] * 0.299 + pixels[q + 1] * 0.587 + pixels[q + 2] * 0.114;
          if (l >= thr) continue;
          dark++;
          rowN[y]++;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
      var frac = dark / n;
      if (frac < 0.03 || frac > 0.60) return false;
      if (x1 < 0) return false;
      var bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      if (bw < w * 0.2 || bh < h * 0.2) return false;

      var baseH = Math.max(1, Math.round(bh * 0.10));
      var baseMax = 0, midMax = 0;
      for (var by = y1 - baseH + 1; by <= y1; by++) {
        if (rowN[by] > baseMax) baseMax = rowN[by];
      }
      var m0 = Math.round(y0 + bh * 0.3), m1 = Math.round(y0 + bh * 0.7);
      for (var my = m0; my <= m1; my++) {
        if (rowN[my] > midMax) midMax = rowN[my];
      }
      if (baseMax > w * 0.55) return false;        // 底部一条地平面，不是树
      if (midMax < w * 0.12) return false;         // 中间太薄，多半只切到一条线
      return true;
    }

    // 候选：Otsu 一刀 + 几个暗部分位；按离 Otsu 的远近试，第一个像树的就采纳
    var cands = [toSlider(best)];
    var ps = [8, 12, 16, 22, 30];
    for (var pi = 0; pi < ps.length; pi++) {
      var acc = 0, q = -1;
      for (var j = 0; j < 256; j++) {
        acc += hist[j];
        if (acc >= n * ps[pi] / 100) { q = j; break; }
      }
      if (q >= 0) {
        var qv = toSlider(q);
        if (cands.indexOf(qv) < 0) cands.push(qv);
      }
    }
    var otsuV = cands[0];
    cands.sort(function (a, b) { return Math.abs(a - otsuV) - Math.abs(b - otsuV); });
    for (var ci = 0; ci < cands.length; ci++) {
      if (plausible(cands[ci])) return cands[ci];
    }
    return null;
  }

  function loadImageFile(file) {
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onerror = function () {
      URL.revokeObjectURL(url);
      $('busy').hidden = true;
      $('empty').hidden = false;
      notice('这张图读不出来 · 换一张 JPG / PNG 试试');
    };
    img.onload = function () {
      URL.revokeObjectURL(url);
      var maxSide = 560;
      var s = Math.min(1, maxSide / Math.max(img.width, img.height));
      var w = Math.max(2, Math.round(img.width * s));
      var h = Math.max(2, Math.round(img.height * s));

      var c = document.createElement('canvas');
      c.width = w; c.height = h;
      var g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0, w, h);

      state.work = c;
      state.ww = w; state.wh = h;
      state.generated = false;
      state.photoLoaded = true;
      state.photoLowInfo = false;
      state.pixels = g.getImageData(0, 0, w, h).data;

      // 先替用户选一个阈值：不用先拖滑杆才看得见树
      var auto = autoThreshold(state.pixels, w, h);
      state.autoThrFailed = (auto == null);
      if (auto != null) {
        state.threshold = auto;
        if ($('thr')) $('thr').value = auto;
        setThrTag(auto);
      } else {
        // 挑不出来就退回默认值，滑杆仍可手动调；提示沿用原来那句
        state.threshold = THR_DEFAULT;
        if ($('thr')) $('thr').value = THR_DEFAULT;
        setThrTag(null);
        notice('这张图没自动找出合适的阈值 · 把「剪影阈值」往右拉一点');
      }

      leaveIntro();
      // 自动失败时，阈值必须看得见：直接把调整抽屉打开
      if (state.autoThrFailed) setTuneOpen(true);
      setTitle(img.naturalWidth + '×' + img.naturalHeight);

      rebuild(true);
    };
    img.src = url;
  }

  function binarize(threshold) {
    var w = state.ww, h = state.wh, d = state.pixels;
    var thr = threshold / 100 * 255;
    var mask = new Uint8Array(w * h);
    for (var i = 0, p = 0; i < mask.length; i++, p += 4) {
      var lum = d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114;
      // 树 = 比阈值暗的部分
      mask[i] = lum < thr ? 1 : 0;
    }
    return mask;
  }

  function boundingBox(mask, w, h) {
    var x0 = w, x1 = -1, y0 = h, y1 = -1;
    for (var y = 0; y < h; y++) {
      var row = y * w;
      for (var x = 0; x < w; x++) {
        if (!mask[row + x]) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) return { x0: 0, y0: 0, x1: w - 1, y1: h - 1 };
    return { x0: x0, y0: y0, x1: x1, y1: y1 };
  }

  /* Zhang-Suen 细化：把实心剪影抽成 1px 骨架 */
  function thin(src, w, h, box) {
    var img = new Uint8Array(src);
    var rm = new Uint8Array(w * h);
    var x0 = Math.max(1, box.x0), x1 = Math.min(w - 2, box.x1);
    var y0 = Math.max(1, box.y0), y1 = Math.min(h - 2, box.y1);
    var changed = true, iter = 0;

    while (changed && iter < 90) {
      changed = false;
      for (var step = 0; step < 2; step++) {
        var cnt = 0;
        for (var y = y0; y <= y1; y++) {
          var row = y * w;
          for (var x = x0; x <= x1; x++) {
            var i = row + x;
            if (img[i] !== 1) continue;

            var p2 = img[i - w], p3 = img[i - w + 1], p4 = img[i + 1];
            var p5 = img[i + w + 1], p6 = img[i + w], p7 = img[i + w - 1];
            var p8 = img[i - 1], p9 = img[i - w - 1];

            var B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
            if (B < 2 || B > 6) continue;

            var A = 0;
            if (p2 === 0 && p3 === 1) A++;
            if (p3 === 0 && p4 === 1) A++;
            if (p4 === 0 && p5 === 1) A++;
            if (p5 === 0 && p6 === 1) A++;
            if (p6 === 0 && p7 === 1) A++;
            if (p7 === 0 && p8 === 1) A++;
            if (p8 === 0 && p9 === 1) A++;
            if (p9 === 0 && p2 === 1) A++;
            if (A !== 1) continue;

            if (step === 0) {
              if (p2 * p4 * p6 !== 0) continue;
              if (p4 * p6 * p8 !== 0) continue;
            } else {
              if (p2 * p4 * p8 !== 0) continue;
              if (p2 * p6 * p8 !== 0) continue;
            }
            rm[i] = 1; cnt++;
          }
        }
        if (cnt) {
          changed = true;
          for (var yy = y0; yy <= y1; yy++) {
            var rr = yy * w;
            for (var xx = x0; xx <= x1; xx++) {
              var ii = rr + xx;
              if (rm[ii]) { img[ii] = 0; rm[ii] = 0; }
            }
          }
        }
      }
      iter++;
    }
    return img;
  }

  function collectSkeleton(skel, w, h, box) {
    var pts = [], tips = [];
    for (var y = box.y0; y <= box.y1; y++) {
      var row = y * w;
      for (var x = box.x0; x <= box.x1; x++) {
        var i = row + x;
        if (!skel[i]) continue;
        pts.push({ x: x, y: y });
        var n = 0;
        for (var dy = -1; dy <= 1; dy++) {
          for (var dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            var xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            if (skel[yy * w + xx]) n++;
          }
        }
        // 端点；太靠下的是树根，不算"枝梢"
        if (n === 1) tips.push({ x: x, y: y });
      }
    }
    // 与程序树输出同一种数据：骨架点、发音枝梢、叶锚点。
    // 叶锚必须在抽稀枝梢之前取，否则照片再密也只有 140 片叶子。
    var leaves = skeletonLeafAnchors(skel, w, h, tips);
    // 枝梢太多时均匀抽一批，保证音色不糊
    if (tips.length > 140) {
      var keep = [], stepN = tips.length / 140;
      for (var k = 0; k < 140; k++) keep.push(tips[Math.floor(k * stepN)]);
      tips = keep;
    }
    return { pts: pts, tips: tips, leaves: leaves };
  }

  // 从每个真实端点沿骨架往回走几步，得到枝条的朝向。
  // 不用随机撒叶：照片树的叶也要长在它自己的枝上。
  function skeletonLeafAnchors(skel, w, h, tips) {
    var anchors = [];
    for (var i = 0; i < tips.length; i++) {
      var tip = tips[i];
      var x = tip.x, y = tip.y, px = -1, py = -1;
      var walked = 0;
      for (var step = 0; step < 6; step++) {
        var nx = -1, ny = -1, found = 0;
        for (var dy = -1; dy <= 1; dy++) {
          for (var dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            var xx = x + dx, yy = y + dy;
            if (xx === px && yy === py) continue;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h || !skel[yy * w + xx]) continue;
            nx = xx; ny = yy; found++;
          }
        }
        if (!found) break;
        px = x; py = y; x = nx; y = ny; walked++;
      }
      var ax = walked ? tip.x - x : 0;
      var ay = walked ? tip.y - y : -1;
      anchors.push({
        x: tip.x, y: tip.y,
        a: Math.atan2(ay, ax),
        k: i
      });
    }
    if (anchors.length > 420) {
      var sampled = [], stride = anchors.length / 420;
      for (var j = 0; j < 420; j++) sampled.push(anchors[Math.floor(j * stride)]);
      anchors = sampled;
    }
    return anchors;
  }

  /* ---------------------------------------------------------
     照片骨架 → 新画法要的两层信息
     枝宽：剪影的距离场（到轮廓的距离）就是半径，直径 = 2r；沿枝平滑，宁细不粗
     深度：从根部做 BFS 的层级，分叉越远越深，同时决定前后与推进顺序
     --------------------------------------------------------- */

  // 两遍倒角距离变换：每个前景点到最近背景的距离（近似欧氏）
  function distanceField(mask, w, h) {
    var d = new Float32Array(w * h);
    var i, x, y;
    for (i = 0; i < d.length; i++) d[i] = mask[i] ? 1e9 : 0;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        i = y * w + x;
        if (!d[i]) continue;
        var v = d[i];
        if (x > 0 && d[i - 1] + 1 < v) v = d[i - 1] + 1;
        if (y > 0) {
          if (d[i - w] + 1 < v) v = d[i - w] + 1;
          if (x > 0 && d[i - w - 1] + 1.414 < v) v = d[i - w - 1] + 1.414;
          if (x < w - 1 && d[i - w + 1] + 1.414 < v) v = d[i - w + 1] + 1.414;
        }
        d[i] = v;
      }
    }
    for (y = h - 1; y >= 0; y--) {
      for (x = w - 1; x >= 0; x--) {
        i = y * w + x;
        if (!d[i]) continue;
        var v2 = d[i];
        if (x < w - 1 && d[i + 1] + 1 < v2) v2 = d[i + 1] + 1;
        if (y < h - 1) {
          if (d[i + w] + 1 < v2) v2 = d[i + w] + 1;
          if (x < w - 1 && d[i + w + 1] + 1.414 < v2) v2 = d[i + w + 1] + 1.414;
          if (x > 0 && d[i + w - 1] + 1.414 < v2) v2 = d[i + w - 1] + 1.414;
        }
        d[i] = v2;
      }
    }
    return d;
  }

  // 把骨架拆成"从分叉到下一个分叉/端点"的链，再切成短段（画法要二次曲线段）
  function photoBranches(skel, w, h, box, dist, trunkTopIn, maskPix) {
    var idx = new Int32Array(w * h).fill(-1);
    var nodes = [];
    var x, y, i;
    for (y = box.y0; y <= box.y1; y++) {
      for (x = box.x0; x <= box.x1; x++) {
        i = y * w + x;
        if (!skel[i]) continue;
        idx[i] = nodes.length;
        nodes.push({ i: i, x: x, y: y, nb: [] });
      }
    }
    if (!nodes.length) return { segs: [], trunkTop: box.y1 };

    var dirs = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
    nodes.forEach(function (n) {
      for (var k = 0; k < 8; k++) {
        var xx = n.x + dirs[k][0], yy = n.y + dirs[k][1];
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        var j = idx[yy * w + xx];
        if (j >= 0) n.nb.push(j);
      }
      // 8 邻接会把"台阶"数成三分叉：把环上连续占用的方向并成一条"臂"，
      // 直线/拐角是 2 臂，真正的分叉才是 3 臂以上
      var occ = [];
      for (var q = 0; q < 8; q++) {
        var ux = n.x + dirs[q][0], uy = n.y + dirs[q][1];
        occ.push(ux >= 0 && uy >= 0 && ux < w && uy < h && idx[uy * w + ux] >= 0);
      }
      var runs = 0, all = true;
      for (var r = 0; r < 8; r++) {
        if (!occ[r]) all = false;
        if (occ[r] && !occ[(r + 7) % 8]) runs++;
      }
      n.arms = all ? 1 : runs;
    });

    // 根：树干是全树唯一"竖直连续"的结构。在冠底以下按列统计骨架点，
    // 竖列最长的那一列就是树干所在，再在底部带里取离它最近的节点。
    var tTop = trunkTopIn == null ? box.y1 : trunkTopIn;
    var hist = {};
    nodes.forEach(function (n) {
      if (n.y < tTop - 4) return;
      hist[n.x] = (hist[n.x] || 0) + 1;
    });
    var rootX = (box.x0 + box.x1) / 2, bestCol = 0;
    for (var hx in hist) {
      var xx0 = +hx, sum = 0;
      for (var dx0 = -2; dx0 <= 2; dx0++) sum += hist[xx0 + dx0] || 0;
      if (sum > bestCol) { bestCol = sum; rootX = xx0; }
    }
    var bandY = box.y1 - Math.max(5, (box.y1 - box.y0) * 0.08);
    var root = 0, best = 1e9;
    nodes.forEach(function (n, k) {
      if (n.y < bandY && n.y !== box.y1) return;
      var sc2 = Math.abs(n.x - rootX) + (box.y1 - n.y) * 0.4;
      if (sc2 < best) { best = sc2; root = k; }
    });
    if (best === 1e9) nodes.forEach(function (n, k) { if (n.y > nodes[root].y) root = k; });

    var level = new Int32Array(nodes.length).fill(-1);
    var parent = new Int32Array(nodes.length).fill(-1);
    level[root] = 0;
    var queue = [root];
    for (var qi = 0; qi < queue.length; qi++) {
      var a = queue[qi];
      for (var qn = 0; qn < nodes[a].nb.length; qn++) {
        var b = nodes[a].nb[qn];
        if (level[b] >= 0) continue;
        level[b] = level[a] + 1;
        parent[b] = a;
        queue.push(b);
      }
    }
    nodes.forEach(function (n, k) { if (level[k] < 0) level[k] = 0; });

    // 树干到哪儿结束由剪影决定（冠底）：行宽第一次超过冠幅三成的那一行
    var trunkTop = trunkTopIn == null ? box.y1 : trunkTopIn;

    // 骨架是一张网：从根与分叉点出发，沿边各走一条链，每条边只走一次
    function ekey(a2, b2) { return a2 < b2 ? a2 + '_' + b2 : b2 + '_' + a2; }
    var seen = {};
    var chains = [];
    function walk(start, first) {
      var path = [start, first];
      seen[ekey(start, first)] = 1;
      var prev = start, cur = first;
      for (var guard = 0; guard < 20000; guard++) {
        if (cur === root) break;
        var node = nodes[cur];
        if (node.arms !== 2) break;
        var next = -1;
        for (var kk = 0; kk < node.nb.length; kk++) {
          var q = node.nb[kk];
          if (q !== prev && !seen[ekey(cur, q)]) { next = q; break; }
        }
        if (next < 0) break;
        seen[ekey(cur, next)] = 1;
        path.push(next);
        prev = cur; cur = next;
      }
      if (path.length > 1) chains.push(path);
    }
    var starts = [root];
    nodes.forEach(function (n, k) { if (n.arms !== 2) starts.push(k); });
    starts.forEach(function (s) {
      nodes[s].nb.forEach(function (m) {
        if (!seen[ekey(s, m)]) walk(s, m);
      });
    });

    // 链 → 带锥度的短段
    var segs = [];
    chains.forEach(function (path) {
      var pts = path.map(function (k) { return nodes[k]; });
      var widths = pts.map(function (n) {
        var r = dist[n.i] || 0;
        return Math.max(1.1, Math.min(46, r * 1.8));
      });
      // 沿链做一次 5 点平滑，枝宽不跳
      var sm = widths.slice();
      for (var wi = 1; wi < widths.length - 1; wi++) {
        var s2 = 0, c2 = 0;
        for (var wj = -2; wj <= 2; wj++) {
          var kj = wi + wj;
          if (kj < 0 || kj >= widths.length) continue;
          s2 += widths[kj]; c2++;
        }
        sm[wi] = s2 / c2;
      }
      var lv = level[path[0]];
      var acc = 0, chunkStart = 0;
      for (var pi = 1; pi < pts.length; pi++) {
        acc += Math.hypot(pts[pi].x - pts[pi - 1].x, pts[pi].y - pts[pi - 1].y);
        if (acc < 18 && pi < pts.length - 1) continue;
        var a3 = pts[chunkStart], b3 = pts[pi];
        var mid = pts[Math.floor((chunkStart + pi) / 2)];
        var mx = (a3.x + b3.x) / 2, my = (a3.y + b3.y) / 2;
        var w0 = sm[chunkStart], w1 = sm[pi];
        // 冠内去网统一交给 filterPhotoWeb：这里不再按粗细丢段，
        // 否则会把干顶真正接出去的主枝候选一起剪掉。
        // 冠底以下只把"贴着主干中线"的段算作树干；伸出去的侧根/低枝不算，
        // 否则它们会被 drawTrunk 当成第二根干，画出一团错位的木桩。
        var trunkX = nodes[root].x;
        var trunkBand = Math.max(13, Math.min(30, Math.max(w0, w1) * 0.95));
        var segV = Math.abs(b3.y - a3.y) >= Math.abs(b3.x - a3.x) * 0.45;
        var isTrunk = my >= trunkTop && segV && Math.abs(mx - trunkX) <= trunkBand;
        segs.push({
          x1: a3.x, y1: a3.y,
          cx: mid.x * 2 - mx, cy: mid.y * 2 - my,
          x2: b3.x, y2: b3.y,
          w: (w0 + w1) / 2,
          w0: w0, w1: w1,
          depth: isTrunk ? 0 : (my >= trunkTop ? 1 : Math.min(6, 1 + Math.floor(lv / 30)))
        });
        chunkStart = pi;
        acc = 0;
      }
    });

    // 照片里没有可用的干（纯逆光常是一整团冠，或只有侧枝）：在冠底中线补一根。
    // 不能把远处那根竖着的侧枝当干，否则整棵树会错位。
    var cx0 = (box.x0 + box.x1) / 2;
    var trunkSegs = segs.filter(function (s) { return s.depth === 0; });
    var bandTop = box.y1, bandBot = box.y0;
    trunkSegs.forEach(function (s) {
      bandTop = Math.min(bandTop, s.y1, s.y2);
      bandBot = Math.max(bandBot, s.y1, s.y2);
    });
    if (!trunkSegs.length ||
        Math.abs(rootX - cx0) > (box.x1 - box.x0) * 0.16 ||
        (bandBot - bandTop) < (box.y1 - box.y0) * 0.05) {
      segs.forEach(function (s) { if (s.depth === 0) s.depth = 1; });
      var tw = Math.max(6, (box.x1 - box.x0) * 0.028);
      segs.push({
        x1: cx0, y1: box.y1,
        cx: cx0, cy: (box.y1 + trunkTop) / 2,
        x2: cx0, y2: trunkTop,
        w: tw, w0: tw * 1.12, w1: tw * 0.84,
        depth: 0, synthetic: 1
      });
    }

    return { segs: segs, trunkTop: trunkTop, root: nodes[root], chains: chains.length, nodes: nodes.length };
  }

  /* 冠内的骨架是一张网：细线覆盖整冠时会读成裂纹。
     只留"冠外看得见的枝"（冠缘以外）与冠底以下的干，
     冠内的结构交给"干 → 主枝"的过渡和软叶簇。 */
  function filterPhotoWeb(br, box, trunkTop) {
    var cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
    var rx = Math.max(1, (box.x1 - box.x0) / 2), ry = Math.max(1, (box.y1 - box.y0) / 2);
    br.segs = br.segs.filter(function (s) {
      if (s.depth === 0) return true;
      var mx = (s.x1 + s.x2) / 2, my = (s.y1 + s.y2) / 2;
      // 冠底以下只留干：那里伸出去的侧根/低枝会被画成粗短木桩
      if (my >= trunkTop - 6) return false;
      var rr = Math.hypot((mx - cx) / rx, (my - cy) / ry);
      // 只留真正伸到冠外的枝；冠缘以内、尤其是冠底附近的短粗段会读成"领子"
      return rr > 1.02;
    });
  }

  /* 干 → 主枝 → 冠 的过渡：
     1) 干顶继续往冠内收锥一段，不在冠底戛然而止
     2) 从干顶接出 2–3 根进冠主枝，父段末端宽度 = 子段起始宽度
     3) 找不到合适的枝就从干顶方向性地补 2–3 级主枝，保证过渡存在 */
  function photoJunction(br, box, w, h) {
    var segs = br.segs;
    var trunk = segs.filter(function (s) { return s.depth === 0; });
    if (!trunk.length) return;

    var top = null, wTop = 0;
    function consider(x, y, ww) {
      if (!top || y < top.y) { top = { x: x, y: y }; wTop = ww; }
    }
    trunk.forEach(function (s) {
      consider(s.x1, s.y1, s.w0 == null ? s.w : s.w0);
      consider(s.x2, s.y2, s.w1 == null ? s.w : s.w1);
    });
    if (!top) return;

    var crownSpan = Math.max(1, br.trunkTop - box.y0);
    var rx = Math.max(20, (box.x1 - box.x0) / 2);
    var extLen = Math.max(16, Math.min(64, crownSpan * 0.16));
    var jy = Math.max(box.y0 + 6, top.y - extLen);
    var jw = Math.max(3, wTop * 0.86);

    // 干顶延长：w0 接住干顶口径，w1 收锥；它仍在冠底之下可见，进入冠体后被叶团遮住
    segs.push({
      x1: top.x, y1: top.y,
      cx: top.x, cy: (top.y + jy) / 2,
      x2: top.x, y2: jy,
      w: (wTop + jw) / 2, w0: wTop, w1: jw, depth: 0
    });

    // 候选：起点已经在冠底以上的枝，离交接点近、朝上或朝外
    var R = Math.max(54, wTop * 2.2);
    var cands = [];
    segs.forEach(function (s) {
      if (s.depth === 0) return;
      // 只接"确实往上走"的枝；同一高度横着接过去会变成一道粗领子
      if (s.y1 > jy - 10) return;
      var d = Math.hypot(s.x1 - top.x, s.y1 - jy);
      if (d > R || d < 1.5) return;
      cands.push({ s: s, d: d, a: Math.atan2(s.y1 - jy, s.x1 - top.x) });
    });
    cands.sort(function (a, b) { return a.d - b.d; });

    var picked = [];
    cands.forEach(function (c) {
      if (picked.length >= 3) return;
      for (var i = 0; i < picked.length; i++) {
        var da = Math.abs(c.a - picked[i].a);
        if (da > Math.PI) da = 6.2832 - da;
        if (da < 0.55) return;   // 方向太近的不要，主枝才分得开
      }
      picked.push(c);
    });

    picked.forEach(function (c) {
      var s = c.s;
      // 父段（过渡枝）末端宽度 = 子段起始宽度：交接处不再突然变细
      segs.push({
        x1: top.x, y1: jy,
        cx: (top.x + s.x1) / 2, cy: (jy + s.y1) / 2,
        x2: s.x1, y2: s.y1,
        w: (jw + (s.w0 == null ? s.w : s.w0)) / 2,
        w0: jw, w1: (s.w0 == null ? s.w : s.w0),
        depth: 1
      });
    });

    // 骨架在交接处太稀时，补两级主枝：干 → 主枝 → 侧枝 → 冠
    if (picked.length < 2) {
      var need = picked.length ? 2 : 3;
      var base = picked.length ? picked[0].a : -1.5708;
      for (var k = 0; k < need; k++) {
        var ang = base + (k - (need - 1) / 2) * 1.02;
        var len = Math.min(104, rx * 0.36);
        var w1 = jw * 0.52;
        var ex = top.x + Math.cos(ang) * len;
        var ey = jy + Math.sin(ang) * len;
        segs.push({
          x1: top.x, y1: jy,
          cx: (top.x + ex) / 2 - Math.sin(ang) * 6,
          cy: (jy + ey) / 2 + Math.cos(ang) * 6,
          x2: ex, y2: ey,
          w: (jw + w1) / 2, w0: jw, w1: w1, depth: 1, synthetic: 1
        });
        // 第二级：从主枝末端再分两根，进冠体
        for (var q = 0; q < 2; q++) {
          var a2 = ang + (q ? 0.62 : -0.62);
          var l2 = len * 0.62;
          var w2 = w1 * 0.46;
          segs.push({
            x1: ex, y1: ey,
            cx: ex + Math.cos(a2) * l2 * 0.5,
            cy: ey + Math.sin(a2) * l2 * 0.5,
            x2: ex + Math.cos(a2) * l2, y2: ey + Math.sin(a2) * l2,
            w: (w1 + w2) / 2, w0: w1, w1: w2, depth: 2, synthetic: 1
          });
        }
      }
    }
  }

  // 沿段采样，给"叶只长在枝上"用
  function segmentPoints(segs, step) {
    var out = [];
    segs.forEach(function (s) {
      var n = Math.max(1, Math.ceil(Math.hypot(s.x2 - s.x1, s.y2 - s.y1) / step));
      for (var i = 0; i <= n; i++) {
        var t = i / n, u = 1 - t;
        out.push({
          x: u * u * s.x1 + 2 * u * t * s.cx + t * t * s.x2,
          y: u * u * s.y1 + 2 * u * t * s.cy + t * t * s.y2
        });
      }
    });
    return out;
  }

  // 只补"内部的洞"：从画框边缘泛洪，进不去的背景就是被树包住的空隙。
  // 外轮廓一个像素都不动，所以剪影还是照片的剪影。
  function fillHoles(mask, w, h) {
    var out = new Uint8Array(mask.length);
    var i;
    for (i = 0; i < mask.length; i++) out[i] = mask[i] ? 1 : 0;
    var seen = new Uint8Array(w * h);
    var stack = [];
    for (var x = 0; x < w; x++) { stack.push(x); stack.push((h - 1) * w + x); }
    for (var y = 0; y < h; y++) { stack.push(y * w); stack.push(y * w + w - 1); }
    while (stack.length) {
      var p = stack.pop();
      if (seen[p] || out[p]) continue;
      seen[p] = 1;
      var px = p % w, py = (p - px) / w;
      if (px > 0) stack.push(p - 1);
      if (px < w - 1) stack.push(p + 1);
      if (py > 0) stack.push(p - w);
      if (py < h - 1) stack.push(p + w);
    }
    for (i = 0; i < out.length; i++) {
      if (!out[i] && !seen[i]) out[i] = 1;
    }
    return out;
  }

  // 冠底：先找最宽的一行（冠心），再往下找"持续变窄"的那一行。
  // 从地面往上数会把照片里的深色地面/影子误当成冠，干与主枝就整段丢了。
  function canopyBottom(mask, w, h, box) {
    var maxC = 0, maxY = box.y0;
    var y, x, c;
    for (y = box.y0; y <= box.y1; y++) {
      c = 0;
      for (x = box.x0; x <= box.x1; x++) if (mask[y * w + x]) c++;
      if (c > maxC) { maxC = c; maxY = y; }
    }
    if (maxC < 4) return box.y0;
    var narrow = Math.max(3, maxC * 0.30);
    for (y = maxY; y <= box.y1; y++) {
      var run = true;
      for (var k = 0; k < 6 && y + k <= box.y1; k++) {
        var cc = 0;
        for (x = box.x0; x <= box.x1; x++) if (mask[(y + k) * w + x]) cc++;
        if (cc >= narrow) { run = false; break; }
      }
      if (run) return y;
    }
    return Math.min(box.y1 - 2, maxY + Math.round((box.y1 - maxY) * 0.55));
  }

  // 剪影薄片：给照片树打底，保证画出来的轮廓就是照片的轮廓
  function maskCanvas(mask, w, h) {
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var g = cv.getContext('2d');
    var id = g.createImageData(w, h);
    var d = id.data;
    for (var i = 0; i < w * h; i++) {
      if (!mask[i]) continue;
      d[i * 4] = 58; d[i * 4 + 1] = 68; d[i * 4 + 2] = 54; d[i * 4 + 3] = 255;
    }
    g.putImageData(id, 0, 0);
    return cv;
  }

  /* 极小剪影的兜底：偏亮的淡影，只提示"树在哪里"，
     真正读得出来的是后画的枝与少量叶簇。 */
  function ghostCanvas(mask, w, h) {
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var g = cv.getContext('2d');
    var id = g.createImageData(w, h);
    var d = id.data;
    for (var i = 0; i < w * h; i++) {
      if (!mask[i]) continue;
      d[i * 4] = 168; d[i * 4 + 1] = 174; d[i * 4 + 2] = 152; d[i * 4 + 3] = 76;
    }
    g.putImageData(id, 0, 0);
    var soft = document.createElement('canvas');
    soft.width = w; soft.height = h;
    var sg = soft.getContext('2d');
    try { sg.filter = 'blur(0.8px)'; } catch (e) {}
    sg.drawImage(cv, 0, 0);
    sg.filter = 'none';
    return soft;
  }

  /* 冠内明暗来自照片本身，而不是平涂：
     - 只在"树自己的像素"上取亮度（补洞前的剪影），背景的亮斑不进统计
     - 每小块取 28% 分位：叶团里最暗的那层才是树，亮的是叶隙与背景
     - 取不到树像素的块由邻居平均补上，整冠平滑后降对比
     - 内部几乎没层次（纯逆光黑轮廓）时返回 lowInfo，交给"淡影 + 枝"的兜底 */
  function photoCanopy(pixels, mask, filled, w, h, trunkTop) {
    var cell = 10;
    var gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);
    var N = gw * gh;
    var buckets = new Array(N), i;
    for (i = 0; i < N; i++) buckets[i] = [];

    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        i = y * w + x;
        if (!mask[i]) continue;
        var q = i * 4;
        var lum = pixels[q] * 0.299 + pixels[q + 1] * 0.587 + pixels[q + 2] * 0.114;
        buckets[((y / cell) | 0) * gw + ((x / cell) | 0)].push(lum);
      }
    }

    var med = new Float32Array(N), has = new Uint8Array(N), all = [];
    for (i = 0; i < N; i++) {
      var arr = buckets[i];
      if (!arr.length) continue;
      arr.sort(function (a, b) { return a - b; });
      var v = arr[Math.min(arr.length - 1, Math.floor(arr.length * 0.28))];
      med[i] = v; has[i] = 1; all.push(v);
    }
    if (all.length < 12) {
      // 极小剪影：没有足够的叶面可取样。给一张低透明度偏亮的淡影，
      // 让 bakeTree 里的枝与叶簇仍然可读，而不是一坨不透明深绿。
      return { cv: ghostCanvas(filled, w, h), lowInfo: true };
    }
    all.sort(function (a, b) { return a - b; });
    var p10 = all[Math.floor(all.length * 0.08)];
    var p50 = all[Math.floor(all.length * 0.50)];
    var p90 = all[Math.floor(all.length * 0.92)];
    // 纯逆光：树体几乎全是同一个黑，没有可用的叶面信息
    var lowInfo = (p90 - p10) < 18 || p50 < 26;

    // 空格补邻居：冠内的洞也能被周围叶面接住，不再留白点
    var fill = new Float32Array(N);
    fill.set(med);
    for (var pass = 0; pass < 160; pass++) {
      var changed = 0;
      for (var gy = 0; gy < gh; gy++) {
        for (var gx = 0; gx < gw; gx++) {
          var k = gy * gw + gx;
          if (has[k]) continue;
          var s = 0, c = 0;
          if (gx > 0 && has[k - 1]) { s += fill[k - 1]; c++; }
          if (gx < gw - 1 && has[k + 1]) { s += fill[k + 1]; c++; }
          if (gy > 0 && has[k - gw]) { s += fill[k - gw]; c++; }
          if (gy < gh - 1 && has[k + gw]) { s += fill[k + gw]; c++; }
          if (!c) continue;
          fill[k] = s / c; has[k] = 1; changed++;
        }
      }
      if (!changed) break;
    }

    // 平滑：照片里的叶点很碎，要让它们化开成叶面的大块明暗，而不是一张网
    var sm = new Float32Array(N);
    sm.set(fill);
    for (var sp = 0; sp < 4; sp++) {
      var nx2 = new Float32Array(N);
      for (var sy = 0; sy < gh; sy++) {
        for (var sx = 0; sx < gw; sx++) {
          var acc = 0, cn = 0;
          for (var dy = -1; dy <= 1; dy++) {
            for (var dx = -1; dx <= 1; dx++) {
              var xx = sx + dx, yy = sy + dy;
              if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue;
              acc += sm[yy * gw + xx]; cn++;
            }
          }
          nx2[sy * gw + sx] = acc / cn;
        }
      }
      sm.set(nx2);
    }

    // 冠内每块的覆盖：没被剪影盖住的块透明。
    // 冠底以下是干，不铺叶面——否则剪影里的方形树干会被照片亮度填成一根"木桩"。
    var occ = new Uint8Array(N);
    var crownCut = trunkTop == null ? h : trunkTop + 2;
    for (var fy = 0; fy < h; fy++) {
      if (fy > crownCut) continue;
      for (var fx = 0; fx < w; fx++) {
        if (filled[fy * w + fx]) occ[((fy / cell) | 0) * gw + ((fx / cell) | 0)] = 1;
      }
    }

    var small = document.createElement('canvas');
    small.width = gw; small.height = gh;
    var sg = small.getContext('2d');
    var img = sg.createImageData(gw, gh);
    var dd = img.data;
    function tone(t) {
      // 暗部偏冷绿褐 → 中间橄榄 → 亮部干草黄；低信息时是偏亮的灰绿"淡影"
      if (lowInfo) return [128, 136, 116];
      var c0 = [30, 37, 28], c1 = [68, 80, 48], c2 = [116, 124, 76];
      var a, b, u;
      if (t < 0.5) { a = c0; b = c1; u = t * 2; }
      else { a = c1; b = c2; u = (t - 0.5) * 2; }
      return [
        Math.round(a[0] + (b[0] - a[0]) * u),
        Math.round(a[1] + (b[1] - a[1]) * u),
        Math.round(a[2] + (b[2] - a[2]) * u)
      ];
    }
    var span = Math.max(1, p90 - p10);
    for (var by = 0; by < gh; by++) {
      for (var bx = 0; bx < gw; bx++) {
        var kk = by * gw + bx;
        if (!occ[kk]) continue;
        var t = (sm[kk] - p10) / span;
        t = Math.max(0, Math.min(1, t));
        // 降对比：振铃压掉一点，叶面才有"层次"而不是"高反差照片"
        t = 0.5 + (t - 0.5) * 0.72;
        var col = tone(t);
        var o = kk * 4;
        dd[o] = col[0]; dd[o + 1] = col[1]; dd[o + 2] = col[2];
        // 低信息：淡影要"看得见轮廓"，但不能回到深绿块——色阶本身是灰绿，
        // 提高一点不透明度只是让剪影成形，叶簇的碎点退成纹理
        dd[o + 3] = lowInfo ? 82 : 150;
      }
    }
    sg.putImageData(img, 0, 0);

    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var g = cv.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.drawImage(small, 0, 0, w, h);

    // 上亮下暗：只加很轻的一层，统一光向，不抢照片自己的层次
    g.globalCompositeOperation = 'source-atop';
    var vg = g.createLinearGradient(0, h * 0.05, 0, h * 0.86);
    vg.addColorStop(0, lowInfo ? 'rgba(255,246,220,0.04)' : 'rgba(255,246,220,0.10)');
    vg.addColorStop(0.5, 'rgba(255,246,220,0)');
    vg.addColorStop(1, lowInfo ? 'rgba(22,30,22,0.10)' : 'rgba(22,30,22,0.16)');
    g.fillStyle = vg;
    g.fillRect(0, 0, w, h);

    // 轮廓仍然按剪影收：羽化 0.6px，边缘不出现一圈硬壳
    g.globalCompositeOperation = 'destination-in';
    try { g.filter = 'blur(0.6px)'; } catch (e) {}
    g.drawImage(maskCanvas(filled, w, h), 0, 0);
    g.filter = 'none';
    g.globalCompositeOperation = 'source-over';

    return { cv: cv, lowInfo: lowInfo };
  }

  // 叶团只沿枝分布：把骨架点落到 10px 网格上，再向外膨胀两圈
  function skeletonGrid(skel, w, h, cell, passes) {
    var gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);
    var a = new Uint8Array(gw * gh);
    (skel || []).forEach(function (p) {
      var gx = Math.floor(p.x / cell), gy = Math.floor(p.y / cell);
      if (gx >= 0 && gy >= 0 && gx < gw && gy < gh) a[gy * gw + gx] = 1;
    });
    for (var pass = 0; pass < (passes == null ? 2 : passes); pass++) {
      var b = a.slice();
      for (var y = 0; y < gh; y++) {
        for (var x = 0; x < gw; x++) {
          if (!a[y * gw + x]) continue;
          if (x > 0) b[y * gw + x - 1] = 1;
          if (x < gw - 1) b[y * gw + x + 1] = 1;
          if (y > 0) b[(y - 1) * gw + x] = 1;
          if (y < gh - 1) b[(y + 1) * gw + x] = 1;
        }
      }
      a = b;
    }
    return { a: a, gw: gw, gh: gh, cell: cell };
  }

  // 照片树的叶锚：按剪影内部取样，团的大小跟着到轮廓的距离收，绝不把轮廓撑出去；
  // 同时只留在枝附近，冠内大片区域交给照片亮度，不再铺满一层"网"
  function photoLeaves(mask, dist, w, h, box, trunkTop, trunkAxis, near) {
    var cell = 10;
    var leaves = [];
    for (var y = box.y0 + cell; y <= box.y1 - cell * 0.5; y += cell) {
      for (var x = box.x0 + cell; x <= box.x1 - cell * 0.5; x += cell) {
        var i = Math.round(y) * w + Math.round(x);
        if (!mask[i]) continue;
        // 格子覆盖率：只取在轮廓内部的格子
        var inside = 0;
        for (var dy = -4; dy <= 4; dy += 4) {
          for (var dx = -4; dx <= 4; dx += 4) {
            var xx = Math.round(x + dx), yy = Math.round(y + dy);
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            if (mask[yy * w + xx]) inside++;
          }
        }
        if (inside < 5) continue;   // 9 个采样里少于 5 个在剪影里，就在边缘外

        var r = dist[i] || 0;
        if (r < 3) continue;

        // 只沿枝生叶：远离骨架的地方是照片自己的叶面，不再撒团
        if (near) {
          var gx = Math.floor(x / near.cell), gy = Math.floor(y / near.cell);
          if (gx < 0 || gy < 0 || gx >= near.gw || gy >= near.gh) continue;
          if (!near.a[gy * near.gw + gx]) continue;
        }

        // 树干下方：只留离主干够远的侧枝叶，别把树干糊成叶子
        if (y > trunkTop) {
          var ax = trunkAxis[Math.round(y)];
          if (ax && Math.abs(x - ax.x) < Math.max(11, ax.w * 0.7)) continue;
        }

        leaves.push({
          x: x, y: y,
          a: -1.5708 + (Math.round(x / cell) % 5 - 2) * 0.22,
          k: leaves.length,
          scale: Math.max(0.5, Math.min(1.0, r / 20))
        });
      }
    }
    return leaves;
  }

  function trunkAxisOf(segs, w, h) {
    var axis = new Array(h);
    segs.forEach(function (s) {
      if (s.depth > 0) return;
      var n = Math.max(2, Math.ceil(Math.hypot(s.x2 - s.x1, s.y2 - s.y1) / 4));
      for (var i = 0; i <= n; i++) {
        var t = i / n;
        var mt = 1 - t;
        var x = mt * mt * s.x1 + 2 * mt * t * s.cx + t * t * s.x2;
        var y = mt * mt * s.y1 + 2 * mt * t * s.cy + t * t * s.y2;
        var yy = Math.round(y);
        if (!axis[yy]) axis[yy] = { x: x, w: (s.w0 + s.w1) / 2 };
      }
    });
    // 没有覆盖到的行，用上下最近的补齐
    var last = null;
    for (var y = 0; y < h; y++) {
      if (axis[y]) last = axis[y];
      else if (last) axis[y] = last;
    }
    for (var y2 = h - 2; y2 >= 0; y2--) {
      if (!axis[y2] && axis[y2 + 1]) axis[y2] = axis[y2 + 1];
    }
    return axis;
  }

  /* =========================================================
     2. 骨架 → 图层（剪影 / 光晕 / 亮线 / 光点）
     ========================================================= */

  function verticalPaint(g, w, h, bottom, top) {
    var grad = g.createLinearGradient(0, h, 0, 0);
    grad.addColorStop(0, 'rgb(' + bottom.join(',') + ')');
    grad.addColorStop(0.56, 'rgb(' + top.join(',') + ')');
    grad.addColorStop(1, 'rgb(' + top.join(',') + ')');
    return grad;
  }

  function buildLayers(pts, tips, silhouetteCanvas) {
    var w = state.ww, h = state.wh;
    var pal = PALETTE[state.tint];

    // —— 光晕层：粗一点、预烘焙模糊，运行时只 drawImage
    var glow = document.createElement('canvas');
    glow.width = w; glow.height = h;
    var gg = glow.getContext('2d');
    gg.fillStyle = 'rgb(' + pal.glow.join(',') + ')';
    for (var i = 0; i < pts.length; i++) {
      gg.beginPath();
      gg.arc(pts[i].x, pts[i].y, 3.4, 0, 6.2832);
      gg.fill();
    }

    var g2 = document.createElement('canvas');
    g2.width = w; g2.height = h;
    var g2c = g2.getContext('2d');
    try { g2c.filter = 'blur(10px)'; } catch (e) {}
    g2c.drawImage(glow, 0, 0);
    g2c.filter = 'none';
    g2c.globalAlpha = 0.6;
    g2c.drawImage(glow, 0, 0);
    g2c.globalAlpha = 1;

    // —— 亮芯层
    var core = document.createElement('canvas');
    core.width = w; core.height = h;
    var cg = core.getContext('2d');
    cg.fillStyle = verticalPaint(cg, w, h, pal.core, pal.coreTop);
    for (var j = 0; j < pts.length; j++) {
      cg.beginPath();
      cg.arc(pts[j].x, pts[j].y, 1.1, 0, 6.2832);
      cg.fill();
    }

    // —— 光点：散在枝间的小方块，像树里住着灯
    var dots = document.createElement('canvas');
    dots.width = w; dots.height = h;
    var dg = dots.getContext('2d');
    dg.fillStyle = 'rgb(' + pal.dot.join(',') + ')';
    var n = Math.min(420, Math.max(120, Math.floor(pts.length * 0.10)));
    for (var k = 0; k < n; k++) {
      var p = pts[(Math.random() * pts.length) | 0];
      if (!p) break;
      var ox = (Math.random() - 0.5) * 13;
      var oy = (Math.random() - 0.5) * 13;
      var sz = 0.9 + Math.random() * 1.9;
      dg.globalAlpha = 0.25 + Math.random() * 0.6;
      dg.fillRect(p.x + ox, p.y + oy, sz, sz);
    }
    dg.globalAlpha = 1;

    state.layers = { sil: silhouetteCanvas, glow: g2, core: core, dots: dots };
    resetLight();   // 换树/换位置：点亮状态不该跟着搬过去
    state.transform = computeTransform();
    state.branchPaths = null;   // 树换了，枝梢连通路径要重算
    layoutHotspots();
    updateMeta();
    refreshReading();
  }

  // 树变了，读树面板要跟着变（不用等用户去点分页）
  function refreshReading() {
    var r = readingFor(state.focusSystem);
    if (!r) return;
    $('readingText').textContent = r.text;
    $('readingFormula').textContent = r.formula;
  }

  function silhouetteFromMask(mask, w, h, colorRGB) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var g = c.getContext('2d');
    var id = g.createImageData(w, h);
    for (var i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      var p = i * 4;
      id.data[p] = colorRGB[0];
      id.data[p + 1] = colorRGB[1];
      id.data[p + 2] = colorRGB[2];
      id.data[p + 3] = 255;
    }
    g.putImageData(id, 0, 0);
    return c;
  }

  /* 闭运算：把逆光照片里断掉的细枝连起来。
     不做这一步，1px 的枝被细化后会变成一串散点。 */
  function closeMask(mask, w, h) {
    var a = new Uint8Array(w * h);
    var b = new Uint8Array(w * h);
    var y, x, i;

    for (y = 1; y < h - 1; y++) {
      var row = y * w;
      for (x = 1; x < w - 1; x++) {
        i = row + x;
        a[i] = (mask[i] || mask[i - 1] || mask[i + 1] || mask[i - w] || mask[i + w] ||
          mask[i - w - 1] || mask[i - w + 1] || mask[i + w - 1] || mask[i + w + 1]) ? 1 : 0;
      }
    }
    for (y = 1; y < h - 1; y++) {
      var row2 = y * w;
      for (x = 1; x < w - 1; x++) {
        i = row2 + x;
        if (a[i] && a[i - 1] && a[i + 1] && a[i - w] && a[i + w] &&
          a[i - w - 1] && a[i - w + 1] && a[i + w - 1] && a[i + w + 1]) b[i] = 1;
      }
    }
    return b;
  }

  function computeTransform() {
    var w = state.ww, h = state.wh;
    if (!w || !h) return { tx: 0, ty: 0, tw: 0, th: 0 };

    var narrow = W < 720;
    var intro = document.body.classList.contains('intro');

    var dockEl = $('dock');
    var dockH = (dockEl && !dockEl.hidden) ? dockEl.offsetHeight + 26 : 0;

    var maxW, availH, floorY;
    if (intro) {
      // 空态：树缩一点、往上收，下半屏留给提示文字和控制条
      maxW = W * 0.74;
      availH = H - dockH - (narrow ? 165 : 148);
      floorY = H - dockH - 130;
    } else {
      // 有树了：树底要停在控制条上方，不能被挡住
      maxW = W * (narrow ? 0.96 : 0.84);
      availH = H - dockH - 30;
      floorY = H - dockH - 14;
    }

    // 档位只改大小：同一地点第一次已接近满幅，第六档正好顶到边
    var grow = state.place ? (0.86 + 0.028 * (state.tier - 1)) : 1;
    var s = Math.min(maxW / w, availH / h) * grow;
    var tw = w * s, th = h * s;

    return {
      tx: (W - tw) / 2,
      ty: floorY - th,
      tw: tw, th: th
    };
  }

  /* =========================================================
     3. 程序生成一棵树（没照片时也有得听）
     ========================================================= */

  /* 每次随机生成的树大小差很多，统一缩放到画布内，
     否则有时贴不满、有时顶出画面 */
  function normalize(segs, tips, w, h, margin) {
    var minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      if (s.x1 < minX) minX = s.x1;
      if (s.x2 < minX) minX = s.x2;
      if (s.x1 > maxX) maxX = s.x1;
      if (s.x2 > maxX) maxX = s.x2;
      if (s.y1 < minY) minY = s.y1;
      if (s.y2 < minY) minY = s.y2;
      if (s.y1 > maxY) maxY = s.y1;
      if (s.y2 > maxY) maxY = s.y2;
    }
    var bw = Math.max(1, maxX - minX);
    var bh = Math.max(1, maxY - minY);
    var sc = Math.min((w - margin * 2) / bw, (h - margin * 2) / bh);

    var ox = margin + (w - margin * 2 - bw * sc) / 2 - minX * sc;
    var oy = (h - margin) - bh * sc - minY * sc;

    for (var k = 0; k < segs.length; k++) {
      var g = segs[k];
      g.x1 = g.x1 * sc + ox;
      g.x2 = g.x2 * sc + ox;
      g.y1 = g.y1 * sc + oy;
      g.y2 = g.y2 * sc + oy;
      g.w = g.w * Math.max(0.5, Math.min(1.5, sc));
    }
    for (var j = 0; j < tips.length; j++) {
      tips[j].x = tips[j].x * sc + ox;
      tips[j].y = tips[j].y * sc + oy;
    }
  }

  /* 程序树交给 forms.js：同一颗种子 → 同一棵树。
     换主题只是换灯，不换树；换形态才重新长。 */
  /* 听歌长树：从主题曲抽 4 个特征，映射成画树的形态参数。
     - 音域跨度 → 树冠纵横（跨度大 = 高瘦，小 = 矮胖）
     - 音符密度 → 分枝级数 / 侧枝概率（密 = 枝叶繁）
     - 旋律起伏 → 枝的张开角 / 弯曲
     - 平均音高 → 树种（高 = 银杏/垂柳，低 = 乔木）
     没有主题曲返回 null → 树保持原来的样子（种子决定）。 */
  var SPECIES_HIGH = ['ginkgo', 'willow'];
  var SPECIES_LOW = ['oak', 'bush'];
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function songShape() {
    var d = theme.data;
    if (!d || !d.notes || d.notes.length < 4) return null;
    var notes = d.notes, n = notes.length, i;
    var lo = Infinity, hi = -Infinity, sum = 0, dur = 0;
    for (i = 0; i < n; i++) {
      var q = notes[i].midiQ != null ? notes[i].midiQ : notes[i].midi;
      if (q == null) continue;
      if (q < lo) lo = q;
      if (q > hi) hi = q;
      sum += q;
      dur += Math.max(0, (notes[i].t1 || 0) - (notes[i].t0 || 0));
    }
    if (!isFinite(lo)) return null;
    var mean = sum / n;
    var span = hi - lo;                          // 半音数
    var density = n / Math.max(1, dur);          // 音符/秒
    var motion = 0, steps = 0;
    for (i = 1; i < n; i++) {
      var a = notes[i - 1].midiQ != null ? notes[i - 1].midiQ : notes[i - 1].midi;
      var b = notes[i].midiQ != null ? notes[i].midiQ : notes[i].midi;
      if (a != null && b != null) { motion += Math.abs(b - a); steps++; }
    }
    motion = steps ? motion / steps : 0;

    // 归一化到 0..1（经验区间），再映射到参数
    var uSpan = clamp(span / 24, 0, 1);
    var uDens = clamp((density - 0.6) / 3.4, 0, 1);
    var uMove = clamp(motion / 7, 0, 1);
    var uPitch = clamp((mean - 52) / 24, 0, 1);

    var species = uPitch >= 0.5 ? SPECIES_HIGH[0] : SPECIES_LOW[0];
    // 起伏特别大且偏高 → 垂柳；非常低且密 → 灌木
    if (uPitch >= 0.5 && uMove >= 0.72) species = 'willow';
    if (uPitch < 0.25 && uDens >= 0.7) species = 'bush';

    // 只覆盖"安全参数"：分枝层数 / 侧枝概率 / 张开角 / 弯曲 / 倾斜。
    // 不碰 rx/ry/cy 这些几何中心——它们是各树种（尤其灌木、垂柳）精心调过的，
    // 用统一数值覆盖会把灌木压没（实测 skeleton 掉到 8）。
    var over = {
      // 密度 → 分枝层数与侧枝概率（密 = 枝叶繁）
      maxDepth: 3 + (uDens >= 0.45 ? 1 : 0),
      sideChance: 0.55 + uDens * 0.4,
      // 起伏 → 张开角与弯曲（起伏大 = 枝张得更开）
      spread: { 1: 0.72 + uMove * 0.40, 2: 0.86 + uMove * 0.42, 3: 0.98 + uMove * 0.44, 4: 1.10 + uMove * 0.46 },
      wave: 0.055 + uMove * 0.075,
      // 音域跨度也影响张开：跨度大，外圈枝再放宽一点
      reach: { 1: 0.30 + uSpan * 0.10, 2: 0.24 + uSpan * 0.10, 3: 0.16 + uSpan * 0.08, 4: 0.10 + uSpan * 0.06 },
      // 旋律整体走向（末音 - 首音）→ 树干倾斜
      lean: ((notes[n - 1].midiQ != null ? notes[n - 1].midiQ : notes[n - 1].midi) - lo) / 24 * 0.10 - 0.05
    };
    if (!isFinite(over.lean)) delete over.lean;
    // 树种也是这首歌选出来的（generateTree 读它；forms 忽略这个键）
    over.species = species;

    state.songShapeParams = {
      species: species, span: Math.round(span), density: +density.toFixed(2),
      motion: +motion.toFixed(2), mean: +mean.toFixed(1),
      uSpan: +uSpan.toFixed(2), uDens: +uDens.toFixed(2),
      uMove: +uMove.toFixed(2), uPitch: +uPitch.toFixed(2)
    };
    return over;
  }

  function generateTree() {
    setThrTag(null);   // 程序树没有照片，阈值不参与，别挂「自动」
    state.autoThrFailed = false;
    state.photoLowInfo = false;
    var w = 560, h = 680;
    // 有主题曲时让这首歌决定树种与形状；无主题曲保持种子决定
    var over = songShape() || {};
    // 同一地点的照片数只加"繁茂度"，不改身份（树种/种子/几何中心都不动）
    if (state.fullness > 0) over.fullness = state.fullness;
    if (over && over.species) state.species = over.species;
    state.songShapeOver = over;   // bakeArt 也要用同一组形态参数
    var data = window.TreeForms.generate(state.species, state.seed, w, h, over);
    // 同一套 forms 骨架、同一颗种子；画法用的比例修正也作用在骨架点上，
    // 这样枝梢点亮、读树注记跟树上看到的枝是同一处
    var shaped = window.TreeArt ? window.TreeArt.shape(state.seed, state.species, over) : null;
    var segs = shaped ? shaped.segs : data.segs;
    var tips = shaped ? shaped.tips : data.tips;

    // 剪影：沿二次曲线描，弯处才不会折成角
    var sil = document.createElement('canvas');
    sil.width = w; sil.height = h;
    var sg = sil.getContext('2d');
    var pal = PALETTE[state.tint];
    var grad = sg.createLinearGradient(0, h, 0, 0);
    // 树干底部不能一路压到黑，否则整棵树看着是飘着的
    grad.addColorStop(0, 'rgb(' + pal.sil.join(',') + ')');
    grad.addColorStop(0.42, 'rgb(' + pal.sil.join(',') + ')');
    grad.addColorStop(1, 'rgb(' + pal.silTop.join(',') + ')');
    sg.strokeStyle = grad;
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      // 贴地那一段用平头，圆帽会在树干脚底鼓出一个球
      sg.lineCap = s.flat ? 'butt' : 'round';
      sg.lineWidth = Math.max(0.7, s.w);
      sg.beginPath();
      sg.moveTo(s.x1, s.y1);
      sg.quadraticCurveTo(s.cx, s.cy, s.x2, s.y2);
      sg.stroke();
    }

    // 骨架点：沿曲线等距采样
    var pts = [];
    for (var k = 0; k < segs.length; k++) {
      var g2 = segs[k];
      var plen = Math.hypot(g2.x2 - g2.x1, g2.y2 - g2.y1);
      var stepN = Math.max(1, Math.floor(plen / 1.5));
      for (var t = 0; t <= stepN; t++) {
        pts.push(window.TreeForms.pointOn(g2, t / stepN));
      }
    }

    if (tips.length > 140) {
      var keep = [], st = tips.length / 140;
      for (var q = 0; q < 140; q++) keep.push(tips[Math.floor(q * st)]);
      tips = keep;
    }

    state.ww = w; state.wh = h;
    state.work = null;
    state.mask = null;
    state.pixels = null;
    state.box = { x0: 0, y0: 0, x1: w - 1, y1: h - 1 };
    state.generated = true;
    state.skel = pts;
    state.tips = tips;
    state.leafAnchors = shaped ? shaped.leaves : (data.leaves || []);
    buildLeaves();
    buildLayers(pts, tips, sil);
    bakeArt();
  }

  // 用样张定稿的 2D 画法把整棵树烘焙成一张透明底的位图
  function bakeArt() {
    if (!window.TreeArt) { state.art = null; return; }
    try {
      state.art = window.TreeArt.build(state.seed, state.species, state.songShapeOver);
    } catch (e) {
      state.art = null;
    }
  }

  /* =========================================================
     4. 重建（照片路径）
     ========================================================= */

  function rebuild(full) {
    if (state.generated || !state.pixels) { generateTree(); return; }

    // 切到照片时先清掉程序树的叶；真正的照片叶锚在骨架抽完后补回
    state.leafAnchors = [];
    buildLeaves();

    state.mask = binarize(state.threshold);
    state.box = boundingBox(state.mask, state.ww, state.wh);

    var sil = silhouetteFromMask(state.mask, state.ww, state.wh, PALETTE[state.tint].sil);
    state.layers = { sil: sil, glow: null, core: null, dots: null };
    state.transform = computeTransform();

    if (!full) return;   // 拖阈值时先留上一张烘焙图，松手再重烘

    state.art = null;
    var skel = thin(closeMask(state.mask, state.ww, state.wh), state.ww, state.wh, state.box);
    var res = collectSkeleton(skel, state.ww, state.wh, state.box);

    if (res.pts.length < 40) {
      // 阈值太狠，树上没剩几根线——退回剪影，别给个空罐子
      notice('剪影太少了 · 把「剪影阈值」往右拉一点');
      state.skel = [];
      state.tips = [];
      buildLayers(res.pts, res.tips, sil);
      return;
    }

    state.skel = res.pts;
    state.tips = res.tips;
    state.leafAnchors = res.leaves || [];
    buildLeaves();
    buildLayers(res.pts, res.tips, sil);
    bakePhotoArt(skel, res);
  }

  // 照片树烘焙：骨架量出枝宽与深度，叶锚按剪影内部取样，再交给同一套画法
  function bakePhotoArt(skel, res) {
    if (!window.TreeArt || !state.mask) return;
    var t0 = performance.now();
    try {
      var w = state.ww, h = state.wh;
      var pm = fillHoles(state.mask, w, h);
      var dist = distanceField(pm, w, h);
      var trunkTop = canopyBottom(pm, w, h, state.box);
      var br = photoBranches(skel, w, h, state.box, dist, trunkTop, state.mask);
      if (!br.segs.length) return;
      var segsBefore = br.segs.length;
      // 冠内骨架是一张网：先去掉它，只留下冠外可见的枝
      filterPhotoWeb(br, state.box, trunkTop);
      var segsAfter = br.segs.length;
      // 干 → 冠 的交接：延长干顶并接出进冠主枝，避免"一根杆插进一团绿"
      photoJunction(br, state.box, w, h);
      var axis = trunkAxisOf(br.segs, w, h);
      // 叶只长在枝附近：用原始骨架点 + 保留下来的枝，叶团才沿枝分布
      var nearPts = segmentPoints(br.segs, 8).concat(res.pts || []);
      var near = skeletonGrid(nearPts, w, h, 10, 2);
      var leaves = photoLeaves(pm, dist, w, h, state.box, br.trunkTop, axis, near);
      // 冠缘一圈软叶簇：破掉剪影的硬边，又不改变轮廓
      for (var yy = state.box.y0; yy <= state.box.y1; yy += 15) {
        for (var xx = state.box.x0; xx <= state.box.x1; xx += 15) {
          var ii = Math.round(yy) * w + Math.round(xx);
          if (!pm[ii] || yy > trunkTop + 10) continue;
          var dr = dist[ii] || 0;
          if (dr > 2.8 || dr < 1) continue;
          leaves.push({ x: xx, y: yy, a: -1.5708, k: 0, scale: 0.46 });
        }
      }
      // 真正的枝梢也作为叶锚，最外缘不至于秃
      (res.leaves || []).forEach(function (p) {
        leaves.push({ x: p.x, y: p.y, a: p.a, k: 0, scale: 0.62 });
      });
      if (leaves.length < 6) return;

      // 冠内层次用照片自己的亮度，不再平涂一层深绿
      var canopy = photoCanopy(state.pixels, state.mask, pm, w, h, trunkTop);
      state.photoLowInfo = !!canopy.lowInfo;

      var bx = state.box;
      var crown = {
        cx: (bx.x0 + bx.x1) / 2, cy: (bx.y0 + bx.y1) / 2,
        rx: Math.max(24, (bx.x1 - bx.x0) / 2 * 1.06),
        ry: Math.max(24, (bx.y1 - bx.y0) / 2 * 1.06)
      };

      state.art = window.TreeArt.buildPhoto({
        w: w, h: h,
        baseY: br.root ? br.root.y : h - 1,
        segs: br.segs, leaves: leaves, crown: crown, seed: state.seed,
        maskCv: maskCanvas(pm, w, h),
        canopyCv: canopy.cv,
        lowInfo: canopy.lowInfo
      });
      state.photoStats = {
        chains: br.chains, nodes: br.nodes, segs: br.segs.length,
        segsBefore: segsBefore, segsAfter: segsAfter,
        trunkTop: Math.round(br.trunkTop), boxTop: Math.round(state.box.y0),
        leaves: leaves.length, clumps: state.art ? state.art.stats.clumps : 0,
        lowInfo: !!canopy.lowInfo,
        ms: Math.round(performance.now() - t0)
      };
      // 读不出内部结构时，明确说出来，而不是糊成一坨深绿
      if (canopy.lowInfo) {
        notice('这张照片内部几乎没有叶面层次 · 现在按轮廓读枝，淡影只作位置提示');
        setTitle();
      }
    } catch (e) {
      state.art = null;
    }
  }

  /* =========================================================
     4.5 叶粒子 / 光尘 / 水纹
     叶锚在真实枝梢上，不是随机撒点；
     两级明暗（leafDark / leafLight）对应参考里的"叶群两层金"。
     ========================================================= */

  var leafRnd = window.TreeForms.random(9101);

  function buildLeaves() {
    state.leaves = [];
    var anchors = state.leafAnchors;
    if (!anchors || !anchors.length) return;
    for (var i = 0; i < anchors.length; i++) {
      var a = anchors[i];
      var tier = leafRnd();
      state.leaves.push({
        x: a.x, y: a.y, a: a.a,
        len: 2.6 + leafRnd() * 3.0,
        wid: 1.2 + leafRnd() * 1.0,
        tier: tier < 0.72 ? 0 : 1,          // 暗叶做底，亮叶只做高光，否则加色叠成一片白
        phase: leafRnd() * 6.2832,
        speed: 0.5 + leafRnd() * 0.9,
        sway: 0.10 + leafRnd() * 0.22
      });
    }
  }

  function buildMotes() {
    state.motes = [];
    var n = state.tint === 'day' ? 26 : 40;
    for (var i = 0; i < n; i++) {
      state.motes.push({
        x: Math.random(), y: Math.random(),
        r: 0.6 + Math.random() * 1.5,
        vx: (Math.random() - 0.5) * 0.006,
        vy: -(0.004 + Math.random() * 0.009),
        phase: Math.random() * 6.2832
      });
    }
  }

  /* 叶分两层画：
     先铺一层暗叶（正常混合）——它给出叶量和轮廓，树才不是一把发光的线；
     再叠一层亮叶（加色）——只在受光处闪光。
     全用加色的话，几千片小叶会互相烧成一团白雾。 */
  function drawLeaves(t, energy) {
    var pal = PALETTE[state.tint];
    var T = state.transform;
    var sx = T.tw / state.ww;
    var wind = Math.sin(t * 0.6) * 0.5 + energy.mid * 1.6;   // 风 + 音乐中频
    var day = state.tint === 'day';
    var warm = lightWarm();
    var i, lf, pass;
    // 叶面高光也按"光爬到哪"来给：冠顶在光到达之前不跟着满树闪
    var boxL = state.box || { y0: 0, y1: state.wh };
    var spanL = Math.max(1, boxL.y1 - boxL.y0);
    var frontY = boxL.y0 + spanL * (1 - state.light.front);
    var bandL = Math.max(1, spanL * 0.14);

    for (pass = 0; pass < 2; pass++) {
      var light = pass === 1;
      ctx.globalCompositeOperation = light && !day ? 'lighter' : 'source-over';
      var c = light ? pal.leafLight : pal.leafDark;
      ctx.fillStyle = 'rgb(' + c.join(',') + ')';
      for (i = 0; i < state.leaves.length; i++) {
        lf = state.leaves[i];
        if ((lf.tier === 1) !== light) continue;
        var px = T.tx + lf.x * sx;
        var py = T.ty + lf.y * sx;
        var ang = lf.a + Math.sin(t * lf.speed + lf.phase) * lf.sway * (0.6 + wind);
        // 树被画小的时候叶不能跟着缩成灰点，给一个屏幕下的下限
        var L = Math.max(2.1, lf.len * sx), Wd = Math.max(0.95, lf.wid * sx);
        var la = light
          ? (day ? 0.05 + warm * 0.16 + state.act * 0.20 : 0.03 + warm * 0.10 + state.act * 0.30)
          : (day ? 0.52 + warm * 0.30 : 0.26 + warm * 0.42);
        if (light && state.playing) {
          var dyl = lf.y - frontY;
          la *= dyl <= 0 ? 0.10 : Math.min(1, dyl / bandL);
        }
        ctx.globalAlpha = la;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(ang + Math.PI / 2);
        ctx.beginPath();
        ctx.ellipse(0, -L / 2, Wd, L, 0, 0, 6.2832);
        ctx.fill();
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawMotes(t, energy) {
    var pal = PALETTE[state.tint];
    var day = state.tint === 'day';
    ctx.globalCompositeOperation = day ? 'source-over' : 'lighter';
    for (var i = 0; i < state.motes.length; i++) {
      var m = state.motes[i];
      m.x += m.vx * 0.016; m.y += m.vy * 0.016;
      if (m.y < -0.05) { m.y = 1.05; m.x = Math.random(); }
      if (m.x < -0.05) m.x = 1.05; else if (m.x > 1.05) m.x = -0.05;
      var tw = 0.5 + 0.5 * Math.sin(t * 1.4 + m.phase);
      ctx.globalAlpha = (day ? 0.16 : 0.10) + tw * (day ? 0.22 : 0.30) + energy.high * 0.15;
      ctx.fillStyle = 'rgb(' + pal.dot2.join(',') + ')';
      ctx.beginPath();
      ctx.arc(m.x * W, m.y * H, m.r, 0, 6.2832);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /* 水纹：树底下有一条"地面/水面"。点哪里，哪里起环。
     夜里是金环，白天是绿环；环会推动叶子的摆动相位。 */
  function spawnRipple(x, y) {
    if (!state.waterOn) return;
    var T = state.transform;
    var floorY = T ? T.ty + T.th : H * 0.8;
    // 点在树冠上 → 落成一阵叶；点在水面附近 → 起水纹
    if (T && y < floorY - T.th * 0.12 &&
        x > T.tx - 30 && x < T.tx + T.tw + 30 &&
        y > T.ty - 30) {
      leafBurst(x, y);
      return;
    }
    state.ripples.push({ x: x, y: floorY, r: 4, a: 0.55 });
    if (state.ripples.length > 9) state.ripples.shift();
  }

  function leafBurst(x, y) {
    var T = state.transform;
    if (!T || !T.tw) return;
    var sx = T.tw / state.ww;
    for (var i = 0; i < 14; i++) {
      state.bursts.push({
        x: x, y: y,
        vx: (Math.random() - 0.5) * 1.7,
        vy: -(0.4 + Math.random() * 1.3),
        rot: Math.random() * 6.2832,
        vr: (Math.random() - 0.5) * 0.14,
        len: (2.6 + Math.random() * 4.2) * sx,
        wid: (1.2 + Math.random() * 1.8) * sx,
        tier: Math.random() < 0.5 ? 0 : 1,
        life: 1
      });
    }
    if (state.bursts.length > 90) state.bursts.splice(0, state.bursts.length - 90);
  }

  function drawWater(t) {
    var pal = PALETTE[state.tint];
    var T = state.transform;
    if (!T || !T.tw) return;
    var floorY = T.ty + T.th;
    var day = state.tint === 'day';

    // 地面/水面：一条很克制的线，不是一面湖
    ctx.globalCompositeOperation = 'source-over';
    var gl = ctx.createLinearGradient(T.tx, 0, T.tx + T.tw, 0);
    gl.addColorStop(0, 'rgba(' + pal.water.join(',') + ',0)');
    gl.addColorStop(0.5, 'rgba(' + pal.water.join(',') + ',' + (day ? 0.34 : 0.30) + ')');
    gl.addColorStop(1, 'rgba(' + pal.water.join(',') + ',0)');
    ctx.strokeStyle = gl;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(T.tx - T.tw * 0.14, floorY + 2);
    ctx.quadraticCurveTo(T.tx + T.tw / 2, floorY + 3.5 + Math.sin(t * 0.8) * 0.8,
      T.tx + T.tw * 1.14, floorY + 2);
    ctx.stroke();

    // 树的倒影：翻转剪影压扁 + 波纹抖动，只在有水纹功能时画
    if (state.layers && state.layers.sil) {
      ctx.save();
      ctx.globalAlpha = day ? 0.10 : 0.14;
      ctx.translate(0, floorY * 2 + 4);
      ctx.scale(1, -0.42);
      ctx.drawImage(state.layers.sil, T.tx, T.ty, T.tw, T.th);
      ctx.restore();
    }

    // 环
    ctx.globalCompositeOperation = day ? 'source-over' : 'lighter';
    for (var i = state.ripples.length - 1; i >= 0; i--) {
      var r = state.ripples[i];
      r.r += 1.9; r.a *= 0.965;
      if (r.a < 0.02) { state.ripples.splice(i, 1); continue; }
      ctx.globalAlpha = r.a;
      ctx.strokeStyle = 'rgba(' + pal.water.join(',') + ',0.9)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, r.r, r.r * 0.30, 0, 0, 6.2832);
      ctx.stroke();
      ctx.globalAlpha = r.a * 0.5;
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, r.r * 0.62, r.r * 0.19, 0, 0, 6.2832);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawBursts() {
    if (!state.bursts.length) return;
    var pal = PALETTE[state.tint];
    var day = state.tint === 'day';
    ctx.globalCompositeOperation = 'source-over';
    for (var i = state.bursts.length - 1; i >= 0; i--) {
      var b = state.bursts[i];
      b.vy += 0.045;                 // 重力
      b.vx *= 0.992;
      b.x += b.vx; b.y += b.vy;
      b.rot += b.vr;
      b.life -= 0.006;
      if (b.life <= 0 || b.y > H + 20) { state.bursts.splice(i, 1); continue; }
      var c = b.tier ? pal.leafLight : pal.leafDark;
      ctx.globalAlpha = Math.min(1, b.life * 1.4) * (day ? 0.85 : 0.95);
      ctx.fillStyle = 'rgb(' + c.join(',') + ')';
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.rot);
      ctx.beginPath();
      ctx.ellipse(0, 0, b.wid, b.len, 0, 0, 6.2832);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  /* =========================================================
     5. 音频
     ========================================================= */

  var AC = null, master = null, analyser = null, freq = new Uint8Array(0);
  var droneNodes = [], noteTimer = null, demoTimer = null, mediaSrc = null;
  var PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26];
  var BASE = 130.81;   // C3

  /* =========================================================
     5.1 曲风引擎：三套真正不同的作曲法
     ---------------------------------------------------------
     每套引擎自带音阶 / 音色 / 低音层 / 节奏，不同树分到不同曲风。
     - pluck   拨弦·五声：点状、稀疏、温暖（原来的默认，保留担保底）
     - minimal 极简循环：固定音型循环 + 缓慢相位漂移
     - bell    钟琴：FM 金属音 + 长衰减 + 琶音成组
     同一棵树靠 seed 选同一引擎；也可在抽屉里手动换。
     ========================================================= */
  var ENGINES = {
    pluck: {
      name: '拨弦 · 五声',
      short: '拨弦',
      mood: '枝梢像雨点，一颗一颗落下来',
      scale: [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26],  // 五声
      base: 130.81,
      gap: function () { return 1400 + Math.random() * Math.max(1100, 2500 - state.tier * 200); },
      // 极简：没有显式序列，随机挑枝梢
      next: function (seq) { seq.i = (seq.i + 1) % 97; return -1; }
    },
    minimal: {
      name: '极简循环',
      short: '循环',
      mood: '一小段音型反复转，像年轮',
      scale: [0, 2, 4, 7, 11, 12, 14, 16, 19, 23, 24],      // 大调 + 七度
      base: 146.83,                                          // D3，比拨弦亮一点
      stepSec: 0.42,                                         // 均匀脉冲
      pattern: [0, 2, 4, 2, 5, 4, 2, 1],                    // 8 音音型（音阶索引）
      gap: function () { return this.stepSec * 1000; },
      next: function (seq) {
        var d = this.pattern[seq.i % this.pattern.length];
        seq.i++;
        // 每转一圈，整段音型偶尔上移/下移一格（缓慢漂移）
        if (seq.i % this.pattern.length === 0 && Math.random() < 0.22) {
          seq.drift = Math.max(-2, Math.min(2, seq.drift + (Math.random() < 0.5 ? -1 : 1)));
        }
        return Math.max(0, Math.min(this.scale.length - 1, d + seq.drift));
      }
    },
    bell: {
      name: '钟琴 · 空谷',
      short: '钟琴',
      mood: '金属泛音悬在空气中，很久才散',
      scale: [0, 1, 5, 7, 8, 12, 13, 17, 19, 20, 24],       // 都节/小林式，带半音的空
      base: 174.61,                                          // F3
      gap: function (seq) {
        // 琶音成组：组内短（0.5s），组间长留白（3~4s）
        return seq.groupLeft > 0 ? 520 : 2800 + Math.random() * 1400;
      },
      next: function (seq) {
        if (seq.groupLeft <= 0) {
          seq.groupLeft = 3 + ((Math.random() * 3) | 0);     // 新的一组：3~5 音
          seq.groupBase = 3 + ((Math.random() * 4) | 0);     // 从音阶中高段起
          seq.groupDir = Math.random() < 0.7 ? 1 : -1;
        }
        var idx = seq.groupBase;
        seq.groupBase += seq.groupDir;
        if (seq.groupBase >= this.scale.length - 1 || seq.groupBase < 0) {
          seq.groupDir *= -1;
          seq.groupBase += seq.groupDir * 2;
        }
        seq.groupLeft--;
        return Math.max(0, Math.min(this.scale.length - 1, idx));
      }
    }
  };
  var ENGINE_KEYS = ['pluck', 'minimal', 'bell'];
  var seqState = { key: null, seed: null, score: null, i: 0, drift: 0, groupLeft: 0, groupBase: 0, groupDir: 1 };
  var ENGINE_STORE = 'tree.engine';   // localStorage 前缀，按 treeId/seed 存

  /* ---- 种子作曲：同一棵树永远同一段旋律 ----
     树的身份（treeId）决定谱子，不掺 Math.random。
     每棵树生成一条固定的「音高序列 + 时值序列」循环播放：
     同一棵树每次听都一样；不同的树曲子不同——不用贴任何标签。
     ENGINES 仍决定音阶 / 音色 / 低音层，这里只负责「作曲」。 */
  function rngFrom(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function scoreSeed() {
    var id = state.treeId || (state.seed + ':' + state.species);
    return seedFrom('score:' + id);
  }
  // 有界随机游走：旋律像音高在走，不上下乱跳，也不卡在一个音
  function walk(r, len, start, n, step) {
    var out = [], cur = start;
    for (var i = 0; i < n; i++) {
      out.push(cur);
      cur += ((r() * (step * 2 + 1)) | 0) - step;
      if (cur >= len) cur = len - 1 - (cur - (len - 1));
      if (cur < 0) cur = -cur;
      cur = Math.max(0, Math.min(len - 1, cur));
    }
    return out;
  }
  function buildScore(key, seed) {
    var r = rngFrom(seed), eng = ENGINES[key] || ENGINES.pluck;
    var len = eng.scale.length, notes = [], gaps = [], i;
    if (key === 'minimal') {
      // 极简：seed 定音型长度与走向，均匀脉冲里带一点速度差
      var plen = 6 + ((r() * 6) | 0);
      notes = walk(r, len, 1 + ((r() * 4) | 0), plen, 2);
      var stepMs = (eng.stepSec || 0.42) * 1000 * (0.85 + r() * 0.35);
      for (i = 0; i < plen; i++) gaps.push(stepMs);
    } else if (key === 'bell') {
      // 钟琴：seed 定几组琶音，组内短、组间长留白
      var groups = 5 + ((r() * 5) | 0);
      for (var g = 0; g < groups; g++) {
        var start = 3 + ((r() * Math.max(1, len - 5)) | 0);
        var dir = r() < 0.68 ? 1 : -1;
        var cnt = 3 + ((r() * 3) | 0);
        var seg = walk(r, len, start, cnt, 1);
        for (var j = 0; j < seg.length; j++) {
          notes.push(seg[j]);
          gaps.push(j === 0 ? (2400 + r() * 1900) : (470 + r() * 170));
        }
      }
    } else {
      // 拨弦：seed 定一条中低音区的游走旋律，疏密也编进时值
      var n = 22 + ((r() * 10) | 0);
      notes = walk(r, len, 2 + ((r() * 5) | 0), n, 2);
      for (i = 0; i < n; i++) {
        var x = r();
        gaps.push(x < 0.14 ? 3800 + r() * 1600 : 720 + x * x * 2900);
      }
    }
    return { notes: notes, gaps: gaps };
  }
  function resetSeq() {
    seqState = { key: null, seed: null, score: null, i: 0, drift: 0, groupLeft: 0, groupBase: 0, groupDir: 1 };
  }
  function ensureScore() {
    var key = state.engine, sd = scoreSeed();
    if (!seqState.score || seqState.key !== key || seqState.seed !== sd) {
      seqState.key = key; seqState.seed = sd; seqState.score = buildScore(key, sd); seqState.i = 0;
    }
    return seqState.score;
  }
  function scoreIndex() {
    var s = ensureScore(), k = seqState.i % s.notes.length;
    seqState.i = (seqState.i + 1) % 100000;
    return k;
  }

  function engineKeyForTree() {
    var id = state.treeId || (state.seed + ':' + state.species);
    try {
      var saved = localStorage.getItem(ENGINE_STORE + ':' + id);
      if (saved && ENGINES[saved]) return saved;
    } catch (e) {}
    // 按身份确定性分配：同一棵树永远同一曲风
    var h = seedFrom('engine:' + id);
    return ENGINE_KEYS[h % ENGINE_KEYS.length];
  }
  function currentEngine() { return ENGINES[state.engine] || ENGINES.pluck; }
  function setEngine(key, keepPlaying) {
    if (!ENGINES[key]) return;
    state.engine = key;
    try {
      var id = state.treeId || (state.seed + ':' + state.species);
      localStorage.setItem(ENGINE_STORE + ':' + id, key);
    } catch (e) {}
    resetSeq();
    if (AC) {
      stopDrone(); stopNotes(); stopTheme();
      if (state.playing && state.mode === 'listen') {
        startDrone();
        if (!hasTheme()) scheduleNote(); else startTheme();
      }
    }
    syncEngineUI();
    updateMeta();
    if (!keepPlaying) notice('曲风已换成「' + ENGINES[key].name + '」· ' + ENGINES[key].mood);
  }

  /* 这棵树的主题曲：只替换 listen 模式的随机枝梢音，不改树的形状与音景 */
  var theme = {
    data: null,        // { notes:[{t0,t1,hz,rel,...}], points, gaps, duration, name, coverage }
    buffer: null,      // 本次会话里解码后的音频，用于圈选重抽
    fileName: '',
    sel: null,         // 圈选区间 {t0,t1}
    geom: null,        // 画布几何，用于把鼠标位置换回时间
    timer: null,
    idx: 0
  };

  function impulse(sec, decay) {
    var len = Math.floor(AC.sampleRate * sec);
    var buf = AC.createBuffer(2, len, AC.sampleRate);
    for (var c = 0; c < 2; c++) {
      var d = buf.getChannelData(c);
      for (var i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  var revNode = null, revTier = 0;

  // 档位 → 混响空间：1 档 3.2s，6 档 5.5s。
  // Convolver 默认 normalize，只改尾巴长短；wet 增益固定，音量不变。
  function reverbSeconds() {
    var t = Math.max(1, Math.min(6, state.tier || 1));
    return 3.2 + (t - 1) * (2.3 / 5);
  }

  // 档位 → 声部倍数：1–2 档三层，3–4 档四层，5–6 档六层
  function tierMultis() {
    var m = [1, 1.5, 2.004];
    if (state.tier >= 3) m.push(2.5);
    if (state.tier >= 5) m.push(3.0, 4.008);
    return m;
  }
  // 档位 → 混响更长；不改总音量
  function applyTierSound() {
    if (!AC || !revNode) return;
    var t = Math.max(1, Math.min(6, state.tier || 1));
    if (t === revTier) return;
    revTier = t;
    try { revNode.buffer = impulse(reverbSeconds(), 2.6); } catch (e) {}
  }

  function ensureAudio() {
    if (AC) return;
    var Ctx = window.AudioContext || window.webkitAudioContext;
    AC = new Ctx();

    master = AC.createGain();
    master.gain.value = 0.85;

    analyser = AC.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.82;
    freq = new Uint8Array(analyser.frequencyBinCount);

    revNode = AC.createConvolver();
    revTier = Math.max(1, Math.min(6, state.tier || 1));
    revNode.buffer = impulse(reverbSeconds(), 2.6);
    var wet = AC.createGain();
    wet.gain.value = 0.44;

    master.connect(analyser);
    analyser.connect(AC.destination);
    master.connect(revNode);
    revNode.connect(wet);
    wet.connect(analyser);
  }

  /* 空气的声音：一层风噪 + 一层雨，雾把空气声的高频压掉。
     只挂在 master 上，不改树的音景与主题曲。 */
  var amb = { ready: false, wind: null, rain: null, bus: null, srcs: [] };

  function ensureAmbient() {
    ensureAudio();
    if (!AC || amb.ready) return;
    var buf = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate);
    var d = buf.getChannelData(0), s = 20261;
    for (var i = 0; i < d.length; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      d[i] = (s / 0x3fffffff) - 1;
    }
    function loop() {
      var src = AC.createBufferSource();
      src.buffer = buf; src.loop = true; src.start();
      amb.srcs.push(src);
      return src;
    }

    var bus = AC.createBiquadFilter();
    bus.type = 'lowpass'; bus.frequency.value = 18000;
    bus.connect(master);
    amb.bus = bus;

    var wf = AC.createBiquadFilter();
    wf.type = 'lowpass'; wf.frequency.value = 620; wf.Q.value = 0.6;
    amb.wind = AC.createGain(); amb.wind.gain.value = 0;
    loop().connect(wf); wf.connect(amb.wind); amb.wind.connect(bus);

    var lfo = AC.createOscillator(); lfo.frequency.value = 0.07;
    var lg = AC.createGain(); lg.gain.value = 700;
    lfo.connect(lg); lg.connect(wf.frequency); lfo.start();

    var rf = AC.createBiquadFilter();
    rf.type = 'highpass'; rf.frequency.value = 1400;
    amb.rain = AC.createGain(); amb.rain.gain.value = 0;
    loop().connect(rf); rf.connect(amb.rain); amb.rain.connect(bus);

    amb.ready = true;
    applyAmbient(true);
  }

  function applyAmbient(instant) {
    if (!AC || !amb.ready) return;
    var t = AC.currentTime, k = instant ? 0.02 : 0.5;
    var wTarget = state.weather === 'rain' ? 0.012 : (state.weather === 'fog' ? 0.030 : 0.045);
    var rTarget = state.weather === 'rain' ? 0.060 : 0;
    amb.wind.gain.cancelScheduledValues(t);
    amb.wind.gain.setTargetAtTime(wTarget, t, k);
    amb.rain.gain.cancelScheduledValues(t);
    amb.rain.gain.setTargetAtTime(rTarget, t, k);
    amb.bus.frequency.cancelScheduledValues(t);
    amb.bus.frequency.setTargetAtTime(state.weather === 'fog' ? 1500 : 18000, t, k);
  }

  var AIR_TEXT = { wind: '微风 · 枝在轻摆', rain: '下雨 · 叶在滴水', fog: '起雾 · 轮廓在化' };

  function setWeather(w) {
    if (w !== 'wind' && w !== 'rain' && w !== 'fog') return;
    state.weather = w;
    document.querySelectorAll('#airSeg [data-w]').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-w') === w);
      b.setAttribute('aria-pressed', b.getAttribute('data-w') === w);
    });
    if ($('airState')) $('airState').textContent = AIR_TEXT[w];
    ensureAmbient();
    applyAmbient(false);
  }

  // 三种音色：共用一个出口 noteVoice(hz, when, vol)，由当前曲风选
  function pluckVoice(hz, when, vol) {
    var o1 = AC.createOscillator();
    var o2 = AC.createOscillator();
    var g = AC.createGain();
    var g2 = AC.createGain();

    o1.type = 'sine';
    o2.type = 'triangle';
    o1.frequency.value = hz;
    o2.frequency.value = hz * 2.004;
    g2.gain.value = 0.22;

    o1.connect(g);
    o2.connect(g2);
    g2.connect(g);
    g.connect(master);

    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), when + 0.014);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 3.8);

    o1.start(when); o2.start(when);
    o1.stop(when + 4.2); o2.stop(when + 4.2);
  }

  // 极简循环：短促三角波 + 低通，颗粒干净，像反复转动的齿轮
  function minimalVoice(hz, when, vol) {
    var o = AC.createOscillator();
    var g = AC.createGain();
    var lp = AC.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.min(4200, hz * 6);
    lp.Q.value = 0.4;
    o.type = 'triangle';
    o.frequency.value = hz;
    o.connect(lp); lp.connect(g); g.connect(master);
    var v = Math.max(0.0002, vol * 0.8);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(v, when + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.9);
    o.start(when); o.stop(when + 1.0);
  }

  // 钟琴：FM（载波 + 调制），金属泛音，长衰减，空灵
  function bellVoice(hz, when, vol) {
    var car = AC.createOscillator();       // 载波
    var mod = AC.createOscillator();       // 调制器
    var modG = AC.createGain();            // 调制深度
    var g = AC.createGain();
    car.type = 'sine';
    car.frequency.value = hz;
    mod.type = 'sine';
    mod.frequency.value = hz * 3.01;       // 非整数比 → 金属感
    modG.gain.setValueAtTime(hz * 2.2, when);
    modG.gain.exponentialRampToValueAtTime(hz * 0.05, when + 1.6);
    mod.connect(modG); modG.connect(car.frequency);
    car.connect(g); g.connect(master);
    var v = Math.max(0.0002, vol * 0.7);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(v, when + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 5.2);
    car.start(when); mod.start(when);
    car.stop(when + 5.6); mod.stop(when + 5.6);
  }

  function noteVoice(hz, when, vol) {
    var k = state.engine;
    if (k === 'minimal') return minimalVoice(hz, when, vol);
    if (k === 'bell') return bellVoice(hz, when, vol);
    return pluckVoice(hz, when, vol);
  }
  // grow 模式的演示曲沿用拨弦音色（它是固定 demo，不属于树的曲风）
  var pluck = pluckVoice;

  function kick(when) {
    var o = AC.createOscillator();
    var g = AC.createGain();
    o.frequency.setValueAtTime(120, when);
    o.frequency.exponentialRampToValueAtTime(42, when + 0.18);
    g.gain.setValueAtTime(0.26, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.34);
    o.connect(g); g.connect(master);
    o.start(when); o.stop(when + 0.4);
  }

  function startDrone() {
    stopDrone();
    var eng = currentEngine();
    var k = state.engine;
    var g = AC.createGain();
    g.gain.value = 0.0001;

    var lp = AC.createBiquadFilter();
    lp.type = 'lowpass';

    // 低音根音从这棵树的谱子里选（音阶低段，保证仍在调内），
    // 这样连背景嗡鸣都每棵树不同，而不是同一引擎一个根音
    var dr = rngFrom(scoreSeed() ^ 0x9e3779b9);
    var rootDeg = eng.scale[Math.floor(dr() * Math.min(4, eng.scale.length))];
    var root = eng.base * Math.pow(2, rootDeg / 12) / 2;
    var mults, level, rampTo, lpF;

    if (k === 'minimal') {
      // 极简：干净的五度嗡鸣（1 + 1.5 + 2），不随档位堆很多声部
      mults = [1, 1.5, 2, 3];
      lpF = 520;
      rampTo = 0.055;
    } else if (k === 'bell') {
      // 钟琴：只有低八度一个根音，很淡，留出空气感
      mults = [0.5, 1];
      lpF = 380;
      rampTo = 0.038;
    } else {
      // 拨弦：原来的泛音堆，档位越高声部越多
      mults = tierMultis();
      lpF = 300;
      rampTo = 0.085 * (3 / mults.length);
    }

    g.gain.linearRampToValueAtTime(rampTo, AC.currentTime + 5);
    lp.frequency.value = lpF;

    mults.forEach(function (m, i) {
      var o = AC.createOscillator();
      o.type = 'sine';
      o.frequency.value = root * m * (1 + (i - 1) * 0.0009);
      o.connect(g);
      o.start();
      droneNodes.push(o);
    });

    g.connect(lp);
    lp.connect(master);
    droneNodes.push(g, lp);
  }

  function stopDrone() {
    droneNodes.forEach(function (n) {
      try { if (n.stop) n.stop(); if (n.disconnect) n.disconnect(); } catch (e) {}
    });
    droneNodes = [];
  }

  function scheduleNote() {
    if (!state.playing || state.mode !== 'listen') return;
    if (hasTheme()) return;   // 有主题曲就播主题曲

    var eng = currentEngine();
    var k = state.engine;
    var s = ensureScore();
    var idx = s.notes[scoreIndex()];                    // 音阶索引：来自这棵树的固定谱子
    var deg = eng.scale[Math.min(eng.scale.length - 1, idx)];
    var hz = eng.base * Math.pow(2, deg / 12);
    // 强弱也从音高派生，不用随机数：同一首曲子每次听强弱一致
    var vol = (k === 'bell' ? 0.072 : 0.082) + (idx % 5) * 0.004;
    noteVoice(hz, AC.currentTime + 0.03, vol);
    // 点亮一根高度对应的枝梢，保持"音落在树上"的视觉
    var p = tipForRel(Math.min(0.98, idx / Math.max(1, eng.scale.length - 1)));
    if (p) lightTip(p, 1);

    // 时值来自同一条谱子：拨弦疏密 / 循环均匀脉冲 / 钟琴琶音成组
    noteTimer = setTimeout(scheduleNote, s.gaps[(seqState.i - 1) % s.gaps.length]);
  }

  function stopNotes() {
    if (noteTimer) { clearTimeout(noteTimer); noteTimer = null; }
  }

  /* ---------------------------------------------------------
     主题曲播放：按旋律顺序 pluck + 点亮对应的枝梢
     音色用这棵树的合成音色（pluck），不放原曲
     --------------------------------------------------------- */
  function stopTheme() {
    if (theme.timer) { clearTimeout(theme.timer); theme.timer = null; }
    theme.idx = 0;
  }

  function startTheme() {
    stopTheme();
    if (!theme.data || !theme.data.notes.length) return;
    theme.idx = 0;
    themeStep();
  }

  function themeStep() {
    if (!state.playing || state.mode !== 'listen' || !theme.data) return;
    var notes = theme.data.notes;
    if (theme.idx >= notes.length) {
      theme.idx = 0;
      state.light.done = true;   // 一遍放完：停在点亮态，不清空
      theme.timer = setTimeout(themeStep, 2600);   // 留一口气再来
      return;
    }
    var n = notes[theme.idx++];
    var tip = tipForRel(n.rel);
    noteVoice(n.hz, AC.currentTime + 0.03, 0.095);
    if (tip) lightTip(tip, 1);

    // 按原曲的音间距往下排：密的段落连着响，拉开的段落留空
    var wait = 1.2;   // 最后一个音的收尾，和 themeLoopSec 的 +1.2 对齐
    if (theme.idx < notes.length) wait = Math.max(0.06, notes[theme.idx].t0 - n.t0);
    theme.timer = setTimeout(themeStep, wait * 1000);
  }

  // 音高关系 → 这棵树真实存在的一根枝梢
  function tipForRel(rel) {
    if (!state.tips.length) return null;
    var box = state.box || { y0: 0, y1: state.wh };
    var span = Math.max(1, box.y1 - box.y0);
    var y = box.y0 + (1 - rel) * span;
    var best = null, bestD = Infinity, near = [];
    for (var i = 0; i < state.tips.length; i++) {
      var d = Math.abs(state.tips[i].y - y);
      if (d < bestD) { bestD = d; best = state.tips[i]; }
      if (d <= span * 0.02) near.push(state.tips[i]);
    }
    // 同一个音高（rel 相同）固定落在同一根枝梢：连着响才是一下一下地跳
    if (near.length) return near[Math.floor(rel * 1000) % near.length];
    return best;
  }

  /* ---------------------------------------------------------
     点亮：一个短促的环形扩散 + 该枝梢往根部的一小段枝条提亮
     光斑不叠加成一片：同时最多 3 个；附近已有未散尽的光斑时，
     新光斑的强度按距离打折。
     --------------------------------------------------------- */
  function buildBranchPaths() {
    var pts = state.skel || [], tips = state.tips || [];
    var cell = 12, grid = {};
    for (var i = 0; i < pts.length; i++) {
      var key = Math.floor(pts[i].x / cell) + '_' + Math.floor(pts[i].y / cell);
      (grid[key] || (grid[key] = [])).push(i);
    }

    state.branchPaths = tips.map(function (tip) {
      var path = [{ x: tip.x, y: tip.y }];
      var used = {};
      var cur = { x: tip.x, y: tip.y };
      var len = 0, guard = 0;

      // 朝根部走：用"根在下方中间"给每一步一个方向，避免在枝梢附近打转
      var bx = state.box || { x0: 0, x1: state.ww, y0: 0, y1: state.wh };
      var rootX = (bx.x0 + bx.x1) / 2, rootY = bx.y1;
      var dirX = rootX - tip.x, dirY = rootY - tip.y;
      var dl = Math.hypot(dirX, dirY) || 1;
      dirX /= dl; dirY /= dl;

      while (len < 66 && guard++ < 90) {
        var cx = Math.floor(cur.x / cell), cy = Math.floor(cur.y / cell);
        var best = -1, bestScore = Infinity;
        for (var dx = -1; dx <= 1; dx++) {
          for (var dy = -1; dy <= 1; dy++) {
            var list = grid[(cx + dx) + '_' + (cy + dy)];
            if (!list) continue;
            for (var j = 0; j < list.length; j++) {
              var idx = list[j];
              if (used[idx]) continue;
              var p = pts[idx];
              var vx = p.x - cur.x, vy = p.y - cur.y;
              var d = Math.hypot(vx, vy);
              if (d < 1e-3) continue;
              if (d > (path.length === 1 ? 44 : cell * 1.6)) continue;
              var toward = (vx * dirX + vy * dirY) / d;   // 1 = 正对根部
              if (toward < -0.1) continue;                // 不往树冠外走
              var score = d * (1.7 - toward);
              if (score < bestScore) { bestScore = score; best = idx; }
            }
          }
        }
        if (best < 0) break;
        used[best] = 1;
        cur = pts[best];
        path.push({ x: cur.x, y: cur.y });
        len += Math.hypot(cur.x - path[path.length - 2].x, cur.y - path[path.length - 2].y);
      }
      return path;
    });
  }

  function pathForTip(p) {
    if (!state.branchPaths || state.branchPaths.length !== state.tips.length) buildBranchPaths();
    var idx = state.tips.indexOf(p);
    return idx >= 0 ? state.branchPaths[idx] : null;
  }

  function lightTip(p, strength) {
    if (!p) return;
    var now = performance.now();
    var boost = strength == null ? 1 : strength;

    // 前一个还没散尽，又落在附近：压一压新光斑，别糊成一片
    var minD = Infinity;
    for (var i = 0; i < state.flashes.length; i++) {
      var f = state.flashes[i];
      if ((now - f.born) / f.dur >= 1) continue;
      var d = Math.hypot(f.x - p.x, f.y - p.y);
      if (d < minD) minD = d;
    }
    if (minD < 70) boost *= 0.62;
    if (minD < 34) boost *= 0.62;

    // 这一根枝梢的余晖：鸣响时点亮，之后慢慢退（不是瞬灭）
    p.g = Math.max(p.g || 0, 0.55 + 0.45 * boost);
    p.hitAt = now;                 // 连点时用来做"一下一下"的跳动
    state.noteTimes.push(now);
    if (state.noteTimes.length > 60) state.noteTimes.shift();

    state.flashes.push({
      x: p.x, y: p.y,
      path: pathForTip(p),
      born: now,
      dur: 480 + Math.random() * 160,   // 0.48–0.64s 内散尽
      boost: Math.max(0.28, boost)
    });
    if (state.flashes.length > 3) state.flashes.splice(0, state.flashes.length - 3);
  }

  /* ---------------------------------------------------------
     点亮的两条时间线：
     1) front —— 光从根部往冠上爬，速度按这次播放的时长归一
     2) 每根枝梢自己的 g —— 鸣响时亮，余晖约 1.9 秒退到残留
     播完（done）后停在点亮态：整体提亮一档，枝梢保留一点光。
     --------------------------------------------------------- */
  function resetLight() {
    state.light = { front: 0, lit: 0, done: false, rate: 0, len: 0 };
    state.noteTimes = [];
    state.act = 0;
    for (var i = 0; i < state.tips.length; i++) state.tips[i].g = 0;
  }

  // 一遍主题曲实际要花多久：按原曲的音间距播（空拍也留着），末尾再留 1.2 秒
  function themeLoopSec() {
    if (!theme.data || !theme.data.notes || !theme.data.notes.length) return 0;
    var ns = theme.data.notes;
    return Math.max(0, ns[ns.length - 1].t1 - ns[0].t0) + 1.2;
  }

  /* 光爬多快，跟着"这次要播多久"归一：
     - 有主题曲 / 有曲子：一遍放完正好到顶（按剩余高度分配速度）
     - 只有环境声：固定 16 秒爬满
     - 极短最快 9 秒；极长最慢 12 分钟 */
  function armLightTiming() {
    var Lg = state.light;
    var len = 0;
    if (state.mode === 'listen' && hasTheme()) {
      len = themeLoopSec() || (theme.data && theme.data.duration) || 0;
    } else if (state.audioEl && isFinite(state.audioEl.duration) && state.audioEl.duration > 1) {
      len = state.audioEl.duration;
    }
    if (len > 0) {
      Lg.len = Math.max(9, Math.min(720, len));
      Lg.rate = (1 - Math.min(1, Lg.front)) / Lg.len;
    } else {
      Lg.len = 0;
      Lg.rate = 1 / 16;
    }
  }

  function updateLight(now) {
    var Lg = state.light;
    var last = state._lightAt == null ? now : state._lightAt;
    var sec = Math.min(0.4, (now - last) / 1000);   // 按真实时间走，慢机器上也一样爬
    state._lightAt = now;

    if (state.playing) {
      Lg.front = Math.min(1, Lg.front + sec * (Lg.rate > 0 ? Lg.rate : 1 / 16));
    } else if (!Lg.done) {
      // 没播完就停了：光慢慢退回去，不假装点亮过
      Lg.front = Math.max(0, Lg.front - sec / 6);
    }
    // 活跃度：最近 3.2 秒里落下的音数（5 个就算满）；快起慢落
    var cutAt = now - 3200;
    var nt = state.noteTimes;
    while (nt.length && nt[0] < cutAt) nt.shift();
    var tgtAct = Math.min(1, nt.length / 5);
    var kAct = 1 - Math.exp(-sec / (tgtAct > state.act ? 0.25 : 1.2));
    state.act += (tgtAct - state.act) * kAct;
    if (Lg.done) {
      Lg.lit = Math.min(1, Lg.lit + sec / 1.8);   // 叶面整体提亮一档
      Lg.front = Math.max(Lg.front, 0.55);
    }

    var resid = Lg.done ? 0.26 : 0;
    for (var i = 0; i < state.tips.length; i++) {
      var p = state.tips[i];
      if (p.g == null) p.g = 0;
      if (p.g > resid) p.g = Math.max(resid, p.g - sec / 3.4);
      else if (p.g < resid) p.g = Math.min(resid, p.g + sec / 3);
    }
  }

  // 整体亮度：播放中随 front 升高；播完停在中上；从没播过是 0
  function lightWarm() {
    var Lg = state.light;
    var play = state.playing ? 0.18 + 0.82 * Lg.front : 0;
    return Math.max(play, Lg.lit * 0.72);
  }

  // 这处枝梢在不在"已经亮到的高度"里；冠顶之外只吃当下这一击
  function tipGate(p) {
    var Lg = state.light;
    if (!state.playing && !Lg.done) return 0;
    var box = state.box || { y0: 0, y1: state.wh };
    var span = Math.max(1, box.y1 - box.y0);
    var rel = 1 - (p.y - box.y0) / span;      // 0 根 → 1 冠顶
    var d = rel - Lg.front;
    if (d < -0.09) return 1;
    if (d > 0.09) return 0.20;
    return 0.20 + 0.80 * (1 - (d + 0.09) / 0.18);
  }

  // 枝梢光斑用一张小图，别每帧造几十个渐变
  var tipSpr = null, tipSprTint = '';
  function tipSprite() {
    if (tipSpr && tipSprTint === state.tint) return tipSpr;
    var pal = PALETTE[state.tint];
    var s = 64;
    var c = document.createElement('canvas');
    c.width = c.height = s;
    var g = c.getContext('2d');
    var rg = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    rg.addColorStop(0, 'rgba(' + pal.coreTop.join(',') + ',1)');
    rg.addColorStop(0.28, 'rgba(' + pal.dot2.join(',') + ',0.5)');
    rg.addColorStop(1, 'rgba(' + pal.dot2.join(',') + ',0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, s, s);
    tipSpr = c;
    tipSprTint = state.tint;
    return c;
  }

  function startDemo() {
    stopDemo();
    var i = 0;
    var roots = [0, 0, 5, 3];
    var tick = function () {
      if (!state.playing || state.mode !== 'grow' || state.usingFile) return;
      var t = AC.currentTime + 0.02;
      kick(t);
      if (i % 4 === 0) {
        var r = BASE * Math.pow(2, roots[(i / 4) % 4] / 12);
        [0, 7, 12, 16].forEach(function (d, k) {
          pluck(r * Math.pow(2, d / 12), t + k * 0.07, 0.055);
        });
      }
      i++;
      demoTimer = setTimeout(tick, 520);
    };
    tick();
  }

  function stopDemo() {
    if (demoTimer) { clearTimeout(demoTimer); demoTimer = null; }
  }

  function attachAudioFile(file) {
    ensureAudio();
    if (!state.audioEl) {
      var el = new Audio();
      el.loop = true;
      state.audioEl = el;
      mediaSrc = AC.createMediaElementSource(el);
      mediaSrc.connect(master);
    }
    if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
    state.audioUrl = URL.createObjectURL(file);
    state.audioEl.src = state.audioUrl;
    state.usingFile = true;
    state.audioName = file.name.replace(/\.[^.]+$/, '');

    var drop = $('audioDrop');
    drop.textContent = '♪ ' + state.audioName;
    drop.classList.add('loaded');

    if (state.playing) {
      stopDemo();
      state.audioEl.play();
    }
    updateMeta();
  }

  function readEnergy(t) {
    if (!analyser || !state.playing) {
      var idle = 0.34 + 0.18 * Math.sin(t * 0.55) + 0.06 * Math.sin(t * 1.7);
      return { low: idle, mid: idle * 0.9, high: idle * 0.7, total: idle };
    }
    analyser.getByteFrequencyData(freq);
    var band = function (a, b) {
      var s = 0, c = 0, n = freq.length;
      for (var i = a; i < b && i < n; i++) { s += freq[i]; c++; }
      return c ? s / c / 255 : 0;
    };
    var low = band(1, 8), mid = band(8, 44), high = band(44, 130);
    return {
      low: low, mid: mid, high: high,
      total: low * 0.5 + mid * 0.35 + high * 0.15
    };
  }

  /* =========================================================
     6. 渲染
     ========================================================= */

  var bgCache = null;

  function bakeBg() {
    bgCache = document.createElement('canvas');
    bgCache.width = Math.max(1, Math.floor(W));
    bgCache.height = Math.max(1, Math.floor(H));
    var g = bgCache.getContext('2d');
    var pal = PALETTE[state.tint];
    var day = state.tint === 'day';

    g.fillStyle = 'rgb(' + pal.bg0.join(',') + ')';
    g.fillRect(0, 0, bgCache.width, bgCache.height);

    var cx = bgCache.width * 0.5, cy = bgCache.height * (day ? 0.42 : 0.58);
    var rad = Math.max(bgCache.width, bgCache.height) * 0.78;
    var rg = g.createRadialGradient(cx, cy, 0, cx, cy, rad);
    rg.addColorStop(0, 'rgba(' + pal.bg1.join(',') + ',' + (day ? 0.5 : 0.95) + ')');
    rg.addColorStop(0.55, 'rgba(' + pal.bg1.join(',') + ',' + (day ? 0.22 : 0.35) + ')');
    rg.addColorStop(1, 'rgba(' + pal.bg1.join(',') + ',0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, bgCache.width, bgCache.height);

    // 昼色的白瓷不是纯白：加一层从顶部落下的冷灰，画面才有"天光"
    if (day) {
      var lg = g.createLinearGradient(0, 0, 0, bgCache.height);
      lg.addColorStop(0, 'rgba(214,226,214,0.35)');
      lg.addColorStop(0.5, 'rgba(0,0,0,0)');
      lg.addColorStop(1, 'rgba(118,140,112,0.16)');
      g.fillStyle = lg;
      g.fillRect(0, 0, bgCache.width, bgCache.height);
    }
  }

  // 树画到一张自己的画布上，再按亮度/高度分段贴回来
  var treePlateCvs = null;
  function treePlate(w, h) {
    if (!treePlateCvs) treePlateCvs = document.createElement('canvas');
    if (treePlateCvs.width !== w || treePlateCvs.height !== h) {
      treePlateCvs.width = w;
      treePlateCvs.height = h;
    }
    return treePlateCvs;
  }

  var treeMaskCvs = null;
  function treeMask(w, h) {
    if (!treeMaskCvs) treeMaskCvs = document.createElement('canvas');
    if (treeMaskCvs.width !== w || treeMaskCvs.height !== h) {
      treeMaskCvs.width = w;
      treeMaskCvs.height = h;
    }
    return treeMaskCvs;
  }

  /* 光点层按高度切片：front 以下显影，交界上柔一下。
     直接整张画的话，未播放/刚开播时满树金点会同时亮起来。 */
  function drawDotsWipe(img, alpha, T) {
    if (!img || alpha <= 0.004) return;
    var S = 14;
    var y0 = T.ty, hgt = T.th;
    var frontY = y0 + hgt * (1 - state.light.front);
    var band = Math.max(6, hgt * 0.12);
    var sh = img.height / S;
    for (var i = 0; i < S; i++) {
      var py = y0 + (i / S) * hgt;
      var mid = py + hgt / S / 2;
      var d = mid - frontY;                       // > 0：在光带下方（已经亮到）
      var k = d <= 0 ? 0.12 : (d >= band ? 1 : 0.12 + 0.88 * (d / band));
      ctx.globalAlpha = alpha * k;
      ctx.drawImage(img, 0, i * sh, img.width, sh, T.tx, py, T.tw, hgt / S + 0.7);
    }
    ctx.globalAlpha = 1;
  }

  /* =========================================================
     6.6 生长演出：全屏舞台，一棵树跟着音乐从种子长出来
     ---------------------------------------------------------
     三段：seed（种子）→ grow（沿枝生长 + 音符点亮）→ bloom（定格 + 歌名）。
     生长用 TreeArt.paintGrowth 逐段揭示同一张烘焙画，笔尖跟到哪、光点到哪。
     ========================================================= */
  var SHOW_T = { seed: 1700, grow: 15000, bloom: 2600 };

  function showNotes() {
    // 演出用一组固定、走完整个生长阶段的音符：有主题曲就用它的旋律铺开，
    // 否则用当前树的谱子。返回 [{at(ms), hz, rel}]，rel 决定点亮哪根枝。
    var out = [];
    var eng = currentEngine();
    if (hasTheme() && theme.data && theme.data.notes && theme.data.notes.length) {
      var ns = theme.data.notes;
      var span = SHOW_T.grow - 600;
      for (var i = 0; i < ns.length; i++) {
        out.push({
          at: SHOW_T.seed + 200 + (i / ns.length) * span,
          hz: ns[i].hz || eng.base * Math.pow(2, (ns[i].midiQ || 60) / 12),
          rel: ns[i].rel != null ? ns[i].rel : (i % 9) / 9
        });
      }
    } else {
      var s = ensureScore();
      var t = 0, i2 = 0, span2 = SHOW_T.grow - 600;
      while (t < span2 && out.length < 90) {
        var idx = s.notes[i2 % s.notes.length];
        var deg = eng.scale[Math.min(eng.scale.length - 1, idx)];
        out.push({
          at: SHOW_T.seed + 200 + t,
          hz: eng.base * Math.pow(2, deg / 12),
          rel: Math.min(0.98, idx / Math.max(1, eng.scale.length - 1))
        });
        t += Math.max(130, s.gaps[i2 % s.gaps.length]);
        i2++;
      }
    }
    return out;
  }

  function startShow() {
    if (!state.art || !state.art.growth) {
      notice('先放一棵树进来，再让它生长');
      return;
    }
    ensureAudio();
    if (AC.state === 'suspended') AC.resume();
    // 若在正常播放，先停下它的音，避免两套音符打架
    if (state.playing) pause();

    var AIR = window.TreeArt;
    state.show = {
      active: true,
      t0: performance.now(),
      phase: 'seed',
      grow: AIR.makeGrow(state.art),
      notes: showNotes(),
      noteIdx: 0,
      name: state.treeName || (hasTheme() ? theme.data.name : '') || '',
      kind: currentEngine().name.split(' · ')[0]
    };
    document.body.classList.add('showing');
    $('showLayer').hidden = false;
    $('showCurtain').className = 'show-curtain in';
    $('showSub').textContent = '';
    $('showTitle').textContent = state.treeName || '一棵树';
    startDrone();
  }

  function replayShow() {
    if (!state.show) return;
    var AIR = window.TreeArt;
    state.show.t0 = performance.now();
    state.show.phase = 'seed';
    state.show.grow = AIR.makeGrow(state.art);
    state.show.noteIdx = 0;
    state.flashes.length = 0;
    $('showCurtain').className = 'show-curtain in';
    $('showEnd').hidden = true;
    if (AC.state === 'suspended') AC.resume();
    startDrone();
  }

  function endShow() {
    if (!state.show) return;
    state.show.active = false;
    state.show = null;
    stopDrone();
    stopNotes();
    state.flashes.length = 0;
    document.body.classList.remove('showing');
    $('showLayer').hidden = true;
    $('showEnd').hidden = true;
  }

  function drawShow(now) {
    var sh = state.show;
    if (!sh || !sh.active) return;
    // manualEl 只给自动化验证钉住某一帧用；正常演出为 null
    var el = (sh.manualEl != null) ? sh.manualEl : (now - sh.t0);
    var t = now * 0.001;
    ctx.clearRect(0, 0, W, H);

    // 舞台背景：径向暖光 + 底部光晕，比日常画面更暗、更聚焦
    var pal = PALETTE[state.tint];
    var bg = ctx.createRadialGradient(W / 2, H * 0.52, 0, W / 2, H * 0.52, Math.max(W, H) * 0.72);
    bg.addColorStop(0, 'rgb(' + pal.bg1.join(',') + ')');
    bg.addColorStop(1, 'rgb(' + pal.bg0.join(',') + ')');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    var L = state.layers, T0 = state.transform, AIR = window.TreeArt;
    var artOn = !!(state.art && AIR && state.art.growth);
    // 演出专用布局：比日常更大、垂直居中偏上，底部给展签留白
    var T = T0;
    if (artOn) {
      var availH = H * 0.66, availW = W * 0.72;
      var sc = Math.min(availW / state.art.w, availH / state.art.h);
      var tW = state.art.w * sc, tH = state.art.h * sc;
      T = { tx: (W - tW) / 2, ty: H * 0.10, tw: tW, th: tH };
    }
    var arS = artOn ? T.tw / state.art.w : 1;

    // 阶段判定
    var phase = 'seed', gp = 0;
    if (el < SHOW_T.seed) {
      phase = 'seed';
    } else if (el < SHOW_T.seed + SHOW_T.grow) {
      phase = 'grow';
      gp = (el - SHOW_T.seed) / SHOW_T.grow;
      gp = Math.max(0, Math.min(1, gp));
    } else {
      phase = 'bloom';
      gp = 1;
    }
    if (phase !== sh.phase) {
      sh.phase = phase;
      if (phase === 'grow') $('showCurtain').className = 'show-curtain out';
      if (phase === 'bloom') {
        $('showTitle').textContent = sh.name || '这棵树';
        $('showSub').textContent = sh.kind ? '由《' + (sh.name || '一首歌') + '》长成 · ' + sh.kind : '由一首歌长成';
        $('showEnd').hidden = false;
      }
    }

    // 音符落下：按时间推进，点亮正在生长的那一段（有生长时才响，避免空响）
    if (phase === 'grow') {
      while (sh.noteIdx < sh.notes.length && sh.notes[sh.noteIdx].at <= el - SHOW_T.seed) {
        var n = sh.notes[sh.noteIdx++];
        try { noteVoice(n.hz, AC.currentTime + 0.01, 0.085); } catch (e) {}
        var tip = tipForRel(n.rel);
        if (tip) lightTip(tip, 1.05);
      }
    }

    // 种子阶段：一团呼吸的光点，落在树根要长出来的地方
    if (phase === 'seed') {
      var bx = T ? T.tx + T.tw / 2 : W / 2;
      var by = T ? T.ty + T.th : H * 0.82;
      var pulse = 0.5 + 0.5 * Math.sin(t * 4.2);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      var sg = ctx.createRadialGradient(bx, by, 0, bx, by, 26 + pulse * 10);
      sg.addColorStop(0, 'rgba(' + pal.coreTop.join(',') + ',0.95)');
      sg.addColorStop(0.3, 'rgba(' + pal.dot.join(',') + ',0.5)');
      sg.addColorStop(1, 'rgba(' + pal.dot.join(',') + ',0)');
      ctx.fillStyle = sg;
      ctx.beginPath(); ctx.arc(bx, by, 36 + pulse * 12, 0, 6.2832); ctx.fill();
      ctx.restore();
      $('showPbar').style.width = '0%';
      return;
    }

    // 树：逐段揭示 + 根下光影；返回当前笔尖（art 局部坐标）
    var tipPos = null;
    if (artOn) {
      if (AIR.ground) AIR.ground(ctx, W, H, T.ty + T.th * (state.art.base.y / state.art.h), state.tint);
      var dayShow = state.tint === 'day';
      var glowRGB = state.tint === 'ink' ? '255,238,150' : (dayShow ? '120,152,94' : '255,206,126');
      tipPos = AIR.paintGrowth(ctx, state.art, gp, {
        x: T.tx, y: T.ty, scale: arS, air: { wind: 0.45, rain: 0, fog: 0 },
        now: now, tint: state.tint, shadow: true, soil: true, still: true,
        glow: true, glowColor: 'rgba(' + glowRGB + ',0.34)',
        addMode: dayShow ? 'source-over' : 'lighter', glowAlpha: dayShow ? 0.30 : 0.62
      }, sh.grow);
    }

    // 笔尖光：当前正在抽出的枝上，一盏暖光跟着爬
    if (phase === 'grow' && tipPos) {
      var tx2 = T.tx + tipPos.x * arS, ty2 = T.ty + tipPos.y * arS;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      var tg = ctx.createRadialGradient(tx2, ty2, 0, tx2, ty2, 30 * arS + 8);
      tg.addColorStop(0, 'rgba(' + pal.coreTop.join(',') + ',0.98)');
      tg.addColorStop(0.28, 'rgba(' + pal.dot.join(',') + ',0.62)');
      tg.addColorStop(1, 'rgba(' + pal.dot.join(',') + ',0)');
      ctx.fillStyle = tg;
      ctx.beginPath(); ctx.arc(tx2, ty2, 30 * arS + 8, 0, 6.2832); ctx.fill();
      ctx.restore();
    }

    // 枝梢点亮：复用 flashes（音符落下时 lightTip 加进去的）
    if (state.flashes.length && T) {
      var pal2 = PALETTE[state.tint];
      var sx = T.tw / state.ww;
      var ADD2 = state.tint === 'day' ? 'source-over' : 'lighter';
      ctx.save();
      for (var fi = state.flashes.length - 1; fi >= 0; fi--) {
        var f = state.flashes[fi];
        var age = Math.max(0, (now - f.born) / f.dur);
        if (age >= 1) { state.flashes.splice(fi, 1); continue; }
        var a = Math.pow(1 - age, 0.7) * (f.boost || 1);
        var px = T.tx + f.x * sx, py = T.ty + f.y * sx;
        ctx.globalCompositeOperation = ADD2;
        ctx.strokeStyle = 'rgba(' + pal2.coreTop.join(',') + ',' + (a * 0.7).toFixed(3) + ')';
        ctx.lineWidth = Math.max(1.2, 2.2 * sx);
        var rr = (3 + 18 * age) * sx;
        ctx.beginPath(); ctx.arc(px, py, rr, 0, 6.2832); ctx.stroke();
      }
      ctx.restore();
      ctx.globalCompositeOperation = 'source-over';
    }

    // 生长进度条
    $('showPbar').style.width = Math.round(gp * 100) + '%';
  }

  function draw(now) {
    requestAnimationFrame(draw);
    if (state.show && state.show.active) { drawShow(now); return; }

    var t = now * 0.001;
    var e = readEnergy(t);
    var day = state.tint === 'day';
    // 加色发光只在深底上成立；昼色改用普通叠色 + 多层透明度
    var ADD = day ? 'source-over' : 'lighter';
    var AIR = window.TreeArt;

    // 天气三档的过渡：约 0.4s，和样张一致
    if (!state._lastDraw) state._lastDraw = now;
    var dt = Math.min(64, now - state._lastDraw);
    state._lastDraw = now;
    updateLight(now);
    var wk = 1 - Math.exp(-dt / 420);
    var A = state.air;
    A.wind += ((state.weather === 'wind' ? 1 : 0) - A.wind) * wk;
    A.rain += ((state.weather === 'rain' ? 1 : 0) - A.rain) * wk;
    A.fog += ((state.weather === 'fog' ? 1 : 0) - A.fog) * wk;

    ctx.clearRect(0, 0, W, H);
    if (bgCache) ctx.drawImage(bgCache, 0, 0, W, H);
    // 雨：整幅先压深一点，树再压上去
    if (A.rain > 0.01) {
      ctx.fillStyle = 'rgba(74,82,64,' + (0.13 * A.rain).toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
    }

    if (state.waterOn) drawWater(t);
    if (state.motes.length) drawMotes(t, e);

    var L = state.layers;
    var T = state.transform;
    if (!L || !L.sil || !T || !T.tw) { drawBursts(); return; }

    // 背景 A 的全宽版：地平线一线暖灰 + 根下一小片亮
    var artOn = !!(state.art && AIR);
    var photoArt = artOn && state.art.mode === 'photo';
    var artH = artOn ? state.art.h : state.wh;
    var artBaseY = T.ty + T.th * (artOn ? (state.art.base.y / artH) : 0.96);
    if (artOn) AIR.ground(ctx, W, H, artBaseY, state.tint);

    var breathe = 1 + e.low * 0.012;

    ctx.save();
    ctx.translate(T.tx + T.tw / 2, T.ty + T.th);
    ctx.scale(breathe, breathe);
    ctx.translate(-(T.tx + T.tw / 2), -(T.ty + T.th));

    // 树：程序树与照片树都走定稿的 2D 画法；只有烘焙失败时才退回剪影
    if (artOn) {
      // 未播放时整棵树压暗；播放中按 front 的高度逐条显影，光才像从根部爬到冠顶
      var baseA = day ? 0.78 : 0.46;
      var playAdd = state.playing ? (1 - baseA) * (0.18 + 0.82 * state.light.front) : 0;
      var doneAdd = state.light.done ? (1 - baseA) * 0.72 : 0;
      var plate = treePlate(state.art.w, state.art.h);
      var pg = plate.getContext('2d');
      pg.clearRect(0, 0, plate.width, plate.height);
      AIR.paint(pg, state.art, { x: 0, y: 0, scale: 1, now: now, air: A, tint: state.tint });

      // 高度遮罩用一张渐变做 destination-in：切片会有横条，渐变不会
      var arS = T.tw / state.art.w;
      var arH = state.art.h * arS;
      var A0 = baseA + doneAdd;
      var A1 = A0 + playAdd;
      var lo = A1 > 0 ? (A0 + 0.10 * playAdd) / A1 : 1;
      var mp = treeMask(plate.width, plate.height);
      var mg = mp.getContext('2d');
      mg.clearRect(0, 0, mp.width, mp.height);
      mg.drawImage(plate, 0, 0);
      mg.globalCompositeOperation = 'destination-in';
      var yF = Math.max(0, Math.min(1, 1 - state.light.front));
      var bF = Math.min(1, yF + 0.12);
      var vg = mg.createLinearGradient(0, 0, 0, mp.height);
      vg.addColorStop(0, 'rgba(0,0,0,' + lo.toFixed(3) + ')');
      vg.addColorStop(yF, 'rgba(0,0,0,' + lo.toFixed(3) + ')');
      vg.addColorStop(bF, 'rgba(0,0,0,1)');
      vg.addColorStop(1, 'rgba(0,0,0,1)');
      mg.fillStyle = vg;
      mg.fillRect(0, 0, mp.width, mp.height);
      mg.globalCompositeOperation = 'source-over';

      ctx.globalAlpha = Math.min(1, A1);
      ctx.drawImage(mp, T.tx, T.ty, T.tw, arH);
      ctx.globalAlpha = 1;
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = day ? 0.94 : 0.9;
      ctx.drawImage(L.sil, T.tx, T.ty, T.tw, T.th);
    }

    var warm = lightWarm();
    if (L.glow) {
      // 画法已经自带光与暗；叠光只做"活着"的一层微亮，不盖掉明暗
      // 照片树的叠光会露出旧骨架网的形状，直接关掉；程序树保持定稿亮度
      var kG = artOn ? (photoArt ? 0 : 0.45) : 1;
      var kC = artOn ? (photoArt ? 0 : 0.5) : 1;
      var kD = artOn ? (photoArt ? 0 : 0.5) : 1;
      ctx.globalCompositeOperation = ADD;
      ctx.globalAlpha = (day ? 0.02 + warm * 0.10 : 0.02 + warm * 0.26) * kG;
      ctx.drawImage(L.glow, T.tx, T.ty, T.tw, T.th);

      ctx.globalAlpha = (day ? 0.03 + warm * 0.14 : 0.03 + warm * 0.34) * kC;
      ctx.drawImage(L.core, T.tx, T.ty, T.tw, T.th);

      // 光点层：高度门限照旧；整体浓度由最近音符的密度 act 决定，留一层不死光的底
      drawDotsWipe(L.dots, (day ? 0.03 + warm * (0.02 + 0.24 * state.act * state.act) : 0.02 + warm * (0.02 + 0.50 * state.act * state.act)) * kD, T);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }

    // 枝梢：鸣响处亮、留余晖；光爬到的高度以上只有被敲到才亮
    if (state.tips.length) {
      var spr = tipSprite();
      var tSx = T.tw / state.ww;
      var idleA = (!state.playing && !state.light.done) ? 0.075 : 0;
      var dotCol = 'rgb(' + PALETTE[state.tint].coreTop.join(',') + ')';
      var nowD = now || performance.now();
      ctx.globalCompositeOperation = ADD;
      for (var ti = 0; ti < state.tips.length; ti++) {
        var tp = state.tips[ti];
        var tg = tp.g || 0;
        var g2 = tipGate(tp);
        var tpx = T.tx + tp.x * tSx;
        var tpy = T.ty + tp.y * tSx;

        var a = idleA + tg * g2 * 0.88;
        if (a >= 0.012) {
          var tr = (8 + 25 * tg) * tSx;
          ctx.globalAlpha = Math.min(1, a);
          ctx.drawImage(spr, tpx - tr, tpy - tr, tr * 2, tr * 2);
        }

        // 光点：这一根枝梢自己亮的时候才出现，连点就是一下一下地跳
        if (state.playing && tg > 0.02 && g2 > 0) {
          var pop = Math.max(0, 1 - (nowD - (tp.hitAt || -1e9)) / 240);
          ctx.globalAlpha = Math.min(1, (0.22 + 0.78 * tg) * g2 * (0.25 + 0.75 * state.act));
          ctx.fillStyle = dotCol;
          ctx.beginPath();
          ctx.arc(tpx, tpy, (3.6 + 3.6 * pop) * tSx, 0, 6.2832);
          ctx.fill();
        }
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }

    // 照片树的叶已经在烘焙里画好；再撒一层小叶片只会变成碎点与网纹
    if (!photoArt && state.leavesOn && state.leaves.length) drawLeaves(t, e);

    // 枝梢的点亮：环形扩散 + 该枝梢往根部的一小段枝条提亮
    if (state.flashes.length) {
      var pal = PALETTE[state.tint];
      var sx = T.tw / state.ww;
      var nowMs = now || performance.now();
      // 夜金/夜蓝用加色发光；昼绿改用深绿环 + 亮绿枝条，不靠加色
      var ringRGB = day ? pal.leafDark : pal.coreTop;
      var branchRGB = day ? pal.leafLight : pal.coreTop;

      for (var i = state.flashes.length - 1; i >= 0; i--) {
        var f = state.flashes[i];
        // rAF 的时间戳可能比刚触发的 born 早一两帧：夹住，别让半径算成负数
        var age = Math.max(0, (nowMs - f.born) / f.dur);
        if (age >= 1) { state.flashes.splice(i, 1); continue; }

        // 先亮着、后段再淡：全程都看得见，但 0.48–0.64s 内一定散尽
        var a = Math.pow(1 - age, 0.65) * (f.boost || 1);
        var px = T.tx + f.x * sx;
        var py = T.ty + f.y * sx;

        // 枝条：从枝梢往根部，越靠根越淡、越细
        if (f.path && f.path.length > 1) {
          ctx.globalCompositeOperation = day ? 'source-over' : ADD;
          ctx.globalAlpha = 1;
          ctx.lineCap = 'round';
          for (var pass = 0; pass < 2; pass++) {
            for (var k = 0; k < f.path.length - 1; k++) {
              var q = k / (f.path.length - 1);
              var taper = 1 - q * 0.85;
              var alpha = pass === 0 ? a * 0.30 * taper : a * 0.88 * taper;
              if (alpha <= 0.006) continue;
              ctx.strokeStyle = 'rgba(' + branchRGB.join(',') + ',' + alpha.toFixed(3) + ')';
              ctx.lineWidth = pass === 0
                ? Math.max(2.5, 8.5 * sx * (1 - q * 0.45))
                : Math.max(1.2, 3.4 * sx * (1 - q * 0.5));
              ctx.beginPath();
              ctx.moveTo(T.tx + f.path[k].x * sx, T.ty + f.path[k].y * sx);
              ctx.lineTo(T.tx + f.path[k + 1].x * sx, T.ty + f.path[k + 1].y * sx);
              ctx.stroke();
            }
          }
        }

        // 环：半径从枝梢向外扩，0.48–0.64s 内淡尽
        var r = (5 + 26 * age) * sx * 1.35;
        ctx.globalCompositeOperation = day ? 'source-over' : ADD;
        ctx.globalAlpha = 1;
        ctx.strokeStyle = 'rgba(' + ringRGB.join(',') + ',' + (a * 0.30).toFixed(3) + ')';
        ctx.lineWidth = Math.max(3.2, 7.5 * sx);
        ctx.beginPath();
        ctx.arc(px, py, r, 0, 6.2832);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(' + ringRGB.join(',') + ',' + (a * 0.95).toFixed(3) + ')';
        ctx.lineWidth = Math.max(1.4, 2.3 * sx);
        ctx.beginPath();
        ctx.arc(px, py, r, 0, 6.2832);
        ctx.stroke();

        // 中心点：环扩出去以后，仍然知道是哪根枝梢
        ctx.fillStyle = 'rgba(' + ringRGB.join(',') + ',' + (a * 0.9).toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(px, py, Math.max(1.6, 3.2 * sx), 0, 6.2832);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }

    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    // 空气：雨丝与雾在屏幕空间里铺满整幅，不局限在树的画框
    if (AIR) {
      if (A.rain > 0.01) AIR.rain(ctx, W, H, now, A.rain);
      if (A.fog > 0.01) AIR.fog(ctx, W, H, A.fog, artBaseY);
    }

    drawBursts();

    // 主题转场：旧画面压在上面淡出，比"闪一下换掉"柔和
    if (state.transition) {
      var tr = state.transition;
      var k = (now - tr.t0) / 620;
      if (k >= 1) { state.transition = null; }
      else {
        ctx.globalAlpha = 1 - k;
        ctx.drawImage(tr.snap, 0, 0, W, H);
        ctx.globalAlpha = 1;
      }
    }
  }

  /* =========================================================
     7. 文字
     ========================================================= */

  function updateMeta() {
    var now = new Date();
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    var m = now.getMonth() + 1;
    var season = m >= 3 && m <= 5 ? 'spring' : m >= 6 && m <= 8 ? 'summer'
      : m >= 9 && m <= 11 ? 'late autumn' : 'winter';

    var engName = currentEngine().name;
    var label = state.usingFile ? state.audioName
      : (state.mode === 'listen' ? engName : 'demo loop');

    var lines = [
      '{',
      '  "tree"     : "no.' + pad((state.tips.length * 7) % 997) + '",',
      '  "form"     : "' + state.species + ' / ' + state.seed + '",',
      '  "shot"     : "' + now.getFullYear() + '-' + pad(m) + '-' + pad(now.getDate()) + '",',
      '  "skeleton" : ' + state.skel.length + ',',
      '  "tips"     : ' + state.tips.length + ',',
      '  "leaves"   : ' + state.leaves.length + ',',
      '  "season"   : "' + season + '",',
      '  "kind"     : "' + (state.generated ? 'generated' : 'photographed') + '",',
      '  "sound"    : "' + label + '"',
      '}',
      '',
      '// ' + (state.mode === 'listen'
        ? '「' + engName + '」· ' + currentEngine().mood
        : '这首歌正在把叶子一片片点亮')
    ];
    $('meta').textContent = lines.join('\n');
  }

  /* =========================================================
     7.5 读树：文字参与构图
     树上的三个注记点跟着树的变换走，不是钉死在屏幕上。
     ========================================================= */

  /* 读树：文字由这棵树的实测数据生成，不用通用文案。
     只用真的量：枝梢数、冠幅/树高、枝梢在三条高度带上的分布、实际音域、剪影占比。 */
  function treeFacts() {
    var tips = state.tips || [];
    var box = state.box || null;
    var f = { n: tips.length, crown: 0, band: 1, bandPct: 0, low: 0, high: 0, silPct: 0 };

    if (!tips.length) return f;

    var x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (var i = 0; i < tips.length; i++) {
      var p = tips[i];
      if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
    }
    var w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
    f.crown = w / h;

    // 三条高度带里，枝梢集中在哪一段
    var bands = [0, 0, 0];
    for (var j = 0; j < tips.length; j++) {
      var frac = (tips[j].y - y0) / h;
      var bi = Math.max(0, Math.min(2, Math.floor(frac * 3)));
      bands[bi]++;
    }
    var best = 0;
    for (var k = 1; k < 3; k++) if (bands[k] > bands[best]) best = k;
    f.band = best;
    f.bandPct = Math.round(bands[best] / tips.length * 100);

    // 实际音域：与 scheduleNote 用同一套换算
    var b = box && box.y1 > box.y0 ? box : { y0: y0, y1: y1 };
    var span = Math.max(1, b.y1 - b.y0);
    var lo = 99, hi = -1;
    for (var m = 0; m < tips.length; m++) {
      var rel = 1 - Math.max(0, Math.min(1, (tips[m].y - b.y0) / span));
      var d = Math.min(PENTA.length - 1, Math.floor(rel * PENTA.length));
      if (d < lo) lo = d;
      if (d > hi) hi = d;
    }
    f.low = Math.round(BASE * Math.pow(2, PENTA[lo] / 12));
    f.high = Math.round(BASE * Math.pow(2, PENTA[hi] / 12));

    if (box && state.ww && state.wh) {
      f.silPct = Math.round(((box.x1 - box.x0) * (box.y1 - box.y0)) / (state.ww * state.wh) * 100);
    }
    return f;
  }

  function seasonNow() {
    var m = new Date().getMonth() + 1;
    if (m >= 3 && m <= 5) return '新叶正在展开';
    if (m >= 6 && m <= 8) return '叶子最厚的时候';
    if (m >= 9 && m <= 11) return '正在落叶';
    return '枝干最清楚的时候';
  }

  function readingFor(sys) {
    var f = treeFacts();
    if (f.n < 6) {
      return {
        text: '这一张里没读出几根枝条。把「剪影阈值」往右拉一点，或者换一张逆光的照片。',
        formula: 'NO BRANCHES YET'
      };
    }
    var bandName = ['上三分之一', '中间三分之一', '下三分之一'][f.band];
    if (sys === 'signal') {
      return {
        text: f.bandPct + '% 的枝梢集中在树高的' + bandName + '，那里会响得最勤。它们落在 ' +
          f.low + '–' + f.high + ' Hz 之间。',
        formula: f.low + '–' + f.high + ' HZ'
      };
    }
    if (sys === 'climate') {
      // 剪影占比只有照片才有意义（程序树的 box 是整张画布）
      if (state.photoLoaded) {
        return {
          text: '冠幅是树高的 ' + f.crown.toFixed(2) + ' 倍，剪影占了画面的 ' + f.silPct + '%。' +
            '按此刻的时令，' + seasonNow() + '——树冠越开，接住的光和雨越多。',
          formula: f.crown.toFixed(2) + '× CROWN · ' + f.silPct + '% FRAME'
        };
      }
      var sf = state.songShapeParams;
      return {
        text: '冠幅是树高的 ' + f.crown.toFixed(2) + ' 倍。' +
          (sf ? '这棵树是那首歌长成的：音域跨了 ' + sf.span + ' 个半音，旋律起伏 ' + sf.motion +
            '——起伏越大，枝张开得越开。' : '按此刻的时令，' + seasonNow() + '——树冠越开，接住的光和雨越多。'),
        formula: sf ? ('SONG ' + sf.span + ' SEMI → ' + f.crown.toFixed(2) + '× CROWN')
                    : (f.crown.toFixed(2) + '× CROWN')
      };
    }
    return {
      text: '这棵树有 ' + f.n + ' 个枝梢，冠幅是树高的 ' + f.crown.toFixed(2) + ' 倍。' +
        f.n + ' 个枝梢，就是 ' + f.n + ' 个音：越靠上，越亮。',
      formula: f.n + ' TIPS → ' + f.n + ' NOTES'
    };
  }

  // 注记点在树空间里的相对位置（0~1），跟着变换走
  var HOTSPOT_POS = {
    energy: { x: 0.62, y: 0.30 },
    signal: { x: 0.34, y: 0.52 },
    climate: { x: 0.58, y: 0.82 }
  };

  function setFocusSystem(sys) {
    state.focusSystem = sys;
    var r = readingFor(sys);
    if (!r) return;
    var txt = $('readingText');
    txt.classList.add('swap');
    setTimeout(function () {
      txt.textContent = r.text;
      $('readingFormula').textContent = r.formula;
      txt.classList.remove('swap');
    }, 160);
    document.querySelectorAll('.reading-tabs button').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-system') === sys);
    });
    document.querySelectorAll('.tree-hotspot').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-system') === sys);
    });
  }

  function layoutHotspots() {
    var T = state.transform;
    if (!T || !T.tw) return;
    document.querySelectorAll('.tree-hotspot').forEach(function (b) {
      var p = HOTSPOT_POS[b.getAttribute('data-system')];
      if (!p) return;
      b.style.left = (T.tx + T.tw * p.x) + 'px';
      b.style.top = (T.ty + T.th * p.y) + 'px';
    });
  }

  /* =========================================================
     8. 交互
     ========================================================= */

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    stage.width = Math.floor(W * DPR);
    stage.height = Math.floor(H * DPR);
    stage.style.width = W + 'px';
    stage.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.imageSmoothingQuality = 'high';
    bakeBg();
    state.transform = computeTransform();
  }

  function snapshotStage() {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.floor(W));
    c.height = Math.max(1, Math.floor(H));
    try {
      c.getContext('2d').drawImage(stage, 0, 0, c.width, c.height);
      return c;
    } catch (e) { return null; }
  }

  function setTint(tint) {
    if (tint === state.tint) return;
    var snap = snapshotStage();
    if (snap) state.transition = { snap: snap, t0: performance.now() };

    state.tint = tint;
    document.body.setAttribute('data-tint', tint);
    bakeBg();
    buildMotes();
    // 种子不变，换主题不换树
    if (state.generated) { generateTree(); }
    else if (state.pixels) { rebuild(true); }
    updateMeta();
  }

  var SPECIES_NAME = {
    oak: '乔木', ginkgo: '银杏', bush: '灌木', willow: '垂柳',
    palm: '棕榈', conifer: '针叶', banyan: '榕树', blossom: '花树', gum: '桉树'
  };

  function setSpecies(sp) {
    if (sp === state.species) return;
    // 照片树是这棵树的身份，换形态会静默丢掉它——先拦住
    if (state.photoLoaded) { notice('这棵树来自照片 · 换形态会丢掉它，先「换一张」'); return; }
    var snap = snapshotStage();
    if (snap) state.transition = { snap: snap, t0: performance.now() };
    state.species = sp;
    state.generated = true;
    generateTree();
    setTitle(displayTitle() ? (SPECIES_NAME[sp] + ' · 种子 ' + state.seed) : '');
    updateMeta();
  }

  function reseed() {
    if (state.photoLoaded) { notice('这棵树来自照片 · 换一棵会丢掉它，先「换一张」'); return; }
    var snap = snapshotStage();
    if (snap) state.transition = { snap: snap, t0: performance.now() };
    state.seed = (state.seed * 1664525 + 1013904223) % 100000;
    state.generated = true;
    generateTree();
    setTitle(displayTitle() ? (SPECIES_NAME[state.species] + ' · 种子 ' + state.seed) : '');
    updateMeta();
  }

  function syncModeUI() {
    var btn = $('growToggle');
    if (!btn) return;
    var grow = state.mode === 'grow';
    btn.classList.toggle('on', grow);
    btn.setAttribute('aria-pressed', grow ? 'true' : 'false');
    btn.textContent = grow ? '听树（关掉歌）' : '跟歌亮一下';
  }

  /* =========================================================
     4.6 地点 / 记忆 / 档位 的界面同步
     ========================================================= */
  // 曲风按钮：高亮当前引擎，并把这句意象写在旁边
  function syncEngineUI() {
    var seg = $('engineSeg');
    if (!seg) return;
    seg.querySelectorAll('[data-engine]').forEach(function (b) {
      var on = b.getAttribute('data-engine') === state.engine;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    if ($('engineMood')) $('engineMood').textContent = currentEngine().mood;
  }

  function syncControls() {
    var dots = document.querySelectorAll('.tint-dots [data-tint]');
    for (var i = 0; i < dots.length; i++) {
      var on = dots[i].getAttribute('data-tint') === state.tint;
      dots[i].classList.toggle('on', on);
      dots[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    var sps = document.querySelectorAll('[data-species]');
    for (var j = 0; j < sps.length; j++) {
      sps[j].classList.toggle('on', sps[j].getAttribute('data-species') === state.species);
    }
    syncEngineUI();
    var pw = $('playWord');
    if (pw) pw.textContent = state.playing ? '停止' : '开始听';
    if ($('memBtn')) $('memBtn').hidden = !(state.memories && state.memories.length);
    updateTierUI();
    updateThrUI();
  }

  // 档位：这个地点来过几次 → 第几档（最多六档，只改大小）
  function updateTierUI() {
    var el = $('tierState');
    if (!el) return;
    var p = state.place;
    if (!p || p.key === 'unplaced') {
      el.textContent = '还没有地方 · 放到地球上它才有根';
      return;
    }
    el.textContent = '第 ' + state.tier + ' 档 · 这里来过 ' + (p.n || 1) + ' 次' +
      (state.tier >= 6 ? ' · 已长满' : ' · 每多一张，这棵' + (state.localSpecies || '树') + '更繁一点');
  }

  function placeTitle(p) {
    var info = placeInfoOf(p);
    if (info && info.place) return info.place;
    if (p && p.name) return p.name;
    return '这个地点';
  }

  // 记忆条：这个地点的照片（原图在 IndexedDB 里）
  function renderMemories() {
    var strip = $('memStrip');
    var list = state.memories || [];
    if ($('memCount')) $('memCount').textContent = String(list.length);
    if ($('memRow')) $('memRow').hidden = !list.length;
    if (!strip) return;
    strip.innerHTML = '';
    list.slice(-12).forEach(function (m) {
      var b = document.createElement('button');
      b.className = 'mem-thumb';
      b.type = 'button';
      b.setAttribute('aria-label', (m.date || '') + ' 的照片');
      b.addEventListener('click', function () { openMemory(m); });
      var img = document.createElement('img');
      img.alt = '';
      idbGet(m.id).then(function (blob) {
        if (blob) img.src = URL.createObjectURL(blob);
      }).catch(function () {});
      b.appendChild(img);
      strip.appendChild(b);
    });
  }

  // 树页也要能调出原图
  function openMemory(m) {
    var v = $('memView');
    if (!v) return;
    idbGet(m.id).then(function (blob) {
      if (!blob) { notice('这张原件在这台机器上找不到了'); return; }
      $('memImg').src = URL.createObjectURL(blob);
      $('memMeta').textContent = (m.date || '') + ' · ' + placeTitle(state.place);
      v.hidden = false;
    }).catch(function () { notice('打不开这张原件'); });
  }

  function openLatestMemory() {
    var list = state.memories || [];
    if (!list.length) return;
    openMemory(list[list.length - 1]);
  }

  function setMode(mode) {
    state.mode = mode;
    syncModeUI();
    if (state.playing) {
      stopNotes(); stopDemo(); stopTheme();
      if (mode === 'listen') {
        startDrone();
        if (hasTheme()) startTheme(); else scheduleNote();
        if (state.audioEl) state.audioEl.pause();
      } else {
        stopDrone();
        if (state.usingFile && state.audioEl) state.audioEl.play();
        else startDemo();
      }
    }
    updateMeta();
  }

  function play() {
    ensureAudio();
    if (AC.state === 'suspended') AC.resume();

    state.playing = true;
    armLightTiming();
    document.body.classList.add('playing');
    $('playBtn').classList.add('playing');
    $('playIcon').textContent = '❚❚';
    $('playWord').textContent = '停止';

    if (state.mode === 'listen') {
      startDrone();
      applyTierSound();
      if (hasTheme()) startTheme(); else scheduleNote();
    } else {
      if (state.usingFile && state.audioEl) state.audioEl.play();
      else startDemo();
    }
    updateMeta();
  }

  function pause() {
    state.playing = false;
    // 听过一段时间再停：这棵树算被点着过，停在点亮态
    if (state.light.front > 0.4) state.light.done = true;
    document.body.classList.remove('playing');
    $('playBtn').classList.remove('playing');
    $('playIcon').textContent = '▶';
    $('playWord').textContent = '开始听';

    stopNotes(); stopDemo(); stopDrone(); stopTheme();
    if (state.audioEl) state.audioEl.pause();
    updateMeta();
  }

  function togglePlay() {
    if (state.playing) pause(); else play();
  }

  function pickImage(file) {
    if (!file || !/^image\//.test(file.type)) return;
    $('busy').hidden = false;
    $('busyText').textContent = '正在把这张照片放到它的地方';
    $('empty').hidden = true;

    var base = file.name.replace(/\.[^.]+$/, '');
    // EXIF 里是真实数据：有坐标就归到那个地点，没有就先用"现在所在的地方"
    readExif(file, function (ex) {
      ex = ex || {};
      if (ex.desc && !state.treeName) state.treeName = ex.desc;
      if (!ex.desc && ex.descRaw) notice('这张照片有说明字段但解不出来 · ' + ex.descRaw);
      if (ex.lat != null && ex.lon != null) {
        addMemory(placeAt(ex.lat, ex.lon), file, base);
        return;
      }
      askHere(function (here) {
        addMemory(here ? placeAt(here.lat, here.lon) : unplacedPlace(), file, base);
      });
    });
  }

  // 拿不到 EXIF 坐标时，用当前所在地当这张照片的地方；失败就记成"未定位"
  function askHere(cb) {
    if (!navigator.geolocation) { cb(null); return; }
    var done = false;
    var timer = setTimeout(function () { if (!done) { done = true; cb(null); } }, 4200);
    try {
      navigator.geolocation.getCurrentPosition(function (p) {
        if (done) return; done = true; clearTimeout(timer);
        cb({ lat: p.coords.latitude, lon: p.coords.longitude });
      }, function () {
        if (done) return; done = true; clearTimeout(timer); cb(null);
      }, { timeout: 3800, maximumAge: 0, enableHighAccuracy: true });
    } catch (e) { clearTimeout(timer); cb(null); }
  }

  // 照片退成记忆：存原图、挂到这个地点、把这个地点升一档
  function addMemory(place, file, base) {
    var rec = {
      id: newTreeId(), at: Date.now(), date: todayStr(),
      name: base || '', place: place.key,
      lat: place.lat, lon: place.lon
    };
    // 原图落库之后再刷一次缩略图：不然 idbGet 可能赶在事务提交前
    idbPut(rec.id, file).then(function () { renderMemories(); }).catch(function () {});
    var p = bumpPlace(place, rec);
    $('busy').hidden = true;
    applyPlace(p, rec);
    notice(place.key === 'unplaced'
      ? '这张照片还没有地方 · 到地球上给它落个点'
      : '第 ' + p.n + ' 次回到这里 · 长到第 ' + Math.min(6, p.n) + ' 档');
  }

  // 地点变了：种子 → 树形不变；照片数 → 档位（只改大小）
  function applyPlace(place, rec) {
    var snap = snapshotStage();
    if (snap) state.transition = { snap: snap, t0: performance.now() };
    state.place = place;
    state.tier = Math.min(6, Math.max(1, place.n || 1));
    state.seed = placeSeed(place);
    var info = placeInfoOf(place);
    // 当地真实树种：先按树种名认原型（榕 / 松 / 椰 / 花树…），认不出再用锚点的粗 form
    var localForm = (window.TreePlaces && info && info.primary)
      ? window.TreePlaces.formFor(info.primary) : null;
    state.species = localForm || (info && info.form) || state.species || 'oak';
    state.localSpecies = info ? info.primary : '';   // 中文树种名，展示用
    // 同一地点照片越多，同一棵树越长越繁（fullness 0..1）；种子不变，身份不变
    state.fullness = Math.max(0, Math.min(1, ((place.n || 1) - 1) / 5));
    state.treeGps = (place && place.lat != null) ? { lat: place.lat, lon: place.lon } : null;
    if (rec) { state.treeId = rec.id; state.photoFileBase = rec.name || ''; }
    // 不再用照片推形状：主路径永远走程序树
    state.photoLoaded = false;
    state.generated = true;
    state.photoLowInfo = false;
    state.memories = (place && place.memories) || [];
    state.treeName = state.treeName || '';
    // 身份定了：曲风也跟着这棵树走（读 localStorage 手选，否则按 seed 分配）
    state.engine = engineKeyForTree();
    try { localStorage.setItem('tree.lastPlace', state.place.key); } catch (e) {}

    generateTree();
    leaveIntro();
    syncControls();
    renderMemories();
    updateTierUI();
    applyTierSound();
    setTitle();
    updateMeta();
    if ($('globeLink')) $('globeLink').hidden = false;
    if (place && place.lat != null) {
      state.weatherSrc = 'auto';
      fetchWeather(place.lat, place.lon);
    } else {
      setWeather('wind');
      if ($('airState')) $('airState').textContent = '未定位 · 微风';
    }
  }

  /* =========================================================
     0.3 当地真实天气（open-meteo，免 key）
     取不到就退回微风，不再让用户选
     ========================================================= */
  var WEATHER_WORD = { wind: '微风', rain: '小雨', fog: '薄雾' };
  function fetchWeather(lat, lon) {
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat.toFixed(4) +
      '&longitude=' + lon.toFixed(4) + '&current=weather_code,wind_speed_10m,precipitation';
    fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    }).then(function (j) {
      var c = j && j.current;
      if (!c || typeof c.weather_code !== 'number') throw new Error('empty');
      var code = c.weather_code;
      var w = (code >= 45 && code <= 48) ? 'fog'
        : ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95) ? 'rain'
          : 'wind';
      setWeather(w);
      if ($('airState')) {
        $('airState').textContent = '当地 · ' + WEATHER_WORD[w] +
          (c.precipitation > 0 ? ' ' + c.precipitation + 'mm' : '') +
          (c.wind_speed_10m ? ' · ' + Math.round(c.wind_speed_10m) + ' km/h' : '');
      }
    }).catch(function () {
      setWeather('wind');
      if ($('airState')) $('airState').textContent = '当地天气取不到 · 微风';
    });
  }

  function pickAudio(file) {
    if (!file || !/^audio\//.test(file.type)) return;
    attachAudioFile(file);
    if (!state.playing) play();
  }

  /* =========================================================
     5.5 主题曲：上传一首歌 → 旋律线 → 在树上点亮
     ========================================================= */

  function themeKey() {
    return state.treeId ? ('melody:' + state.treeId)
      : ('melody:seed:' + state.seed + ':' + state.species);
  }

  function fmtTime(sec) {
    var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function updateThemeRow() {
    var d = theme.data;
    var el = $('themeState');
    if (!el) return;
    if (d && d.notes && d.notes.length) {
      el.textContent = '♪ ' + d.notes.length + ' 个音';
      el.classList.add('has');
    } else {
      el.textContent = '还没有主题曲';
      el.classList.remove('has');
    }
  }

  function setMelodyStatus(status, hint) {
    var s = $('melodyState');
    if (s) s.textContent = status || '';
    if (hint != null && $('melodyHint')) $('melodyHint').textContent = hint;
  }

  function setMelodyHint(h) {
    if (h != null && $('melodyHint')) $('melodyHint').textContent = h;
  }

  function drawMelody() {
    var canvas = $('melodyCanvas');
    if (!canvas || $('melodyPanel').hidden) return;
    theme.geom = window.Melody.draw(canvas, theme.data, theme.sel);
  }

  function openMelodyPanel(show) {
    var p = $('melodyPanel');
    if (!p) return;
    p.hidden = show === undefined ? !p.hidden : !show;
    if (!p.hidden) drawMelody();
  }

  function hasTheme() {
    return !!(theme.data && theme.data.notes && theme.data.notes.length);
  }

  // 把"这棵树"的键写进地址栏，刷新 / 从地球点回来都还能找回主题曲
  function persistThemeUrl() {
    try {
      var q = new URLSearchParams(location.search);
      q.set('theme', '1');
      if (state.treeId) q.set('id', state.treeId);
      q.set('seed', String(state.seed));
      q.set('species', state.species);
      q.set('tint', state.tint);
      history.replaceState(null, '', location.pathname + '?' + q.toString());
    } catch (e) {}
  }

  function applyTheme(d) {
    theme.data = d;
    theme.sel = null;
    if ($('melodySelBtn')) $('melodySelBtn').hidden = true;
    // 这首歌开始决定这棵树的形状（听歌长树）
    generateTree();
    updateThemeRow();
    drawMelody();
    syncControls();
    if (d && d.notes && d.notes.length) {
      var sf = state.songShapeParams;
      var shapeNote = sf
        ? '这首歌已经长成现在这棵树 · 音域 ' + sf.span + ' 半音、' + sf.density + ' 音/秒 · ' + SPECIES_NAME[state.species]
        : '';
      setMelodyStatus('已存进这棵树 · ' + d.notes.length + ' 个音',
        '《' + (d.name || '主题曲') + '》' + (d.gaps && d.gaps.length ? '，有 ' + d.gaps.length + ' 段听不清（留空）' : '') +
        '。' + shapeNote);
    }
  }

  function loadStoredTheme() {
    idbGet(themeKey()).then(function (d) {
      if (d && d.notes) applyTheme(d);
      else updateThemeRow();
    }).catch(function () { updateThemeRow(); });
  }

  function readThemeFile(file) {
    if (!file) return;
    if (!/^audio\//.test(file.type) && !/\.(mp3|m4a|aac|wav|ogg|flac)$/i.test(file.name || '')) {
      notice('这不是音频文件');
      return;
    }
    ensureAudio();
    openMelodyPanel(true);
    theme.fileName = (file.name || '').replace(/\.[^.]+$/, '');
    theme.sel = null;
    if ($('melodySelBtn')) $('melodySelBtn').hidden = true;
    setMelodyStatus('正在解码这首歌…', '抽一条主旋律，让这首歌长成一棵属于它的树；不会放原曲。');

    var fr = new FileReader();
    fr.onload = function () {
      AC.decodeAudioData(fr.result.slice(0)).then(function (buf) {
        theme.buffer = buf;
        runExtract(null);
      }).catch(function () {
        setMelodyStatus('这首歌解不开', '换一个 mp3 / m4a / wav 试试。');
      });
    };
    fr.onerror = function () { setMelodyStatus('这首歌读不出来', '换一个文件试试。'); };
    fr.readAsArrayBuffer(file);
  }

  function runExtract(range) {
    if (!theme.buffer) {
      setMelodyStatus('这首歌不在这次会话里', '刷新后主题曲还在，但重新抽取需要再选一次这首歌。');
      return;
    }
    setMelodyStatus(range ? ('正在听 ' + fmtTime(range.t0) + '–' + fmtTime(range.t1) + ' 这一段…') : '正在听这首歌的旋律…');
    setTimeout(function () {
      var res, err = null;
      try {
        res = window.Melody.extract(theme.buffer, range ? { start: range.t0, end: range.t1 } : {});
      } catch (e) { err = e; }

      if (err || !res) {
        setMelodyStatus('这段没听清旋律', '换一段（副歌/主歌）或换一首更干净的器乐、清唱。');
        return;
      }

      if (!res.ok) {
        // 不输出假旋律：只画出真正跟踪到的零散片段，其余留空
        theme.data = {
          name: theme.fileName, duration: res.duration, points: res.points,
          gaps: res.gaps, notes: [], coverage: res.coverage, fail: true
        };
        theme.sel = null;
        drawMelody();
        updateThemeRow();
        setMelodyStatus('这段没听清旋律',
          res.reason === 'nothing'
            ? '没找到稳定的单条旋律。换一首器乐/清唱，或圈出人声最清楚的一段再抽。'
            : '有声音但基频不稳（复音混音里很常见）。圈一段人声清楚的，或换一首。原来的主题曲没有被覆盖。');
        return;
      }

      var q = window.Melody.quantize(res.notes, state.tips, state.box);
      var data = {
        v: 1,
        name: theme.fileName,
        duration: res.duration,
        coverage: res.coverage,
        notes: q,
        points: res.points,
        gaps: res.gaps,
        range: range || null,
        savedAt: Date.now()
      };
      theme.data = data;
      theme.sel = null;
      if ($('melodySelBtn')) $('melodySelBtn').hidden = true;
      idbPut(themeKey(), data).catch(function () {});
      persistThemeUrl();
      updateThemeRow();
      drawMelody();
      setMelodyStatus('抽出 ' + q.length + ' 个音 · 覆盖 ' + Math.round(res.coverage * 100) + '%' +
        (res.gaps.length ? ' · ' + res.gaps.length + ' 段听不清' : ''),
        '已存进这棵树。播放时会按旋律顺序点亮枝梢；拖选一段可以只抽那一段。');
    }, 30);
  }

  function bindTheme() {
    var canvas = $('melodyCanvas');
    if (!canvas) return;

    $('themeOpen').addEventListener('click', function () {
      openMelodyPanel();
      if (theme.data) drawMelody();
    });
    $('melodyClose').addEventListener('click', function () { openMelodyPanel(false); });
    $('themePick').addEventListener('click', function () { openMelodyPanel(true); $('fileTheme').click(); });
    $('melodyPick').addEventListener('click', function () { $('fileTheme').click(); });
    $('fileTheme').addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) readThemeFile(e.target.files[0]);
      e.target.value = '';
    });

    $('melodyPlay').addEventListener('click', function () {
      if (!theme.data || !theme.data.notes.length) {
        setMelodyStatus('还没有主题曲', '先选一首歌，抽出旋律再点亮。');
        return;
      }
      setMode('listen');
      if (!state.playing) play();
    });

    // 圈选一段：拖出一个时间区间，只抽这一段
    var drag = null;
    function timeAt(e) {
      var g = theme.geom;
      if (!g) return 0;
      var r = canvas.getBoundingClientRect();
      var x = (e.clientX - r.left) - g.padL;
      return Math.max(0, Math.min(1, x / g.iw)) * g.dur;
    }
    canvas.addEventListener('pointerdown', function (e) {
      if (!theme.geom || !theme.data) return;
      var t = timeAt(e);
      drag = { t0: t, x0: e.clientX, moved: false };
      theme.sel = { t0: t, t1: t };
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var t = timeAt(e);
      if (Math.abs(e.clientX - drag.x0) > 4) drag.moved = true;
      theme.sel = { t0: Math.min(drag.t0, t), t1: Math.max(drag.t0, t) };
      drawMelody();
    });
    canvas.addEventListener('pointerup', function (e) {
      if (!drag) return;
      var sel = theme.sel;
      drag.moved = drag.moved || Math.abs(e.clientX - drag.x0) > 4;
      if (!sel || !drag.moved || sel.t1 - sel.t0 < 0.4) {
        theme.sel = null;
        $('melodySelBtn').hidden = true;
        drawMelody();
      } else {
        var btn = $('melodySelBtn');
        btn.hidden = false;
        btn.textContent = '只抽 ' + fmtTime(sel.t0) + '–' + fmtTime(sel.t1);
        setMelodyHint('已圈选 ' + fmtTime(sel.t0) + '–' + fmtTime(sel.t1) +
          '。点「只抽这一段」会用这一段重新抽，覆盖这次的结果。');
      }
      drag = null;
    });
    canvas.addEventListener('pointercancel', function () { drag = null; });
    $('melodySelBtn').addEventListener('click', function () {
      if (theme.sel) runExtract(theme.sel);
    });

    // 拖一首歌到面板上，和底部的拖放是同一套文件读取
    ['dragenter', 'dragover'].forEach(function (ev) {
      $('melodyPanel').addEventListener(ev, function (e) {
        e.preventDefault(); e.stopPropagation();
        $('melodyPanel').classList.add('hot');
      });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      $('melodyPanel').addEventListener(ev, function (e) {
        e.preventDefault(); e.stopPropagation();
        $('melodyPanel').classList.remove('hot');
      });
    });
    $('melodyPanel').addEventListener('drop', function (e) {
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) readThemeFile(f);
    });
  }

  function bind() {
    $('pickBtn').addEventListener('click', function () { $('fileImg').click(); });
    $('resetBtn').addEventListener('click', function () { $('fileImg').click(); });
    $('fileImg').addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) pickImage(e.target.files[0]);
      e.target.value = '';
    });
    $('audioDrop').addEventListener('click', function () { $('fileAudio').click(); });
    $('fileAudio').addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) pickAudio(e.target.files[0]);
      e.target.value = '';
    });

    $('playBtn').addEventListener('click', togglePlay);
    if ($('showBtn')) $('showBtn').addEventListener('click', startShow);
    if ($('showExit')) $('showExit').addEventListener('click', endShow);
    if ($('showAgain')) $('showAgain').addEventListener('click', replayShow);
    // 演出时 Esc 退出
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && state.show && state.show.active) endShow();
    });

    // 调整抽屉：默认关，展开后原来的控件全在这里
    $('tuneBtn').addEventListener('click', function () {
      setTuneOpen($('tunePanel').hidden);
    });
    $('tuneClose').addEventListener('click', function () { setTuneOpen(false); });
    // 角落的「自动 N」：点它展开抽屉里的阈值
    if ($('thrPeek')) $('thrPeek').addEventListener('click', function () { setTuneOpen(true); });
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !$('tunePanel').hidden) setTuneOpen(false);
    });

    // 把当前这棵树放回地球：同一 id、同一张照片
    if ($('globeLink')) {
      $('globeLink').addEventListener('click', function () {
        var rec = {
          id: state.treeId || newTreeId(),
          name: state.treeName || displayTitle() || '',
          lat: state.treeGps ? state.treeGps.lat : null,
          lon: state.treeGps ? state.treeGps.lon : null,
          date: todayStr(),
          // 记忆就是照片：没有一张也能放，有的话卡片上要能看
          hasPhoto: !!(state.memories && state.memories.length),
          photoKey: (state.memories && state.memories.length) ? state.treeId : null,
          tier: state.tier,
          placeKey: (state.place && state.place.key) || null
        };
        try { localStorage.setItem('world3d.pending', JSON.stringify(rec)); } catch (e) {}
        location.href = 'world3d.html';
      });
    }

    document.querySelectorAll('.seg [data-mode]').forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('.seg [data-mode]').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        setMode(b.getAttribute('data-mode'));
      });
    });

    var growBtn = $('growToggle');
    if (growBtn) {
      growBtn.addEventListener('click', function () {
        ensureAudio();
        setMode(state.mode === 'grow' ? 'listen' : 'grow');
        if (!state.playing) play();
      });
    }

    // 只认抽屉里的色点：body 身上也有 data-tint，不能一起绑（点哪儿都会冒到 body）
    document.querySelectorAll('.tint-dots [data-tint]').forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('.tint-dots [data-tint]').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        setTint(b.getAttribute('data-tint'));
      });
    });

    document.querySelectorAll('.seg [data-species]').forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('.seg [data-species]').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        setSpecies(b.getAttribute('data-species'));
      });
    });

    // 曲风：点一下换一套作曲法（同一棵树记住选择）
    var es = $('engineSeg');
    if (es) es.querySelectorAll('[data-engine]').forEach(function (b) {
      b.addEventListener('click', function () { setEngine(b.getAttribute('data-engine')); });
    });

    if ($('seedBtn')) $('seedBtn').addEventListener('click', reseed);

    document.querySelectorAll('#airSeg [data-w]').forEach(function (b) {
      b.addEventListener('click', function () { setWeather(b.getAttribute('data-w')); });
    });

    // 记忆：拇指区一个入口，抽屉里一条缩略图
    if ($('memBtn')) $('memBtn').addEventListener('click', openLatestMemory);
    if ($('memClose')) {
      $('memClose').addEventListener('click', function () { $('memView').hidden = true; });
    }
    if ($('memView')) {
      $('memView').addEventListener('click', function (e) {
        if (e.target === $('memView')) $('memView').hidden = true;
      });
    }
    // 上滑展开 / 下滑收起：手机上那条把手（点一下也能开）
    if ($('sheetGrab')) {
      var grab = $('sheetGrab'), y0 = 0, dragging = false;
      grab.addEventListener('pointerdown', function (e) { dragging = true; y0 = e.clientY; });
      grab.addEventListener('pointerup', function (e) {
        if (!dragging) return;
        dragging = false;
        var dy = y0 - e.clientY;
        if (dy > 12) setTuneOpen(true);
        else if (dy < -12) setTuneOpen(false);
      });
      grab.addEventListener('click', function (e) {
        // 拖动过的那一下不再当成点击
        if (Math.abs(y0 - (e.clientY || y0)) > 12) return;
        var panel = $('tunePanel');
        setTuneOpen(!!(panel && panel.hidden));
      });
    }

    $('leavesBtn').addEventListener('click', function () {
      state.leavesOn = !state.leavesOn;
      this.classList.toggle('on', state.leavesOn);
      this.setAttribute('aria-pressed', state.leavesOn);
    });

    $('waterBtn').addEventListener('click', function () {
      state.waterOn = !state.waterOn;
      if (!state.waterOn) state.ripples = [];
      this.classList.toggle('on', state.waterOn);
      this.setAttribute('aria-pressed', state.waterOn);
    });

    $('readingBtn').addEventListener('click', function () {
      state.reading = !state.reading;
      document.body.classList.toggle('reading-on', state.reading);
      this.classList.toggle('on', state.reading);
      this.setAttribute('aria-pressed', state.reading);
    });

    document.querySelectorAll('.reading-tabs button').forEach(function (b) {
      b.addEventListener('click', function () {
        setFocusSystem(b.getAttribute('data-system'));
      });
    });

    document.querySelectorAll('.tree-hotspot').forEach(function (b) {
      b.addEventListener('click', function () {
        setFocusSystem(b.getAttribute('data-system'));
        if (!state.reading) {
          state.reading = true;
          document.body.classList.add('reading-on');
          $('readingBtn').classList.add('on');
          $('readingBtn').setAttribute('aria-pressed', 'true');
        }
      });
    });

    // 点画布：树冠上落一阵叶，水面附近起一圈纹
    var pd = function (e) {
      if (e.target !== stage) return;
      var x = e.clientX, y = e.clientY;
      if (state.waterOn) spawnRipple(x, y); else leafBurst(x, y);
    };
    stage.addEventListener('pointerdown', pd);

    var thr = $('thr');
    var thrTimer = null;
    if (thr) {
      thr.addEventListener('input', function () {
        state.threshold = +thr.value;
        setThrTag(null);          // 一动手就是手动值，不再挂「自动」
        // 拖动时只换剪影：快
        if (!state.generated && state.pixels) {
          state.mask = binarize(state.threshold);
          var sil = silhouetteFromMask(state.mask, state.ww, state.wh, PALETTE[state.tint].sil);
          if (state.layers) state.layers.sil = sil;
        }
      });
      thr.addEventListener('change', function () {
        if (state.generated || !state.pixels) return;
        $('busy').hidden = false;
        $('busyText').textContent = '重新抽一遍骨架';
        setTimeout(function () {
          rebuild(true);
          $('busy').hidden = true;
        }, 40);
      });
    }

    // 拖拽
    ['dragenter', 'dragover'].forEach(function (ev) {
      document.addEventListener(ev, function (e) {
        e.preventDefault();
        $('audioDrop').classList.add('hot');
      });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      document.addEventListener(ev, function (e) {
        e.preventDefault();
        $('audioDrop').classList.remove('hot');
      });
    });
    document.addEventListener('drop', function (e) {
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f) return;
      if (/^image\//.test(f.type)) pickImage(f);
      else if (/^audio\//.test(f.type)) pickAudio(f);
    });

    // 空格播放 / 暂停
    window.addEventListener('keydown', function (e) {
      if (e.code === 'Space' && !/INPUT|TEXTAREA/.test(e.target.tagName)) {
        e.preventDefault();
        togglePlay();
      }
    });

    window.addEventListener('resize', function () {
      resize();
      if (state.generated) generateTree();
      else if (state.pixels && state.mask) {
        state.layers.sil = silhouetteFromMask(state.mask, state.ww, state.wh, PALETTE[state.tint].sil);
        if (state.layers.glow) state.transform = computeTransform();
      }
      layoutHotspots();
      if (theme.data) drawMelody();
    });

    bindTheme();
    bindRecord();
  }

  /* 启动 */
  // URL 参数：?tint=day&species=willow&seed=42&reading=1
  (function () {
    var Q = new URLSearchParams(location.search);
    var t = Q.get('tint');
    if (t && PALETTE[t]) {
      state.tint = t;
      document.querySelectorAll('.tint-dots [data-tint]').forEach(function (x) {
        x.classList.toggle('on', x.getAttribute('data-tint') === t);
      });
    }
    var sp = Q.get('species');
    if (sp && SPECIES_NAME[sp]) {
      state.species = sp;
      document.querySelectorAll('.seg [data-species]').forEach(function (x) {
        x.classList.toggle('on', x.getAttribute('data-species') === sp);
      });
    }
    var sd = parseInt(Q.get('seed'), 10);
    if (sd > 0) state.seed = sd;

    // 从世界树的一丛过来：这处被记录几次 → 第几档（决定混响空间 3.2s → 5.5s）
    var qn = parseInt(Q.get('n'), 10);
    if (qn > 0) state.tier = Math.min(6, Math.max(1, qn));

    // 空气：?w=wind|rain|fog（截图与自测用，不主动起声音）
    var w0 = Q.get('w');
    if (w0 === 'wind' || w0 === 'rain' || w0 === 'fog') {
      state.weather = w0;
      state.air = { wind: w0 === 'wind' ? 1 : 0, rain: w0 === 'rain' ? 1 : 0, fog: w0 === 'fog' ? 1 : 0 };
      document.querySelectorAll('#airSeg [data-w]').forEach(function (x) {
        x.classList.toggle('on', x.getAttribute('data-w') === w0);
      });
      if ($('airState')) $('airState').textContent = AIR_TEXT[w0];
    }

    // 从世界树过来：这一棵的身份（id / 名字 / 坐标 / 形态）
    var qid = Q.get('id'), qname = Q.get('name');
    var qlat = parseFloat(Q.get('lat')), qlon = parseFloat(Q.get('lon'));
    var qform = Q.get('form');
    if (qid) state.treeId = qid;
    if (qname) state.treeName = qname;
    if (isFinite(qlat) && isFinite(qlon)) {
      state.treeGps = { lat: qlat, lon: qlon };
      // 光带坐标进来也认当地树种（不只从地球卡片的 form 参数）
      var directInfo = placeInfo();
      if (directInfo) {
        state.localSpecies = directInfo.primary || '';
        if (!qform) state.species = (window.TreePlaces && directInfo.primary)
          ? window.TreePlaces.formFor(directInfo.primary) : (directInfo.form || state.species);
      }
    }
    if (qform && SPECIES_NAME[qform]) {
      state.species = qform;
      document.querySelectorAll('.seg [data-species]').forEach(function (x) {
        x.classList.toggle('on', x.getAttribute('data-species') === qform);
      });
    }
    // 没有照片时，用 id / 坐标定一个稳定种子：同一棵树每次都长成一样
    if (!sd && (qid || state.treeGps)) {
      state.seed = seedFrom(qid || (state.treeGps.lat + ',' + state.treeGps.lon));
    }
    // 身份齐了，重新定曲风（从地球点进来时用树的 id 分配）
    if (qid) { state.engine = engineKeyForTree(); syncEngineUI(); }
    // 世界树卡片点进来时带了曲风：记下来，等 applyPlace 之后再盖上去
    var qeng = Q.get('eng');
    if (qeng && ENGINES[qeng]) state.pendingEng = qeng;

    if (Q.get('reading') === '1') {
      state.reading = true;
      document.body.classList.add('reading-on');
      // 面板开了，按钮也得是开的，否则首屏状态对不上
      $('readingBtn').classList.add('on');
      $('readingBtn').setAttribute('aria-pressed', 'true');
    }
  })();

  // 曲风：按这棵树的身份分配（或从 localStorage 取回用户手选的）
  state.engine = engineKeyForTree();

  document.body.classList.add('intro');
  syncEngineUI();
  document.body.setAttribute('data-tint', state.tint);
  resize();
  buildMotes();
  generateTree();
  layoutHotspots();
  setFocusSystem(state.focusSystem);
  setTitle();
  bind();
  loadStoredTheme();
  loadRecord();
  requestAnimationFrame(draw);

  // 从世界树点进来：按 id 找回它属于哪个地点，让这一棵还是那一棵
  if (state.treeId) {
    $('globeLink').hidden = false;
    $('globeLink').textContent = '回到地球 →';
    var fromPlace = null, fromMem = null;
    loadPlaces().forEach(function (p) {
      (p.memories || []).forEach(function (m) {
        if (m.id === state.treeId) { fromPlace = p; fromMem = m; }
      });
    });
    if (fromPlace) applyPlace(fromPlace, fromMem);
    else leaveIntro();
    setTitle();
  } else {
    // 普通刷新：回到上次待的地方（同一个地点永远同一棵树）
    var lastKey = null;
    try { lastKey = localStorage.getItem('tree.lastPlace'); } catch (e) {}
    if (lastKey) {
      var lastP = loadPlaces().filter(function (p) { return p.key === lastKey; })[0];
      if (lastP) applyPlace(lastP, null);
    }
  }

  // applyPlace 内部会按 treeId 重算曲风；这里用卡片带过来的曲风盖上去，
  // 保证"卡片写什么曲风，点进来就是什么曲风"。不写 localStorage——URL 参数是一次性的，
  // 手选仍然以 localStorage 为准（下次从地球点进来还是卡片那首）。
  if (state.pendingEng && ENGINES[state.pendingEng]) {
    state.engine = state.pendingEng;
    resetSeq();
    syncEngineUI();
    updateMeta();
    delete state.pendingEng;
  }

  // 方便调试
  window.__tree = {
    state: state,
    theme: theme,
    play: play,
    pause: pause,
    setMode: setMode,
    setTint: setTint,
    setSpecies: setSpecies,
    reseed: reseed,
    setWeather: setWeather,
    air: function () {
      return {
        weather: state.weather,
        amb: amb.ready,
        gains: amb.ready ? { wind: +amb.wind.gain.value.toFixed(4), rain: +amb.rain.gain.value.toFixed(4), lowpass: Math.round(amb.bus.frequency.value) } : null,
        audio: AC ? AC.state : null
      };
    },
    openMelody: openMelodyPanel,
    applyPlace: applyPlace,
    hasTheme: hasTheme,
    lightTip: lightTip,
    startShow: startShow,
    replayShow: replayShow,
    endShow: endShow,
    showSeek: function (el) { if (state.show) { state.show.manualEl = el; state.show.t0 = performance.now() - el; } },
    showDebug: function () {
      if (!state.show || !state.show.active) return null;
      var T = state.show;
      return {
        active: true, phase: T.phase,
        elapsed: T.manualEl != null ? T.manualEl : (performance.now() - T.t0)
      };
    },
    // 混响空间：档位与冲激响应时长（3.2s → 5.5s）
    reverb: function () {
      return {
        tier: state.tier,
        seconds: revNode && revNode.buffer ? +revNode.buffer.duration.toFixed(2) : 0
      };
    },
    // 用 dataURL 假装上传了一张照片
    feed: function (dataUrl) {
      fetch(dataUrl).then(function (r) { return r.blob(); }).then(function (b) {
        pickImage(new File([b], 'test.png', { type: 'image/png' }));
      });
    },
    record: null
  };

  window.__tree.setEngine = setEngine;
  window.__tree.engineInfo = function () {
    var e = currentEngine();
    return { key: state.engine, name: e.name, mood: e.mood, scale: e.scale.slice(), base: e.base };
  };
  // 调试：灌入一段主题曲数据，立即按它重长这棵树（听歌长树）
  window.__tree.applyThemeData = function (d) { applyTheme(d); };
  // 调试：当前这棵树固定谱子的摘要（验证可复现 / 不同树不同）
  window.__tree.scoreInfo = function () {
    var s = buildScore(state.engine, scoreSeed());
    return {
      seed: scoreSeed(), engine: state.engine,
      notes: s.notes.slice(0, 16), gaps: s.gaps.slice(0, 16).map(function (x) { return Math.round(x); }),
      len: s.notes.length
    };
  };
  window.__tree.saveRecord = saveRecord;
  window.__tree.exportRecord = exportRecordPoster;
  window.__tree.openRecord = openRecordPanel;
  window.__tree.loadRecord = loadRecord;

  /* =========================================================
     6. 一棵树，一张唱片（record）
     ---------------------------------------------------------
     - 把「树的快照 + 那天的旋律 + 歌名 + 地点 + 日期」存成一张卡
     - 页内是可播放的唱片卡；一键导出成竖版海报 PNG
     - 存 IndexedDB：record:<treeId> 或 record:seed:<seed>:<species>
     ========================================================= */

  function recordKey() {
    return state.treeId ? ('record:' + state.treeId)
      : ('record:seed:' + state.seed + ':' + state.species);
  }

  // 歌名：优先主题曲自带名字，其次文件名，再次空
  function recordSongTitle() {
    if (theme.data && theme.data.name) return theme.data.name;
    if (theme.fileName) return theme.fileName;
    return '';
  }

  // 树的封面图：优先照片原图（等比例裁方），否则用当前 stage 快照
  function recordCover(cb) {
    var mem = (state.memories && state.memories.length) ? state.memories[state.memories.length - 1] : null;
    var tryPhoto = function (onDone) {
      if (!mem) return onDone(null);
      idbGet(mem.id).then(function (blob) {
        if (!blob) return onDone(null);
        var url = URL.createObjectURL(blob);
        var img = new Image();
        img.onload = function () {
          var s = Math.min(img.width, img.height);
          var c = document.createElement('canvas');
          c.width = c.height = 720;
          var g = c.getContext('2d');
          g.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 720, 720);
          URL.revokeObjectURL(url);
          onDone(c.toDataURL('image/jpeg', 0.85));
        };
        img.onerror = function () { URL.revokeObjectURL(url); onDone(null); };
        img.src = url;
      }).catch(function () { onDone(null); });
    };
    tryPhoto(function (photo) {
      if (photo) return cb(photo);
      // 没有照片：用当前 stage 快照（裁成方形居中）
      var snap = snapshotStage();
      if (!snap) return cb(null);
      var s = Math.min(snap.width, snap.height);
      var c = document.createElement('canvas');
      c.width = c.height = 720;
      var g = c.getContext('2d');
      g.drawImage(snap, (snap.width - s) / 2, (snap.height - s) / 2, s, s, 0, 0, 720, 720);
      cb(c.toDataURL('image/jpeg', 0.88));
    });
  }

  // 组装唱片数据（不含封面，封面异步补）
  function buildRecord() {
    var p = placeInfo();
    var placeName = p ? (p.place || placeTitle(state.place)) : placeTitle(state.place);
    // 没有真实地点时不留「这个地点」这种占位符
    if (placeName === '这个地点') placeName = '';
    return {
      id: recordKey(),
      title: recordSongTitle(),
      name: state.treeName || displayTitle() || '',
      place: placeName,
      species: p ? p.species.slice(0, 2).join(' · ') : (SPECIES_NAME[state.species] || ''),
      lat: state.treeGps ? state.treeGps.lat : null,
      lon: state.treeGps ? state.treeGps.lon : null,
      date: todayStr(),
      tint: state.tint,
      // 这棵树的曲风：让"这棵树的声音"跨页一致（树页 / 地球卡片 / 唱片）
      engine: { key: state.engine, name: currentEngine().name, mood: currentEngine().mood },
      melody: theme.data ? theme.data.notes : [],
      cover: null,   // dataURL，保存前补上
      madeAt: Date.now()
    };
  }

  function saveRecord() {
    // 树本身就够撑起一张唱片：封面用照片或树的快照，旋律可空
    recordCover(function (cover) {
      var rec = buildRecord();
      rec.cover = cover;
      idbPut(recordKey(), rec).then(function () {
        window.__tree.record = rec;
        updateRecordRow();
        notice('已存成一张唱片 · ' + (rec.title || rec.place || '这棵树'));
      }).catch(function () { notice('存唱片失败'); });
    });
  }

  function loadRecord() {
    idbGet(recordKey()).then(function (rec) {
      if (rec) { window.__tree.record = rec; updateRecordRow(); }
      else updateRecordRow();
    }).catch(function () { updateRecordRow(); });
  }

  function updateRecordRow() {
    var el = $('recordState');
    if (!el) return;
    var rec = window.__tree.record;
    var hasMel = rec && rec.melody && rec.melody.length;
    if (rec && (hasMel || rec.cover || rec.title || rec.name || rec.place)) {
      el.textContent = '已有一张唱片';
      el.classList.add('has');
    } else {
      el.textContent = '还没有唱片';
      el.classList.remove('has');
    }
  }

  /* ---------- 导出成图：竖版海报 ---------- */
  function exportRecordPoster() {
    var rec = window.__tree.record;
    if (!rec) { notice('先把这张唱片存下来，再导出'); saveRecord(); return; }
    if (!rec.cover && !(rec.melody && rec.melody.length) && !rec.title) { notice('这张唱片是空的'); return; }

    var W = 1080, H = 1440;
    var c = document.createElement('canvas');
    c.width = W; c.height = H;
    var g = c.getContext('2d');

    // 底色 + 文字色（跟当前色调走）
    var cs = getComputedStyle(document.body);
    var bg = cs.getPropertyValue('--bg0').trim() || '#0C0909';
    var ink = cs.getPropertyValue('--ink').trim() || '#FFF2DA';
    var dim = cs.getPropertyValue('--dim').trim() || 'rgba(255,242,218,.5)';
    var accent = cs.getPropertyValue('--accent').trim() || '#E4B169';
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);

    var pad = 72;
    var title = rec.title || '一棵树的唱片';
    var sub = [rec.name, rec.place].filter(Boolean).join(' · ');
    // 曲风：旧唱片没有 engine 字段，缺省就不画
    var songLine = rec.engine ? ('♫ ' + rec.engine.name + ' · ' + rec.engine.mood) : '';

    // 下载
    function download() {
      var a = document.createElement('a');
      a.download = '唱片_' + (rec.title || rec.place || '树') + '_' + rec.date + '.png';
      a.href = c.toDataURL('image/png');
      a.click();
      notice('唱片已导出成图');
    }

    // 顶部品牌小字
    function drawBrand(topY) {
      g.fillStyle = accent;
      g.font = '400 22px "PingFang SC","Helvetica Neue",Arial,sans-serif';
      g.fillText('树与音乐 · 一棵树一张唱片', pad, topY);
      g.textAlign = 'right';
      g.fillText('NATURE BEYOND TECHNOLOGY', W - pad, topY);
      g.textAlign = 'left';
    }

    // 底部：日期 + 坐标
    function drawFoot() {
      g.fillStyle = dim;
      g.font = '400 24px "PingFang SC","Helvetica Neue",Arial,sans-serif';
      g.fillText(rec.date, pad, H - pad);
      if (rec.lat != null && rec.lon != null) {
        var loc = rec.lat.toFixed(2) + '°' + (rec.lat >= 0 ? 'N' : 'S') + '  ' +
          rec.lon.toFixed(2) + '°' + (rec.lon >= 0 ? 'E' : 'W');
        g.textAlign = 'right';
        g.fillText(loc, W - pad, H - pad);
        g.textAlign = 'left';
      }
    }

    // 没有封面：纯文字 + 旋律排版
    function drawNoCover() {
      drawBrand(120);
      g.fillStyle = ink;
      g.font = '600 64px "PingFang SC","Helvetica Neue",Arial,sans-serif';
      g.fillText(title, pad, 320, W - pad * 2);
      g.fillStyle = dim;
      g.font = '400 34px "PingFang SC","Helvetica Neue",Arial,sans-serif';
      if (sub) g.fillText(sub, pad, 392, W - pad * 2);
      if (rec.species) g.fillText(rec.species, pad, 446, W - pad * 2);
      if (songLine) {
        g.fillStyle = accent;
        g.font = '400 28px "PingFang SC","Helvetica Neue",Arial,sans-serif';
        g.fillText(songLine, pad, 492, W - pad * 2);
      }

      g.strokeStyle = accent; g.lineWidth = 2;
      g.beginPath(); g.moveTo(pad, 520); g.lineTo(W - pad, 520); g.stroke();

      drawRecordMelody(g, rec.melody, pad, 580, W - pad * 2, 560, accent);
      drawFoot();
      download();
    }

    // 有封面：封面居中、文字依次下排，给曲风与旋律都留足间距
    function drawWithCover(img) {
      drawBrand(110);
      var coverSize = 820;                       // 略小于满幅，腾出下方文字空间
      var coverX = (W - coverSize) / 2;
      g.drawImage(img, coverX, 140, coverSize, coverSize);
      var ty = 140 + coverSize + 62;             // 文字起始基线

      g.fillStyle = ink;
      g.font = '600 52px "PingFang SC","Helvetica Neue",Arial,sans-serif';
      g.fillText(title, pad, ty, W - pad * 2);
      g.fillStyle = dim;
      g.font = '400 30px "PingFang SC","Helvetica Neue",Arial,sans-serif';
      if (sub) g.fillText(sub, pad, ty + 52, W - pad * 2);
      if (rec.species) g.fillText(rec.species, pad, ty + 96, W - pad * 2);
      if (songLine) {
        g.fillStyle = accent;
        g.font = '400 26px "PingFang SC","Helvetica Neue",Arial,sans-serif';
        g.fillText(songLine, pad, ty + 134, W - pad * 2);
      }

      g.strokeStyle = accent; g.lineWidth = 2;
      g.beginPath(); g.moveTo(pad, ty + 168); g.lineTo(W - pad, ty + 168); g.stroke();

      var melY = ty + 192, melH = H - melY - 108;
      drawRecordMelody(g, rec.melody, pad, melY, W - pad * 2, melH, accent);
      drawFoot();
      download();
    }

    if (rec.cover) {
      var img = new Image();
      img.onload = function () { drawWithCover(img); };
      img.onerror = function () { drawNoCover(); };
      img.src = rec.cover;
    } else {
      drawNoCover();
    }
  }

  // 在 canvas 上画一条旋律线（音符台阶 + 节奏点）
  function drawRecordMelody(g, notes, x, y, w, h, color) {
    if (!notes || !notes.length) {
      g.fillStyle = 'rgba(128,128,128,.5)';
      g.font = '400 24px "PingFang SC",sans-serif';
      g.fillText('（还没有主题曲 · 给它一首歌）', x, y + h / 2);
      return;
    }
    var minM = Infinity, maxM = -Infinity;
    notes.forEach(function (n) { if (n.midi < minM) minM = n.midi; if (n.midi > maxM) maxM = n.midi; });
    if (!isFinite(minM)) { minM = 60; maxM = 72; }
    var dur = notes[notes.length - 1].t1;
    var span = Math.max(1, maxM - minM);

    g.strokeStyle = color;
    g.lineWidth = 3;
    g.beginPath();
    var first = true;
    notes.forEach(function (n) {
      var px = x + (n.t0 / dur) * w;
      var py = y + h - ((n.midi - minM) / span) * h;
      if (first) { g.moveTo(px, py); first = false; }
      else g.lineTo(px, py);
      g.lineTo(x + (n.t1 / dur) * w, py);
    });
    g.stroke();

    // 节奏点
    g.fillStyle = color;
    notes.forEach(function (n) {
      var px = x + (n.t0 / dur) * w;
      var py = y + h - ((n.midi - minM) / span) * h;
      g.beginPath(); g.arc(px, py, 5, 0, 6.2832); g.fill();
    });
  }

  /* ---------- 唱片面板 UI 控制 ---------- */
  function openRecordPanel(show) {
    var p = $('recordPanel');
    if (!p) return;
    p.hidden = show === undefined ? !p.hidden : !show;
    if (!p.hidden) refreshRecordPanel();
  }

  function refreshRecordPanel() {
    var rec = window.__tree.record;
    if (!$('recordPanel')) return;
    if (rec && rec.cover) { $('recordCover').src = rec.cover; $('recordCover').hidden = false; }
    else $('recordCover').hidden = true;
    $('recordTitle').textContent = rec && rec.title ? rec.title : '（给它一首歌，就有歌名）';
    var sub = [rec && rec.name, rec && rec.place].filter(Boolean).join(' · ');
    $('recordSub').textContent = sub || '这棵树';
    if ($('recordSong')) {
      $('recordSong').textContent = rec && rec.engine
        ? ('♫ ' + rec.engine.name + ' · ' + rec.engine.mood) : '';
      $('recordSong').hidden = !(rec && rec.engine);
    }
    $('recordDate').textContent = rec ? rec.date : todayStr();
    if (rec && rec.melody && rec.melody.length) {
      var cv = $('recordMelody');
      cv.hidden = false;
      cv.width = cv.clientWidth * 2; cv.height = 240;
      drawRecordMelody(cv.getContext('2d'), rec.melody, 20, 20, cv.width - 40, 200,
        getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#E4B169');
    } else {
      $('recordMelody').hidden = true;
    }
  }

  function bindRecord() {
    var p = $('recordPanel');
    if (!p) return;
    $('recordOpen').addEventListener('click', function () { openRecordPanel(); });
    $('recordClose').addEventListener('click', function () { openRecordPanel(false); });
    $('recordSave').addEventListener('click', saveRecord);
    $('recordExport').addEventListener('click', exportRecordPoster);
    // 歌名可编辑：双击标题改成自定义
    $('recordTitle').addEventListener('dblclick', function () {
      var cur = $('recordTitle').textContent;
      var t = prompt('给这张唱片起个名字', window.__tree.record && window.__tree.record.title || cur);
      if (t == null) return;
      if (window.__tree.record) window.__tree.record.title = t.trim();
      refreshRecordPanel();
    });
  }
})();
