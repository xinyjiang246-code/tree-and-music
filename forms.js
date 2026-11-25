/* 树形库：同一颗种子，同一种树形，换主题不换树。
   输出统一为二次曲线段 + 枝梢 + 叶锚点，供 app.js 烘焙骨架与粒子。

   做法：手写骨架（主干 + 沿干分出的主枝）+ 递归二级枝，
   每次生长都被"树冠椭圆"约束，所以剪影是收口的，不会长成一把扇子。 */
(function () {
  'use strict';

  function random(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function wrap(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  function normalize(segs, tips, w, h, margin, leaves) {
    var minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    segs.forEach(function (s) {
      minX = Math.min(minX, s.x1, s.x2, s.cx);
      maxX = Math.max(maxX, s.x1, s.x2, s.cx);
      minY = Math.min(minY, s.y1, s.y2, s.cy);
      maxY = Math.max(maxY, s.y1, s.y2, s.cy);
    });
    if (!segs.length) return;
    var bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY);
    var sc = Math.min((w - margin * 2) / bw, (h - margin * 2) / bh);
    var ox = margin + (w - margin * 2 - bw * sc) / 2 - minX * sc;
    var oy = h - margin - bh * sc - minY * sc;

    segs.forEach(function (s) {
      s.x1 = s.x1 * sc + ox; s.x2 = s.x2 * sc + ox; s.cx = s.cx * sc + ox;
      s.y1 = s.y1 * sc + oy; s.y2 = s.y2 * sc + oy; s.cy = s.cy * sc + oy;
      s.w = s.w * Math.max(0.5, Math.min(1.6, sc));
    });
    tips.forEach(function (p) { p.x = p.x * sc + ox; p.y = p.y * sc + oy; });
    (leaves || []).forEach(function (p) { p.x = p.x * sc + ox; p.y = p.y * sc + oy; });
  }

  function pointOn(s, t) {
    var u = 1 - t;
    return {
      x: u * u * s.x1 + 2 * u * t * s.cx + t * t * s.x2,
      y: u * u * s.y1 + 2 * u * t * s.cy + t * t * s.y2
    };
  }

  function leafAnchors(segs, species, fullness) {
    var out = [];
    // 同一颗树、照片越多冠越密：叶距随 fullness 收紧（形态与身份不变，只是更繁）
    var gap = (species === 'willow' ? 9 : 7) * (1 - 0.34 * (fullness || 0));
    segs.forEach(function (s, i) {
      if (!s.leafy) return;
      var L = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
      var n = Math.max(1, Math.min(10, Math.round(L / gap)));
      for (var j = 0; j < n; j++) {
        var t = (j + 0.5) / n;
        var p = pointOn(s, t);
        var q = pointOn(s, Math.max(0, t - 0.06));
        out.push({ x: p.x, y: p.y, a: Math.atan2(p.y - q.y, p.x - q.x), k: i * 11 + j });
      }
    });
    return out;
  }

  function sampleDown(arr, cap) {
    if (arr.length <= cap) return arr;
    var out = [], step = arr.length / cap;
    for (var i = 0; i < cap; i++) out.push(arr[Math.floor(i * step)]);
    return out;
  }

  /* 叶团：枝梢一根线上等距排叶，看着像梳齿。
     每片叶再带一两个偏移的同伴，叶量才成簇。 */
  function clumpLeaves(anchors, seed) {
    var rnd = random(seed ^ 0x51c3e5);
    var out = anchors.slice();
    for (var i = 0; i < anchors.length; i++) {
      var a = anchors[i];
      var copies = 2 + (rnd() < 0.55 ? 1 : 0);
      for (var k = 0; k < copies; k++) {
        var ang = rnd() * Math.PI * 2;
        var r = 1.6 + rnd() * 4.2;
        out.push({
          x: a.x + Math.cos(ang) * r,
          y: a.y + Math.sin(ang) * r,
          a: a.a + (rnd() - 0.5) * 1.5,
          k: a.k * 13 + k
        });
      }
    }
    return out;
  }

  /* 冠内补叶：枝条只在冠边收口，冠心会空成一个甜甜圈。
     在冠内补一层不贴枝的叶，剪影才有"叶量"。 */
  function crownFill(cfg, count, seed) {
    if (!count) return [];
    var rnd = random(seed ^ 0x5bd1e9);
    var out = [];
    var guard = 0;
    while (out.length < count && guard++ < count * 6) {
      var t = Math.sqrt(rnd()) * 0.98;
      var a = rnd() * Math.PI * 2;
      var wob = 1 + (cfg.wobble || 0) * (
        Math.sin(a * 3 + 1.7) * 0.6 + Math.sin(a * 5 - 0.8) * 0.4);
      var x = cfg.cx + Math.cos(a) * cfg.rx * t * wob;
      var y = cfg.cy + Math.sin(a) * cfg.ry * t * wob;
      if (y > cfg.floorY - 28) continue;
      // 落在主干上会像半空挂了一团叶
      if (Math.abs(x - cfg.cx) < cfg.w * 0.085 && y > cfg.cy) continue;
      // 只补"枝与枝之间的缝"：离最近的枝梢太远就别撒，否则会悬在半空
      if (cfg.tipList && cfg.tipList.length) {
        var bestD = 1e18, bx2 = x, by2 = y;
        for (var q = 0; q < cfg.tipList.length; q++) {
          var tp = cfg.tipList[q];
          var dd = (tp.x - x) * (tp.x - x) + (tp.y - y) * (tp.y - y);
          if (dd < bestD) { bestD = dd; bx2 = tp.x; by2 = tp.y; }
        }
        if (bestD > (cfg.rx * 0.40) * (cfg.rx * 0.40)) continue;
        x += (bx2 - x) * 0.55; y += (by2 - y) * 0.55;
      }
      out.push({ x: x, y: y, a: -Math.PI / 2 + (rnd() - 0.5) * 1.9, k: 9000 + out.length });
    }
    return out;
  }

  /* =========================================================
     骨架：主干 + 主枝 + 递归二级枝
     - 枝由一串短二次曲线组成，逐段变细，才不像几根折线
     - 每根枝都受树冠椭圆约束：出冠就顺着冠边拐，拐不回来就收
     - 越靠上的枝越"向上"，越靠下的主枝越平：这是树的主次
     ========================================================= */
  var UP = -Math.PI / 2;

  function scaffold(cfg) {
    var rnd = random(cfg.seed);
    var segs = [], tips = [];
    var floorY = cfg.floorY;
    var cx = cfg.cx, cy = cfg.cy, rx = cfg.rx, ry = cfg.ry;
    var budget = cfg.maxSegs || 1500;

    // 冠形不是椭圆：给边界加低频起伏，剪影才有"团"，不像剪出来的圆
    var wobA = cfg.wobble || 0;
    var wob1 = rnd() * 6.2832, wob2 = rnd() * 6.2832;

    function outQ(x, y) {
      var dx = x - cx, dy = y - cy;
      var k = 1 + wobA * (Math.sin(Math.atan2(dy, dx) * 3 + wob1) * 0.62 +
                          Math.sin(Math.atan2(dy, dx) * 5 + wob2) * 0.38);
      var nx = dx / (rx * k), ny = dy / (ry * k);
      return nx * nx + ny * ny;
    }

    function seg(x1, y1, x2, y2, w, bend, depth, flat) {
      if (segs.length >= budget) return false;
      var a = Math.atan2(y2 - y1, x2 - x1);
      segs.push({
        x1: x1, y1: y1, x2: x2, y2: y2,
        cx: (x1 + x2) / 2 - Math.sin(a) * bend,
        cy: (y1 + y2) / 2 + Math.cos(a) * bend,
        w: Math.max(0.7, w), depth: depth, leafy: depth >= cfg.leafDepth,
        // 贴地那一段用平头收：圆帽会在脚下鼓成一个球
        flat: !!flat
      });
      return true;
    }

    // 一根枝：朝 ang 走 len 像素，宽 w0→w1
    function grow(x, y, ang, len, w0, w1, depth, flatBase) {
      if (segs.length >= budget || len < cfg.minLen) {
        tips.push({ x: x, y: y, a: ang, depth: depth });
        return;
      }
      // 离冠边越近，枝就越短：末梢分布在整团冠里，不会全挤到边上
      var q0 = Math.sqrt(outQ(x, y));
      var room = Math.max((1 - Math.min(1, q0)) * Math.min(rx, ry), Math.min(rx, ry) * 0.16);
      len = Math.min(len, room * (1.9 + rnd() * 1.1) + cfg.minLen);
      if (len < cfg.minLen) {
        tips.push({ x: x, y: y, a: ang, depth: depth });
        return;
      }
      var steps = Math.max(2, Math.min(12, Math.round(len / cfg.step)));
      var sl = len / steps;
      var a = ang, px = x, py = y;
      var reach = cfg.reach[depth] == null ? 0.4 : cfg.reach[depth];
      var sideA = Math.round(steps * 0.36) + (rnd() < 0.5 ? 0 : 1);
      var sideB = Math.round(steps * 0.70);

      for (var i = 0; i < steps; i++) {
        // 负向重力性：枝往上回正，越细越明显
        a += wrap(UP - a) * reach * 0.14;
        a += (rnd() - 0.5) * cfg.wave;
        var nx = px + Math.cos(a) * sl;
        var ny = py + Math.sin(a) * sl;
        if (outQ(nx, ny) > 1) {
          // 出了冠：改成顺冠边拐
          var q = outQ(nx, ny);
          var s = 1 / Math.sqrt(q);
          var ex = cx + (nx - cx) * s, ey = cy + (ny - cy) * s * 0.995;
          a += wrap(Math.atan2(ey - py, ex - px) - a) * 0.35;
          nx = px + Math.cos(a) * sl;
          ny = py + Math.sin(a) * sl;
          if (outQ(nx, ny) > 1.03) break;
        }
        if (ny > floorY - 3) { ny = floorY - 3; }
        var ww = w0 + (w1 - w0) * ((i + 1) / steps);
        if (!seg(px, py, nx, ny, ww, (rnd() - 0.5) * sl * 0.34, depth, flatBase && i === 0)) break;
        px = nx; py = ny;

        // 中段侧枝：枝不能一根光杆到梢；一根枝上生两处，冠内才不生洞
        if ((i === sideA || i === sideB) && depth >= 1 && depth < cfg.maxDepth && steps >= 4 &&
            rnd() < (cfg.sideChance || 0.55)) {
          var side = (i === sideA ? (rnd() < 0.5 ? -1 : 1) : (rnd() < 0.5 ? -1 : 1));
          var sa = a + side * (cfg.spread[depth] || 0.7) * (0.62 + rnd() * 0.5);
          grow(px, py, sa,
               len * (cfg.ratio[depth] || 0.66) * (0.58 + rnd() * 0.34),
               ww * 0.58, ww * 0.38, depth + 1);
        }
      }

      if (depth >= cfg.maxDepth) {
        tips.push({ x: px, y: py, a: a, depth: depth });
        return;
      }
      // 末端分叉
      var kids = cfg.kids[depth] || 2;
      for (var k = 0; k < kids; k++) {
        var t = kids === 1 ? 0 : (k / (kids - 1) - 0.5);
        var ka = a + t * (cfg.fork[depth] || 0.9) * (0.8 + rnd() * 0.5);
        grow(px, py, ka,
             len * (cfg.ratio[depth] || 0.66) * (0.66 + rnd() * 0.5),
             w1 * 0.62, w1 * 0.40, depth + 1);
      }
    }

    // ---- 主干 ----
    if (!cfg.multiStem) {
      var tx = cfg.trunkX;
      var a0 = UP + cfg.lean;
      var trunkH = cfg.trunkH;
      var tsteps = Math.max(4, Math.round(trunkH / (cfg.step * 0.85)));
      var tsl = trunkH / tsteps;
      var px = tx, py = floorY;
      var trunkPts = [{ x: px, y: py, u: 0 }];

      for (var i = 0; i < tsteps; i++) {
        var u = (i + 1) / tsteps;
        // 一条很轻的 S 形：树干直得像电线杆就不像树
        var want = Math.atan2(-tsl, tx + Math.sin(u * 3.1 + cfg.swayPhase) * cfg.swayAmp - px);
        a0 += wrap(want - a0) * 0.5 + (rnd() - 0.5) * 0.028;
        var nx = px + Math.cos(a0) * tsl;
        var ny = py + Math.sin(a0) * tsl;
        // 根部微微加粗就够，加太猛会在脚底下鼓出一个球
        var ww = cfg.trunkW * (1 - 0.45 * u) * (1 + 0.12 * Math.pow(1 - u, 1.6));
        seg(px, py, nx, ny, ww, (rnd() - 0.5) * tsl * 0.16, 0, i === 0);
        px = nx; py = ny;
        trunkPts.push({ x: px, y: py, u: u });
      }

      // 主枝高度：从冠底到干顶自动排，保证每根都长在冠内
      var limbU = cfg.limbU;
      if (!limbU) {
        var yTopL = floorY - cfg.trunkH;
        var yBotL = Math.min(cfg.cy + cfg.ry * 0.95, yTopL + cfg.trunkH * 0.34);
        var uA = Math.max(0.10, Math.min(0.92, (floorY - yBotL) / cfg.trunkH));
        var nL = cfg.nLimb || 5;
        limbU = [];
        for (var li = 0; li < nL; li++) limbU.push(uA + (0.97 - uA) * li / Math.max(1, nL - 1));
      }

      // 沿干分主枝：左右交替 + 一点噪声，否则像排齿
      limbU.forEach(function (lu, idx) {
        var p = trunkPts[Math.max(1, Math.min(trunkPts.length - 1, Math.round(lu * tsteps)))];
        var side = idx % 2 === 0 ? -1 : 1;
        if (rnd() < 0.22) side = -side;
        var off = cfg.limbOff + (cfg.limbTaperOff || 0) * (lu - limbU[0]) +
                  (rnd() - 0.5) * 0.30;
        var ang = UP + side * off;
        var len = cfg.limbLen * (0.82 + 0.34 * lu) * (0.82 + rnd() * 0.34);
        grow(p.x, p.y, ang, len,
             cfg.limbW * (1 - 0.4 * lu), cfg.limbW * 0.5, 1);
      });

      // 树梢：顶上一分为二（有时三）
      var top = trunkPts[trunkPts.length - 1];
      for (var k = 0; k < 3; k++) {
        var t2 = k - 1;
        grow(top.x, top.y, UP + t2 * 0.72 + (rnd() - 0.5) * 0.2,
             cfg.limbLen * (0.92 - Math.abs(t2) * 0.12) * (0.85 + rnd() * 0.25),
             cfg.limbW * 0.60, cfg.limbW * 0.38, 1);
      }

      // 根盘：底下一两根斜出的根，树才"站"在地上
      var nRoot = 2;
      for (var r = 0; r < nRoot; r++) {
        var ra = UP + (r ? 1 : -1) * (0.55 + rnd() * 0.2);
        var rl = cfg.trunkW * (0.42 + rnd() * 0.3);
        var bx = tx + Math.cos(ra) * rl;
        var by = Math.min(floorY + 1, floorY - 9 + Math.sin(ra) * rl);
        seg(tx, floorY - 14, bx, by, cfg.trunkW * 0.18, 0, 0, true);
      }
    } else {
      // 灌木：从地面直接分出几根细干
      var nStem = cfg.stems || 6;
      for (var s = 0; s < nStem; s++) {
        var su = (s / Math.max(1, nStem - 1) - 0.5);
        var sx = cfg.trunkX + su * cfg.w * 0.26 + (rnd() - 0.5) * 4;
        var sa = UP + su * 0.62 + (rnd() - 0.5) * 0.16;
        // 外圈的干要短：不然剪影是一把扇子，不是一丛灌木
        grow(sx, floorY, sa,
             cfg.trunkH * (2.1 - Math.abs(su) * 0.9) * (0.9 + rnd() * 0.3),
             cfg.trunkW * (0.6 + rnd() * 0.4), cfg.trunkW * 0.34, 1, true);
      }
    }

    return {
      segs: segs, tips: tips,
      crown: { cx: cx, cy: cy, rx: rx, ry: ry, w: cfg.w, h: cfg.h }
    };
  }

  /* ---------------- 四种形态 ---------------- */

  function baseCfg(species, seed, w, h) {
    var j = random(seed ^ 0x2545);
    return {
      w: w, h: h, seed: seed,
      floorY: h - 16,
      jitter: j,
      step: 9, minLen: 13, wave: 0.08,
      maxSegs: 1600,
      maxDepth: 3, leafDepth: 1,
      ratio: { 1: 0.70, 2: 0.64, 3: 0.60 },
      spread: { 1: 0.80, 2: 0.95, 3: 1.10 },
      fork: { 1: 0.95, 2: 1.10, 3: 0.00 },
      kids: { 1: 2, 2: 2, 3: 0 },
      reach: { 1: 0.50, 2: 0.32, 3: 0.18 },
      sideChance: 0.5,
      limbW: 13,
      swayPhase: j() * 6.28,
      swayAmp: 0
    };
  }

  /* 曲调形态参数：把 overrides 合并进 config。
     结构是两层的：普通键直接覆盖，ratio/spread/fork/kids/reach 这类按层级的表逐键合并。
     没有 overrides 时完全不改默认行为。 */
  function applyOverrides(c, over) {
    if (!over) return c;
    var tables = { ratio: 1, spread: 1, fork: 1, kids: 1, reach: 1 };
    // 繁茂度：同一颗树、照片越多，多长一层细枝 + 侧枝更密 + 冠略宽。
    // 只动"生长量"，不动 cx/cy 几何中心，灌木/垂柳也不会被压没。
    if (over.fullness > 0 && c.maxDepth != null) {
      var f = Math.min(1, over.fullness);
      c.maxDepth = c.maxDepth + (f >= 0.55 ? 1 : 0);
      if (c.sideChance != null) c.sideChance = Math.min(0.98, c.sideChance + f * 0.13);
      if (c.rx != null) c.rx = c.rx * (1 + f * 0.06);
      if (c.maxSegs != null) c.maxSegs = Math.round(c.maxSegs * (1 + f * 0.35));
      // 新加深的那层要有参数，否则取默认值
      var d = c.maxDepth;
      if (c.ratio && c.ratio[d] == null) c.ratio[d] = 0.56;
      if (c.spread && c.spread[d] == null) c.spread[d] = 1.20;
      if (c.fork && c.fork[d] == null) c.fork[d] = 0;
      if (c.kids && c.kids[d] == null) c.kids[d] = 0;
      if (c.reach && c.reach[d] == null) c.reach[d] = 0.10;
    }
    for (var k in over) {
      if (!Object.prototype.hasOwnProperty.call(over, k)) continue;
      if (k === 'fullness') continue;
      var v = over[k];
      if (v == null) continue;
      if (tables[k] && c[k] && typeof v === 'object') {
        for (var d in v) {
          if (Object.prototype.hasOwnProperty.call(v, d)) c[k][d] = v[d];
        }
      } else {
        c[k] = v;
      }
    }
    return c;
  }

  function configFor(species, seed, w, h, over) {
    var c = baseCfg(species, seed, w, h);
    var j = c.jitter;
    c.trunkX = w / 2 + (j() - 0.5) * 6;
    c.swayAmp = w * 0.008;

    if (species === 'ginkgo') {
      // 银杏：窄、高、枝几乎直立，叶子聚在短枝上
      c.cx = w / 2; c.cy = h * 0.40; c.rx = w * 0.255; c.ry = h * 0.335;
      c.trunkH = h * 0.40; c.trunkW = 24; c.lean = (j() - 0.5) * 0.03;
      c.nLimb = 5;
      c.limbOff = 0.62; c.limbTaperOff = -0.10;
      c.limbLen = w * 0.25; c.limbW = 11;
      c.maxDepth = 4;
      c.ratio = { 1: 0.72, 2: 0.66, 3: 0.62, 4: 0.58 };
      c.spread = { 1: 0.52, 2: 0.68, 3: 0.82, 4: 0.95 };
      c.fork = { 1: 0.70, 2: 0.85, 3: 0.95, 4: 0 };
      c.kids = { 1: 2, 2: 2, 3: 2, 4: 0 };
      c.reach = { 1: 0.80, 2: 0.55, 3: 0.34, 4: 0.18 };
      c.wave = 0.055; c.step = 8; c.maxSegs = 2600; c.wobble = 0.07;
      c.leafDepth = 1;
    } else if (species === 'bush') {
      // 灌木：十几根细干直接从地面分开，冠低而宽
      c.multiStem = true;
      c.stems = 13;
      c.cx = w / 2; c.cy = h * 0.60; c.rx = w * 0.355;
      c.ry = (c.floorY + 18) - c.cy;
      c.trunkH = h * 0.11; c.trunkW = 16; c.lean = 0;
      c.maxDepth = 4; c.leafDepth = 1;
      c.ratio = { 1: 0.68, 2: 0.64, 3: 0.60, 4: 0.56 };
      c.spread = { 1: 0.95, 2: 1.02, 3: 1.10, 4: 1.20 };
      c.fork = { 1: 1.00, 2: 1.10, 3: 1.15, 4: 0 };
      c.kids = { 1: 2, 2: 2, 3: 2, 4: 0 };
      c.reach = { 1: 0.36, 2: 0.24, 3: 0.16, 4: 0.10 };
      c.wave = 0.10; c.step = 8; c.wobble = 0.14;
      c.sideChance = 0.95; c.maxSegs = 3200; c.fill = 2000;
    } else {
      // 乔木：大树冠，主枝从干的中上部错落分出
      c.cx = w / 2; c.cy = h * 0.405; c.rx = w * 0.385; c.ry = h * 0.300;
      c.trunkH = h * 0.345; c.trunkW = 22; c.lean = (j() - 0.5) * 0.05;
      c.nLimb = 6;
      c.limbOff = 1.20; c.limbTaperOff = -0.26;
      c.limbLen = w * 0.30; c.limbW = 14;
      c.maxDepth = 4;
      c.ratio = { 1: 0.76, 2: 0.72, 3: 0.68, 4: 0.64 };
      c.spread = { 1: 0.82, 2: 0.96, 3: 1.06, 4: 1.16 };
      c.fork = { 1: 0.95, 2: 1.10, 3: 1.15, 4: 0 };
      c.kids = { 1: 2, 2: 2, 3: 2, 4: 0 };
      c.reach = { 1: 0.30, 2: 0.26, 3: 0.18, 4: 0.12 };
      c.wave = 0.085; c.step = 9; c.wobble = 0.11;
      c.sideChance = 0.85; c.maxSegs = 3000;
    }
    return applyOverrides(c, over);
  }

  function generateBranchingCfg(cfg) {
    var res = scaffold(cfg);
    return { segs: res.segs, tips: res.tips, crown: res.crown, cfg: cfg };
  }
  function generateBranching(species, seed, w, h, over) {
    return generateBranchingCfg(configFor(species, seed, w, h, over));
  }

  /* 垂柳：枝要往下垂。骨架上部照常，再把末梢接成一条条下垂的叶帘。 */
  function generateWillow(seed, w, h, over) {
    var cfg = baseCfg('willow', seed, w, h);
    var j = cfg.jitter;
    cfg.cx = w * 0.5; cfg.cy = h * 0.40; cfg.rx = w * 0.345; cfg.ry = h * 0.315;
    cfg.trunkX = w * 0.5 + (j() - 0.5) * 5;
    cfg.trunkH = h * 0.36; cfg.trunkW = 26; cfg.lean = (j() - 0.5) * 0.04;
    cfg.swayAmp = w * 0.014;
    cfg.nLimb = 5;
    cfg.limbOff = 1.05; cfg.limbTaperOff = -0.12;
    cfg.limbLen = w * 0.28; cfg.limbW = 13;
    cfg.maxDepth = 4;
    cfg.ratio = { 1: 0.68, 2: 0.62, 3: 0.58, 4: 0.55 };
    cfg.spread = { 1: 0.85, 2: 1.00, 3: 1.10, 4: 1.15 };
    cfg.fork = { 1: 1.00, 2: 1.10, 3: 1.15, 4: 0 };
    cfg.kids = { 1: 2, 2: 2, 3: 2, 4: 0 };
    cfg.reach = { 1: 0.45, 2: 0.28, 3: 0.16, 4: 0.10 };
    cfg.leafDepth = 2;
    cfg.wave = 0.075; cfg.step = 9; cfg.maxSegs = 2000;

    var res = scaffold(cfg);
    var segs = res.segs, tips = res.tips;
    var rnd = random(seed ^ 0x51ed);

    // 每根末段都挂一条垂下的叶帘
    var bases = [];
    for (var i = 0; i < segs.length; i++) {
      if (segs[i].depth >= 2 && segs[i].w < 4.2) bases.push(segs[i]);
    }
    var stepBase = Math.max(1, bases.length / 190);
    for (var b = 0; b < bases.length; b += stepBase) {
      var bs = bases[Math.floor(b)];
      var px = bs.x2, py = bs.y2;
      if (py > h * 0.82) continue;
      var ang = Math.PI / 2 + (rnd() - 0.5) * 0.5;
      var prevW = 1.7;
      var chainLen = 3 + (rnd() < 0.55 ? 1 : 0);
      for (var k = 0; k < chainLen; k++) {
        var cl = h * (0.055 + rnd() * 0.042);
        ang += (rnd() - 0.5) * 0.34 - 0.02;
        var nx = px + Math.cos(ang) * cl;
        var ny = py + Math.sin(ang) * cl;
        if (ny > h - 42) { ny = h - 42; }
        var side = nx >= px ? 1 : -1;
        segs.push({
          x1: px, y1: py, x2: nx, y2: ny,
          cx: (px + nx) / 2 + side * cl * 0.16,
          cy: (py + ny) / 2,
          w: prevW, depth: 8 + k, leafy: true
        });
        tips.push({ x: nx, y: ny });
        px = nx; py = ny; prevW = Math.max(0.8, prevW * 0.84);
      }
    }
    cfg.crownFill = 0;
    applyOverrides(cfg, over);
    return { segs: segs, tips: tips, crown: res.crown, cfg: cfg };
  }

  /* ---------------- 地域原型：棕榈 / 针叶 / 榕树 / 花树 ----------------
     这四种不是给乔木换颜色，是另起骨架：剪影一眼能分辨。
     都只产出 segs / tips / crown，交给下面统一的 generate() 补叶、归一化。 */

  // 棕榈：一根略弯的高干，顶上一圈放射、末端下垂的长叶
  function generatePalm(seed, w, h, over) {
    var cfg = baseCfg('palm', seed, w, h);
    var rnd = random(seed ^ 0x9a17);
    var segs = [], tips = [];
    var floorY = cfg.floorY, cx = w * 0.5;
    var topX = cx + (rnd() - 0.5) * w * 0.14;
    var topY = h * 0.24;
    var tw = Math.max(6, w * 0.038);

    function arc(x1, y1, a, len, width, depth, leafy, droop) {
      var steps = Math.max(4, Math.round(len / 9));
      var sl = len / steps, px = x1, py = y1, ang = a;
      for (var i = 0; i < steps; i++) {
        // 先上扬、过了中段被重力压弯下垂，羽叶才有椰子树那种弧
        var gravity = (i / steps - 0.42) * (droop || 0);
        ang += gravity + (rnd() - 0.5) * 0.03;
        var nx = px + Math.cos(ang) * sl, ny = py + Math.sin(ang) * sl;
        var ww = width * (1 - 0.55 * (i + 1) / steps);
        segs.push({
          x1: px, y1: py, x2: nx, y2: ny,
          cx: (px + nx) / 2 - Math.sin(ang) * sl * 0.12,
          cy: (py + ny) / 2 + Math.cos(ang) * sl * 0.12,
          w: Math.max(0.8, ww), depth: depth, leafy: !!leafy
        });
        px = nx; py = ny;
      }
      tips.push({ x: px, y: py, a: ang, depth: depth });
      return { x: px, y: py };
    }

    // 树干：轻微 S 弯，下粗上细
    var steps = 20, px = cx, py = floorY;
    for (var i = 0; i < steps; i++) {
      var u = (i + 1) / steps;
      var nx = cx + (topX - cx) * u + Math.sin(u * 3.4) * w * 0.012;
      var ny = floorY + (topY - floorY) * u;
      segs.push({
        x1: px, y1: py, x2: nx, y2: ny,
        cx: (px + nx) / 2 + Math.sin(u * 3.4) * w * 0.02, cy: (py + ny) / 2,
        w: Math.max(3, tw * (1 - 0.42 * u)), depth: 0, leafy: false, flat: i === 0
      });
      px = nx; py = ny;
    }
    // 羽状叶：从顶向两侧放射，越靠外下垂越多
    var n = 12 + (seed % 4);
    for (var k = 0; k < n; k++) {
      var t = n === 1 ? 0.5 : k / (n - 1);
      var side = t < 0.5 ? -1 : 1;
      var spread = Math.abs(t - 0.5) * 2;          // 0 中间、1 最外
      var a = -Math.PI / 2 + side * (0.30 + spread * 1.05);
      // 中间的叶子几乎直上（少下垂），越往外越先扬后垂
      var droop = 0.16 + spread * 0.95;
      arc(px, py, a, w * (0.30 + spread * 0.06), 4.2, 1, true, droop);
    }
    cfg.cx = topX; cfg.cy = topY; cfg.rx = w * 0.42; cfg.ry = h * 0.16;
    cfg.fill = 0;   // 不铺满冠心：棕榈的辨识度全在放射状羽叶上
    applyOverrides(cfg, over);
    return { segs: segs, tips: tips, crown: { cx: cfg.cx, cy: cfg.cy, rx: cfg.rx, ry: cfg.ry, w: w, h: h }, cfg: cfg };
  }

  // 针叶（松 / 杉 / 柏 / 雪松）：直干 + 层层轮生横枝，上短下长成塔形
  function generateConifer(seed, w, h, over) {
    var cfg = baseCfg('conifer', seed, w, h);
    var rnd = random(seed ^ 0x3c17);
    var segs = [], tips = [];
    var floorY = cfg.floorY, cx = w * 0.5;
    var topY = h * 0.06, tw = Math.max(6, w * 0.042);

    // 主干
    var tsteps = 20, px = cx, py = floorY;
    for (var i = 0; i < tsteps; i++) {
      var u = (i + 1) / tsteps;
      var nx = cx + Math.sin(u * 2.6) * w * 0.008;
      var ny = floorY + (topY - floorY) * u;
      segs.push({
        x1: px, y1: py, x2: nx, y2: ny,
        cx: (px + nx) / 2, cy: (py + ny) / 2,
        w: Math.max(2, tw * (1 - 0.80 * u)), depth: 0, leafy: false, flat: i === 0
      });
      px = nx; py = ny;
    }
    // 轮生枝：每层 4 枝，底层最长，往上递减 → 塔形剪影
    var tiers = 14;
    for (var t = 0; t < tiers; t++) {
      var q = t / (tiers - 1);
      var y = floorY - (floorY - topY) * q * 0.97;
      var len = w * 0.44 * Math.pow(1 - q, 0.82) * (0.86 + rnd() * 0.28);
      var perTier = 4;
      for (var b = 0; b < perTier; b++) {
        var side = b % 2 === 0 ? -1 : 1;
        var lift = (b < 2 ? 0.06 : -0.18) + (rnd() - 0.5) * 0.06;
        var a = side > 0 ? lift : Math.PI - lift;
        var L = len * (b < 2 ? 1 : 0.72);
        var steps = Math.max(3, Math.round(L / 10)), sl = L / steps;
        var bx = cx + (rnd() - 0.5) * w * 0.012, by = y, ang = a;
        for (var s = 0; s < steps; s++) {
          ang += -side * 0.035 + (rnd() - 0.5) * 0.04;   // 先平出、梢头微翘
          var nx2 = bx + Math.cos(ang) * sl * side;
          var ny2 = by + Math.sin(ang) * sl;
          segs.push({
            x1: bx, y1: by, x2: nx2, y2: ny2,
            cx: (bx + nx2) / 2, cy: (by + ny2) / 2 - sl * 0.18,
            w: Math.max(0.8, 3.6 * (1 - s / steps)), depth: 1, leafy: true
          });
          bx = nx2; by = ny2;
        }
        tips.push({ x: bx, y: by, a: ang, depth: 1 });
      }
    }
    cfg.cx = cx; cfg.cy = (floorY + topY) / 2; cfg.rx = w * 0.46; cfg.ry = (floorY - topY) / 2;
    cfg.fill = 0;   // 针叶的辨识度在层层轮生的横枝，冠心填实会糊成一把锥子
    applyOverrides(cfg, over);
    return { segs: segs, tips: tips, crown: { cx: cfg.cx, cy: cfg.cy, rx: cfg.rx, ry: cfg.ry, w: w, h: h }, cfg: cfg };
  }

  // 榕树 / 菩提：短粗干 + 极宽的低冠 + 一垂到底的气根
  function generateBanyan(seed, w, h, over) {
    var cfg = configFor('oak', seed, w, h);   // 借用乔木的冠内递归，再改比例
    var rnd = random(seed ^ 0x71b3);
    cfg.cx = w * 0.5; cfg.cy = h * 0.46;
    cfg.rx = w * 0.465; cfg.ry = h * 0.245;   // 宽而扁
    cfg.trunkH = h * 0.34; cfg.trunkW = 32; cfg.lean = (rnd() - 0.5) * 0.04;
    cfg.nLimb = 7; cfg.limbOff = 1.38; cfg.limbTaperOff = -0.34;
    cfg.limbLen = w * 0.38; cfg.limbW = 16;
    cfg.maxDepth = 4; cfg.spread = { 1: 0.98, 2: 1.12, 3: 1.20, 4: 1.24 };
    cfg.fill = 1150; cfg.sideChance = 0.92;
    applyOverrides(cfg, over);          // 繁茂度要在 scaffold 之前生效，才会多长枝
    var res = scaffold(cfg);
    var segs = res.segs, tips = res.tips;
    // 气根：从冠外缘的枝上垂下，落地前微微摆动
    var cands = tips.filter(function (p) { return p.y < cfg.cy + cfg.ry * 0.5 && Math.abs(p.x - cfg.cx) > cfg.rx * 0.42; });
    var step = Math.max(1, cands.length / 9);
    for (var i = 0; i < cands.length && i < 14; i += step) {
      var c = cands[Math.floor(i)], rx = c.x, ry = c.y;
      var ax = rx + (rnd() - 0.5) * 6;
      var segsN = 5, prevW = 2.6;
      for (var k = 0; k < segsN; k++) {
        var ny = ry + (cfg.floorY - 6 - ry) * (k + 1) / segsN;
        var nx = rx + (ax - rx) * (k + 1) / segsN + Math.sin(k * 1.3 + i) * 1.6;
        segs.push({
          x1: rx, y1: ry, x2: nx, y2: ny,
          cx: (rx + nx) / 2 + (rnd() - 0.5) * 3, cy: (ry + ny) / 2,
          w: prevW, depth: 6 + k, leafy: false
        });
        rx = nx; ry = ny; prevW = Math.max(0.9, prevW * 0.86);
      }
    }
    return { segs: segs, tips: tips, crown: res.crown, cfg: cfg };
  }

  /* 花树（樱 / 蓝花楹 / 凤凰木 / 木棉）：圆而低的冠、细密分枝。
     用乔木骨架换一组参数即可，重点是比 oak 更圆、更矮、更密。 */
  function configBlossom(seed, w, h, over) {
    var cfg = configFor('oak', seed, w, h);
    cfg.cx = w * 0.5; cfg.cy = h * 0.455;
    cfg.rx = w * 0.415; cfg.ry = h * 0.285;
    cfg.trunkH = h * 0.30; cfg.trunkW = 21; cfg.lean = (cfg.jitter() - 0.5) * 0.04;
    cfg.nLimb = 6; cfg.limbOff = 1.02; cfg.limbTaperOff = -0.18;
    cfg.limbLen = w * 0.31; cfg.limbW = 12;
    cfg.maxDepth = 4;
    cfg.ratio = { 1: 0.74, 2: 0.70, 3: 0.66, 4: 0.62 };
    cfg.spread = { 1: 0.88, 2: 1.00, 3: 1.08, 4: 1.16 };
    cfg.sideChance = 0.92; cfg.wobble = 0.13; cfg.fill = 1250;
    return applyOverrides(cfg, over);
  }

  /* 桉树：高、瘦、树干很长，冠偏在顶上、稀疏——和圆冠花树、宽冠榕树一眼不同 */
  function configGum(seed, w, h, over) {
    var cfg = configFor('oak', seed, w, h);
    cfg.cx = w * 0.5; cfg.cy = h * 0.335;
    cfg.rx = w * 0.315; cfg.ry = h * 0.245;
    cfg.trunkH = h * 0.47; cfg.trunkW = 19; cfg.lean = (cfg.jitter() - 0.5) * 0.07;
    cfg.nLimb = 5; cfg.limbOff = 0.92; cfg.limbTaperOff = -0.10;
    cfg.limbLen = w * 0.26; cfg.limbW = 11;
    cfg.maxDepth = 4;
    cfg.ratio = { 1: 0.70, 2: 0.66, 3: 0.62, 4: 0.58 };
    cfg.spread = { 1: 0.70, 2: 0.84, 3: 0.96, 4: 1.06 };
    cfg.sideChance = 0.72; cfg.wobble = 0.10; cfg.fill = 620;
    return applyOverrides(cfg, over);
  }

  function generate(species, seed, w, h, over) {
    var isWillow = species === 'willow';
    var fullness = (over && over.fullness) || 0;    // 0..1，照片带来的繁茂度
    var data;
    if (species === 'palm') data = generatePalm(seed, w, h, over);
    else if (species === 'conifer') data = generateConifer(seed, w, h, over);
    else if (species === 'gum') data = generateBranchingCfg(configGum(seed, w, h, over));
    else if (species === 'banyan') data = generateBanyan(seed, w, h, over);
    else if (species === 'blossom') {
      data = generateBranchingCfg(configBlossom(seed, w, h, over));
    }
    else data = isWillow
      ? generateWillow(seed, w, h, over)
      : generateBranching(species, seed, w, h, over);
    var leafCap = isWillow ? 3600 : 5600;
    var fillCap = isWillow ? 4200 : 7600;
    leafCap = Math.round(leafCap * (1 + fullness * 0.55));
    fillCap = Math.round(fillCap * (1 + fullness * 0.45));
    var anchors = sampleDown(leafAnchors(data.segs, species, fullness), isWillow ? 1200 : 1700);
    anchors = clumpLeaves(anchors, seed);
    anchors = sampleDown(anchors, leafCap);
    data.cfg.tipList = data.tips;
    var baseFill = data.cfg.fill != null ? data.cfg.fill : 900;
    var fillN = Math.round((isWillow ? 0 : baseFill) * (1 + fullness * 0.6));
    var fill = crownFill(data.cfg, fillN, seed);
    if (fill.length) anchors = sampleDown(anchors.concat(fill), fillCap);
    normalize(data.segs, data.tips, w, h, isWillow ? 24 : 28, anchors);
    data.leaves = anchors;
    return data;
  }

  window.TreeForms = { generate: generate, pointOn: pointOn, random: random };
})();
