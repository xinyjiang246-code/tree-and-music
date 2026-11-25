/* =========================================================
   单树画法样张（方案 A）
   - 只画一棵：同一颗种子、同一套纸墨、同一尺寸
   - 左边：现状（骨架等宽描边 + 叶点）
   - 右边：方案 A（树干锥度与分叉接合、三/四级枝递进、叶团、统一左上光向、树下投影）
   - 不改 index / grove / world3d / melody，也不改 forms.js 的生成规则
   ========================================================= */
(function () {
  'use strict';

  var W = 560, H = 680, SEED = 1758;
  var horizon = H * 0.72;
  var baseY = H - 17;

  var P = {
    barkDark: '#2A3626',
    barkMid: '#3C4B32',
    barkLight: '#6C7B52',
    leafDark: '#2F3C29',
    leafMid: '#5E7045',
    leafLight: '#94A369',
    leafEdge: '#B7BF8B',
    dry: '#8E6B45',
    paper: '#F2ECE1',
    sun: 'rgba(255,250,232,0.55)'
  };

  function hash(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return Math.abs(h) % 900000 + 1000;
  }
  function rng(seed) {
    var s = seed >>> 0;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  function h2(k) { return hash(String(k)); }

  var data = null;
  var dataCache = {};
  var CUR_SEED = SEED;
  function tree() {
    if (!data) data = window.TreeForms.generate('oak', SEED, W, H);
    return data;
  }
  function dataFor(seed, species, over) {
    var sp = species || 'oak';
    // 形态参数是第三维：同一 seed 配不同曲调 → 不同形状，彼此缓存隔离
    var k = sp + '|' + seed + (over ? '|' + JSON.stringify(over) : '');
    if (!dataCache[k]) dataCache[k] = window.TreeForms.generate(sp, seed, W, H, over);
    return dataCache[k];
  }

  // 冠干比例修正（不改 forms.js）：只压光杆、不动冠内间距；冠略放宽
  // 上一版把整棵树按 u^1.5 重映射，冠被纵向拉开 40%，叶团才散成一颗颗球。
  // 现在分段：分叉以下是"光杆"，压到 74%；分叉以上只做横向放宽，纵向等比。
  function shapeOf(d) {
    if (d.__shaped) return d.__shaped;
    var c = d.crown || { cx: W / 2, cy: H * 0.36, rx: W * 0.42, ry: H * 0.32 };
    var minY = H;
    d.segs.forEach(function (s) { minY = Math.min(minY, s.y1, s.y2); });
    (d.leaves || []).forEach(function (p) { minY = Math.min(minY, p.y); });
    var span = Math.max(1, baseY - minY);

    // 分叉处：冠底再往下让一点，保证主枝分叉落在被压缩的"光杆"之上
    var yb = Math.min(baseY - span * 0.22, c.cy + c.ry * 0.96);
    var k = 0.58;
    var yb2 = baseY - (baseY - yb) * k;
    function wy(y) {
      if (y >= yb) return baseY - (baseY - y) * k;
      return yb2 - (yb - y);
    }
    // 冠部横向放宽到 1.10：冠宽/树高回到 0.75–0.9；树干基本不动
    function wx(x, y) {
      var q = (yb - y) / Math.max(1, yb - minY);
      q = Math.max(0, Math.min(1, q));
      return c.cx + (x - c.cx) * (1 + 0.10 * q);
    }

    var segs = d.segs.map(function (s) {
      return {
        x1: wx(s.x1, s.y1), y1: wy(s.y1),
        cx: wx(s.cx, s.cy), cy: wy(s.cy),
        x2: wx(s.x2, s.y2), y2: wy(s.y2),
        w: s.w, depth: s.depth
      };
    });
    var leaves = (d.leaves || []).map(function (p) { return { x: wx(p.x, p.y), y: wy(p.y) }; });
    var tips = (d.tips || []).map(function (p) {
      var o = {};
      for (var kk in p) if (Object.prototype.hasOwnProperty.call(p, kk)) o[kk] = p[kk];
      o.x = wx(p.x, p.y); o.y = wy(p.y);
      return o;
    });
    d.__shaped = {
      segs: segs, leaves: leaves, tips: tips,
      crown: { cx: wx(c.cx, c.cy), cy: wy(c.cy), rx: c.rx * 1.10, ry: c.ry },
      wx: wx, wy: wy
    };
    return d.__shaped;
  }

  /* —— 背景：A 纸面留白 / B 地貌加空气透视 —— */
  var PAPER = '#F4EFE5';

  function backdrop(g, soft, variant, crown, plain) {
    // 天空就是纸：不平涂
    g.fillStyle = PAPER;
    g.fillRect(0, 0, W, H);

    if (variant === 'b') {
      // 远丘：低对比、偏冷，越远越淡
      g.fillStyle = 'rgba(210,212,201,0.50)';
      g.beginPath();
      g.moveTo(0, horizon - 26);
      g.quadraticCurveTo(W * 0.18, horizon - 48, W * 0.38, horizon - 30);
      g.quadraticCurveTo(W * 0.62, horizon - 10, W * 0.82, horizon - 34);
      g.quadraticCurveTo(W * 0.93, horizon - 44, W, horizon - 28);
      g.lineTo(W, horizon + 4); g.lineTo(0, horizon + 4); g.closePath(); g.fill();

      g.fillStyle = 'rgba(203,198,183,0.42)';
      g.beginPath();
      g.moveTo(0, horizon - 8);
      g.quadraticCurveTo(W * 0.22, horizon - 24, W * 0.44, horizon - 6);
      g.quadraticCurveTo(W * 0.66, horizon + 8, W * 0.86, horizon - 12);
      g.quadraticCurveTo(W * 0.94, horizon - 18, W, horizon - 8);
      g.lineTo(W, horizon + 6); g.lineTo(0, horizon + 6); g.closePath(); g.fill();

      // 地平线一条薄雾，不是块面
      var hz = g.createLinearGradient(0, horizon - 70, 0, horizon + 34);
      hz.addColorStop(0, 'rgba(246,242,232,0)');
      hz.addColorStop(0.55, 'rgba(246,242,232,0.55)');
      hz.addColorStop(1, 'rgba(241,234,220,0)');
      g.fillStyle = hz;
      g.fillRect(0, horizon - 70, W, 104);

      // 地面：近暖远冷；往画面下缘很快虚掉，没有颗粒
      var gb = g.createLinearGradient(0, horizon - 16, 0, H);
      gb.addColorStop(0, 'rgba(220,217,205,0)');
      gb.addColorStop(0.10, 'rgba(220,217,205,0.72)');
      gb.addColorStop(0.35, 'rgba(225,218,202,0.52)');
      gb.addColorStop(0.85, 'rgba(233,224,206,0.18)');
      gb.addColorStop(1, 'rgba(238,230,214,0)');
      g.fillStyle = gb;
      g.fillRect(0, horizon - 16, W, H - horizon + 16);
    } else {
      // A：贴地平线一条极窄的暖灰，别处不画
      var hb = g.createLinearGradient(0, horizon - 46, 0, horizon + 26);
      hb.addColorStop(0, 'rgba(226,218,203,0)');
      hb.addColorStop(0.55, 'rgba(224,215,199,0.32)');
      hb.addColorStop(1, 'rgba(226,217,201,0)');
      g.fillStyle = hb;
      g.fillRect(0, horizon - 46, W, 72);

      // 只余一抹地：从地平线往下，很快虚掉（不起头，避免一条横切线）
      if (!plain) {
        var ga = g.createLinearGradient(0, horizon - 18, 0, H * 0.94);
        ga.addColorStop(0, 'rgba(224,216,200,0)');
        ga.addColorStop(0.16, 'rgba(224,216,200,0.30)');
        ga.addColorStop(0.5, 'rgba(228,220,204,0.12)');
        ga.addColorStop(1, 'rgba(232,225,210,0)');
        g.fillStyle = ga;
        g.fillRect(0, horizon - 18, W, H - horizon + 18);
      }

      // 根下一小片土色：留一点点地，不是沙地
      if (!plain) {
        var soil = g.createRadialGradient(W * 0.5, baseY - 3, 4, W * 0.5, baseY - 3, 62);
        soil.addColorStop(0, 'rgba(203,193,172,0.38)');
        soil.addColorStop(0.55, 'rgba(206,196,175,0.16)');
        soil.addColorStop(1, 'rgba(206,196,175,0)');
        g.fillStyle = soil;
        g.beginPath();
        g.ellipse(W * 0.5, baseY - 3, 62, 18, 0, 0, 6.283);
        g.fill();
      }
    }

    // 冠后极轻地压暗：树从纸里浮出来（A 更轻，别读成一个灰盘）
    if (crown && !plain) {
      var cr = Math.max(crown.rx, crown.ry) * 1.16;
      var a0 = variant === 'b' ? 0.025 : 0.006;
      var cd = g.createRadialGradient(crown.cx, crown.cy, cr * 0.22, crown.cx, crown.cy, cr);
      cd.addColorStop(0, 'rgba(138,132,114,' + a0 + ')');
      cd.addColorStop(0.7, 'rgba(138,132,114,' + (a0 * 0.42).toFixed(3) + ')');
      cd.addColorStop(1, 'rgba(138,132,114,0)');
      g.fillStyle = cd;
      g.beginPath();
      g.ellipse(crown.cx, crown.cy, cr, cr * 0.92, 0, 0, 6.283);
      g.fill();
    }

    if (plain) return;

    // 根下往外迅速变亮变虚：只余一抹地
    var bl = g.createRadialGradient(W * 0.5, baseY - 8, 8, W * 0.5, baseY - 8, variant === 'a' ? 172 : 142);
    bl.addColorStop(0, 'rgba(250,246,236,' + (variant === 'a' ? '0.30' : '0.22') + ')');
    bl.addColorStop(0.55, 'rgba(250,246,236,0.09)');
    bl.addColorStop(1, 'rgba(250,246,236,0)');
    g.fillStyle = bl;
    g.beginPath();
    g.ellipse(W * 0.5, baseY - 8, 182, 82, 0, 0, 6.283);
    g.fill();

    // 树下投影：光从左上来，影子略偏右下
    if (soft) softShadow(g, SEED);
    else {
      var sx = W * 0.52 + 22, sy = baseY + 2;
      var sh = g.createRadialGradient(sx, sy, 2, sx, sy, 96);
      sh.addColorStop(0, 'rgba(40,50,34,0.30)');
      sh.addColorStop(0.45, 'rgba(40,50,34,0.17)');
      sh.addColorStop(1, 'rgba(40,50,34,0)');
      g.fillStyle = sh;
      g.beginPath();
      g.ellipse(sx, sy, 96, 15, 0, 0, 6.283);
      g.fill();
    }
  }

  // 近根更深、顺光方向拉长、边缘破碎；不做完整椭圆
  function softShadow(g, seed, bx, by) {
    if (bx == null) bx = W * 0.5;
    if (by == null) by = baseY;
    var r = rng(hash('shadow#' + (seed || 1758)));

    // 近根的接触暗：一小片，贴着地面
    var core = g.createRadialGradient(bx + 4, by + 1, 1, bx + 4, by + 1, 36);
    core.addColorStop(0, 'rgba(38,48,32,0.32)');
    core.addColorStop(0.5, 'rgba(38,48,32,0.13)');
    core.addColorStop(1, 'rgba(38,48,32,0)');
    g.fillStyle = core;
    g.beginPath();
    g.ellipse(bx + 4, by + 1, 34, 11, 0, 0, 6.283);
    g.fill();

    // 顺着光（往右下）拉长的碎影：一串越来越淡的软斑，彼此错开
    for (var i = 0; i < 18; i++) {
      var u = i / 17;
      var x = bx + 12 + u * 88 + (r() - 0.5) * 16;
      var y = by + 1 + u * 5 + Math.sin(x * 0.055) * 1.6 + (r() - 0.5) * 3;
      var rx = 13 + u * 26, ry = 3.6 + u * 5;
      var a = 0.20 * (1 - u) * (1 - u) + 0.02;
      var gr = g.createRadialGradient(x, y, 0, x, y, rx);
      gr.addColorStop(0, 'rgba(40,50,34,' + a.toFixed(3) + ')');
      gr.addColorStop(0.6, 'rgba(40,50,34,' + (a * 0.45).toFixed(3) + ')');
      gr.addColorStop(1, 'rgba(40,50,34,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.ellipse(x, y, rx, ry, 0, 0, 6.283);
      g.fill();
    }

    // 影缘的碎斑：几粒很小的，边缘才不齐
    for (var j = 0; j < 9; j++) {
      var px = bx + 18 + r() * 92;
      var py = by + 3 + Math.sin(px * 0.055) * 1.6 + (r() - 0.5) * 7;
      var pr = 2 + r() * 6;
      g.fillStyle = 'rgba(40,50,34,' + (0.03 + r() * 0.05).toFixed(3) + ')';
      g.beginPath();
      g.ellipse(px, py, pr, pr * 0.35, 0, 0, 6.283);
      g.fill();
    }
  }

  /* —— 现状：等宽描边 + 叶点 —— */
  function drawOld(g) {
    var d = tree();
    g.save();
    var grad = g.createLinearGradient(0, H, 0, 0);
    grad.addColorStop(0, P.barkDark);
    grad.addColorStop(0.66, P.barkDark);
    grad.addColorStop(1, P.barkMid);
    g.strokeStyle = grad;
    g.lineCap = 'round';
    d.segs.forEach(function (s) {
      g.lineWidth = Math.max(0.7, s.w);
      g.beginPath();
      g.moveTo(s.x1, s.y1);
      g.quadraticCurveTo(s.cx, s.cy, s.x2, s.y2);
      g.stroke();
    });
    var leaves = d.leaves || [];
    for (var i = 0; i < leaves.length; i += 3) {
      g.globalAlpha = 0.30 + (i % 5) * 0.05;
      g.fillStyle = i % 7 === 0 ? P.dry : P.leafMid;
      g.beginPath();
      g.arc(leaves[i].x, leaves[i].y, 2.2, 0, 6.283);
      g.fill();
    }
    g.globalAlpha = 1;
    g.restore();
  }

  /* —— 方案 A —— */
  var ellCount = 0;
  function ell(g, x, y, rx, ry, rot) {
    g.beginPath();
    g.ellipse(x, y, Math.max(0.6, rx), Math.max(0.5, ry), rot || 0, 0, 6.283);
    g.fill();
    ellCount++;
  }

  // 一根枝：采样成有锥度的多边形；两端各补一个圆，分叉处才不会出现"管子插进去"的断面
  function branchShape(g, s, widthK, taper, shift, cap) {
    var N = 6, L = [], R = [], Wd = [];
    for (var i = 0; i <= N; i++) {
      var t = i / N, u = 1 - t;
      var x = u * u * s.x1 + 2 * u * t * s.cx + t * t * s.x2;
      var y = u * u * s.y1 + 2 * u * t * s.cy + t * t * s.y2;
      var tx = 2 * u * (s.cx - s.x1) + 2 * t * (s.x2 - s.cx);
      var ty = 2 * u * (s.cy - s.y1) + 2 * t * (s.y2 - s.cy);
      var len = Math.hypot(tx, ty) || 1;
      var nx = -ty / len, ny = tx / len;
      // 光从左上来：把法线翻到朝光的一侧
      if (nx * -0.62 + ny * -0.78 < 0) { nx = -nx; ny = -ny; }
      var w = s.w0 != null
        ? (s.w0 + (s.w1 - s.w0) * t) * widthK
        : s.w * widthK * (1 - taper * t);
      w = Math.max(0.55, w);
      Wd.push(w);
      L.push([x + nx * (w / 2 + shift), y + ny * (w / 2 + shift)]);
      R.push([x - nx * (w / 2 - shift), y - ny * (w / 2 - shift)]);
    }
    g.beginPath();
    g.moveTo(L[0][0], L[0][1]);
    for (var a = 1; a <= N; a++) g.lineTo(L[a][0], L[a][1]);
    for (var b = N; b >= 0; b--) g.lineTo(R[b][0], R[b][1]);
    g.closePath();
    g.fill();
    if (cap) {
      g.beginPath();
      g.arc(s.x1, s.y1, Math.max(0.6, Wd[0] / 2 + shift), 0, 6.283);
      g.fill();
    }
    return Wd[N];
  }

  // 按深度放粗：主干最粗、越细的枝放大得越少，分叉处口径才不会突然收细。
  // 照片树不做这层放大：枝宽是从剪影量出来的，宁细不粗。
  function widthK(depth) {
    if (PAINT_MODE === 'photo') return 1.0;
    if (depth <= 0) return 1.40;
    if (depth === 1) return 1.34;
    if (depth === 2) return 1.20;
    if (depth === 3) return 1.08;
    return 1.0;
  }

  function drawBranches(g, list) {
    // 暗面先铺一遍：同一层的枝在同一遍里，接合处不会出现亮边缝
    var photoBark = PAINT_MODE === 'photo';
    list.forEach(function (s) {
      var bw = s.w0 != null ? (s.w0 + s.w1) / 2 : s.w;
      // 照片树的枝沿用主干的同一套色阶：交接处不会一根棕、一根黑
      g.fillStyle = photoBark
        ? (bw > 5 ? '#4C4134' : (bw > 2 ? '#544737' : '#463D30'))
        : (bw > 5 ? '#332B21' : (bw > 2 ? '#463D30' : '#332B21'));
      branchShape(g, s, widthK(s.depth), 0.18, 0, true);
    });
    // 再补受光侧的一道细边缘光：只占一侧、很窄，暗部里的枝才浮得出来
    // 照片树把这道理光放宽、压淡：细线在高亮冠面上会读成"空心管"的轮廓，
    // 宽一点就是"受光的一面"，不再是描边
    list.forEach(function (s) {
      var bw = s.w0 != null ? (s.w0 + s.w1) / 2 : s.w;
      if (bw < 1.0) return;
      g.fillStyle = photoBark ? 'rgba(170,166,134,0.22)' : 'rgba(182,180,146,0.30)';
      branchShape(g, s, (photoBark ? 0.40 : 0.22) * widthK(s.depth), 0.30, bw * (photoBark ? 0.24 : 0.20), false);
    });
    // 右下再压一道很淡的暗边，光向才统一
    list.forEach(function (s) {
      var bw = s.w0 != null ? (s.w0 + s.w1) / 2 : s.w;
      if (bw < 1.6) return;
      g.fillStyle = 'rgba(46,54,46,0.20)';
      branchShape(g, s, 0.26 * widthK(s.depth), 0.22, -bw * 0.20, false);
    });
  }

  /* —— 主干：锥度、根盘、轻微弯曲、树皮纵向起伏、分叉接合 —— */
  function pointOnSeg(s, t) {
    var u = 1 - t;
    return { x: u * u * s.x1 + 2 * u * t * s.cx + t * t * s.x2, y: u * u * s.y1 + 2 * u * t * s.cy + t * t * s.y2 };
  }

  function drawTrunk(g, segs) {
    if (!segs.length) return { x: W / 2, y: baseY };

    // 根也是 depth 0：细的那几根单独当根画，别混进主干中心线（否则底部会鼓成一只鞋）
    var photoTrunk = PAINT_MODE === 'photo';
    var wmax = 0;
    segs.forEach(function (s) { wmax = Math.max(wmax, s.w); });
    // 照片树的 depth 0 已经只含贴着主干中线的段，全部算主干；
    // 程序树仍按粗细挑主干，避免细根混进来
    var main = photoTrunk ? segs : segs.filter(function (s) { return s.w >= wmax * 0.55; });
    var roots = photoTrunk ? [] : segs.filter(function (s) { return s.w < wmax * 0.55; });
    if (main.length < 3) main = segs;

    // 根段不单独画：form 的根很短，画出来会在脚下鼓成一只"鞋"；
    // 根盘靠主干的基部外扩 + 土色过渡 + 影子来交代。
    void roots;

    var raw = [];
    main.forEach(function (s) {
      for (var i = 0; i <= 4; i++) {
        var p = pointOnSeg(s, i / 4);
        var sw = s.w0 != null ? (s.w0 + (s.w1 - s.w0) * (i / 4)) : s.w;
        raw.push({ x: p.x, y: p.y, w: Math.max(3, sw) });
      }
    });
    raw.sort(function (a, b) { return b.y - a.y; });
    var pts = [];
    raw.forEach(function (p) {
      if (!pts.length || Math.abs(p.y - pts[pts.length - 1].y) > 1.5) pts.push(p);
    });
    if (pts.length < 3) return { x: W / 2, y: baseY };

    var y0 = pts[0].y, y1 = pts[pts.length - 1].y;
    var span = Math.max(1, y0 - y1);
    var W0 = Math.max(7, pts[0].w);
    var baseX = pts[0].x;
    var lean = ((hash('lean' + CUR_SEED) % 100) / 100 - 0.45) * 9;

    var N = 48, L = [], R = [], XC = [], WW = [];
    var k = 0;
    for (var i = 0; i <= N; i++) {
      var u = i / N;
      var y = y0 - u * span;
      while (k < pts.length - 2 && pts[k + 1].y > y) k++;
      var a = pts[k], b = pts[Math.min(pts.length - 1, k + 1)];
      var tt = (a.y === b.y) ? 0 : (a.y - y) / (a.y - b.y);
      tt = Math.max(0, Math.min(1, tt));
      var x = a.x + (b.x - a.x) * tt;
      var w = a.w + (b.w - a.w) * tt;

      // 干径整体放粗 1.38×（与枝的 widthK 同一比例）；照片树直接用量出来的宽度，
      // 但保留一点向上收锥与轻微弯曲，免得读成一根方木桩
      WW.push(photoTrunk ? Math.max(3, w * (1 - 0.16 * u)) : w * (1 - 0.46 * u) * 1.38);
      if (photoTrunk) x += Math.sin(u * 1.6 + 0.5) * 1.2;
      else x += Math.sin(u * 1.7 + 0.4) * 2.0 + lean * u;   // 轻微弯曲 + 倾斜
      XC.push(x);
    }

    // 照片树：剪影底部常把地面/影子算进干径，照着画会在脚下鼓成一只"靴子"。
    // 取干身中段的宽度做基准，往上略微收锥，底部不再跟着距离场膨胀。
    if (photoTrunk) {
      var topW = WW[N] || 6;
      var midW = WW.slice(Math.round(N * 0.25), Math.round(N * 0.7)).sort(function (a, b) { return a - b; });
      var medW = midW[Math.floor(midW.length / 2)] || topW;
      // 一条平滑锥度，从基部到干顶；不再照抄剪影的逐点宽度，
      // 否则"地面/影子"和"冠底"两处会各鼓出一个台阶（靴子与领子）。
      var baseW2 = Math.max(topW * 1.12, medW);
      // 中线也拉直：剪影里的干被地面/影子断成两段时，两段 x 会错开几像素，
      // 照抄就会出现一道横向的"领口"。只在两端之间线性过渡，台阶就没了。
      var xBase = XC[0], xTop = XC[N];
      for (var wi = 0; wi <= N; wi++) {
        WW[wi] = baseW2 + (topW - baseW2) * (wi / N);
        XC[wi] = xBase + (xTop - xBase) * (wi / N);
      }
    }

    // form 的根段比干身粗，直接照用会在脚下鼓成一圈裙边。
    // 基部口径取 form 的底径（已乘 1.38），往上按固定锥度收：直、顺，贴地不鼓包。
    // 照片树不做这层重设：宽度已经是剪影里量出来的。
    var kTaper = 0.46;
    var baseW = WW[0];
    for (var q1 = 0; q1 <= N; q1++) {
      var u1 = q1 / N;
      if (!photoTrunk) WW[q1] = baseW * (1 - kTaper * u1);
      var n1 = Math.sin(u1 * 23 + 1.3) * 0.045 + Math.sin(u1 * 47 + 0.2) * 0.02;
      var n2 = Math.sin(u1 * 19 + 2.7) * 0.038 + Math.sin(u1 * 39 + 1.1) * 0.02;
      L.push([XC[q1] - WW[q1] * (0.5 + n1), y0 - u1 * span]);
      R.push([XC[q1] + WW[q1] * (0.5 + n2), y0 - u1 * span]);
    }

    // 主体：先铺一层中间色，再按每一行的左右边缘铺横向渐变。
    // 单一整幅渐变会被干径的锥度挤到中间几档色，受光边就消失（读成一根黑管）；
    // 逐行渐变才能让"左亮右暗"始终贴着干的宽度。
    g.fillStyle = '#4B5538';
    g.beginPath();
    g.moveTo(L[0][0], L[0][1]);
    for (var m = 1; m <= N; m++) g.lineTo(L[m][0], L[m][1]);
    for (var n = N; n >= 0; n--) g.lineTo(R[n][0], R[n][1]);
    g.closePath();
    g.fill();

    // 树皮：纵向的明暗起伏，贴着树干描，不越界
    g.save();
    g.beginPath();
    g.moveTo(L[0][0], L[0][1]);
    for (var m2 = 1; m2 <= N; m2++) g.lineTo(L[m2][0], L[m2][1]);
    for (var n2 = N; n2 >= 0; n2--) g.lineTo(R[n2][0], R[n2][1]);
    g.closePath();
    g.clip();

    for (var q0 = 0; q0 < N; q0++) {
      var lx = Math.min(L[q0][0], L[q0 + 1][0]) - 1;
      var rx = Math.max(R[q0][0], R[q0 + 1][0]) + 1;
      if (rx - lx < 0.8) continue;
      var bg = g.createLinearGradient(lx, 0, rx, 0);
      // 照片树的干压暗一档：枝是同一套褐色，干若太亮，分叉处会读出一条色差
      bg.addColorStop(0, photoTrunk ? '#6F6150' : '#8B7C66');
      bg.addColorStop(0.26, photoTrunk ? '#5B4E3D' : '#6C5E4B');
      bg.addColorStop(0.64, '#4C4134');
      bg.addColorStop(1, '#332C24');
      g.fillStyle = bg;
      // 按相邻两行的间距铺满，别留成一条条横缝
      var yTop = Math.min(L[q0][1], L[q0 + 1][1]) - 0.4;
      var yBot = Math.max(L[q0][1], L[q0 + 1][1]) + 0.4;
      g.fillRect(lx, yTop, rx - lx, yBot - yTop);
    }

    for (var b2 = 0; b2 < 17; b2++) {
      var rr = rng(h2('bark' + b2 + '_' + CUR_SEED));
      var frac = 0.08 + (b2 / 16) * 0.84;
      g.beginPath();
      for (var q = 0; q <= N; q += 2) {
        var wdt = R[q][0] - L[q][0];
        var px = L[q][0] + wdt * (frac + Math.sin(q * 0.5 + b2 * 1.7) * 0.018);
        var py = L[q][1];
        if (q === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      var light = frac < 0.45;
      g.strokeStyle = light
        ? 'rgba(166,152,128,' + (0.09 + rr() * 0.12).toFixed(3) + ')'
        : 'rgba(46,40,32,' + (0.08 + rr() * 0.11).toFixed(3) + ')';
      g.lineWidth = 0.9 + rr() * 1.7;
      g.stroke();
    }
    g.restore();

    return { x: XC[0], y: y0 };
  }

  // 树干底部化进土里：一小片很淡的土色，不要一摊浅色水洼
  function soilFade(g, bx, by, seed) {
    var m = g.createRadialGradient(bx, by - 1, 2, bx, by - 1, 24);
    m.addColorStop(0, 'rgba(202,193,171,0.24)');
    m.addColorStop(0.55, 'rgba(202,193,171,0.10)');
    m.addColorStop(1, 'rgba(202,193,171,0)');
    g.fillStyle = m;
    g.beginPath();
    g.ellipse(bx, by - 1, 26, 7, 0, 0, 6.283);
    g.fill();

    // 边缘再撒两三点土色，断掉那条整齐的轮廓
    var rr = rng(hash('soil' + (seed || SEED)));
    for (var i = 0; i < 5; i++) {
      var px = bx + (rr() - 0.5) * 40;
      var py = by + 1 + (rr() - 0.5) * 4;
      g.fillStyle = 'rgba(204,195,173,' + (0.10 + rr() * 0.14).toFixed(3) + ')';
      g.beginPath();
      g.ellipse(px, py, 2 + rr() * 5, 1.2 + rr() * 2, rr() * 3, 0, 6.283);
      g.fill();
    }

    var c = g.createRadialGradient(bx, by - 3, 2, bx, by - 3, 20);
    c.addColorStop(0, 'rgba(46,58,40,0.12)');
    c.addColorStop(1, 'rgba(46,58,40,0)');
    g.fillStyle = c;
    g.beginPath();
    g.ellipse(bx, by - 3, 20, 6, 0, 0, 6.283);
    g.fill();
  }

  // 冠上的几处叶隙（负空间）：成簇、不均匀；只有前面的叶团让开，
  // 透出来的是纸（或枝），不是满屏噪点
  var HOLES = null;

  function leafMass(g, cx, cy, seed, scale, light, outer, holesOn, low) {
    var r = rng(seed);
    // 冠内补密：越靠冠心，叶团越大、叶越大，底下多一层"叶肉"把相邻团的纸缝搭住；
    // 冠缘（outer≈1）与冠底（low≈1）几乎不加，参差与透枝要留着
    var dens = Math.max(0, Math.min(1, (0.90 - outer) / 0.55));
    dens *= 1 - 0.55 * Math.max(0, Math.min(1, ((low || 0) - 0.20) / 0.75));
    var R = (14 + r() * 7) * scale * (1 + 0.18 * dens);
    var i, a, d, x, y, lit, tone;
    var lobeA = r() * 6.283, lobeK = 0.10 + r() * 0.12;

    // 暗底：薄薄一层，主要用来把相邻的团黏在一起，不留球与球之间的纸缝
    for (i = 0; i < 4; i++) {
      var aa = lobeA + i * 1.9;
      var dd = R * (0.20 + 0.52 * (i / 3));
      g.fillStyle = 'rgba(58,66,58,' + (0.024 + r() * 0.028).toFixed(3) + ')';
      ell(g, cx + Math.cos(aa) * dd * 0.72, cy + Math.sin(aa) * dd * 0.48,
        R * (0.66 + r() * 0.34), R * (0.54 + r() * 0.26), r() * 3);
    }

    // 冠内补缝：两片大的暗叶肉，跨过团与团之间那道细缝。
    // 只垫在叶底下、只在冠内，冠缘不垫，否则边缘会糊成一条
    if (dens > 0.12) {
      for (i = 0; i < 2; i++) {
        g.fillStyle = 'rgba(64,74,58,' + (0.045 + 0.045 * dens).toFixed(3) + ')';
        ell(g, cx + (r() - 0.5) * R * 0.28, cy + (r() - 0.5) * R * 0.22,
          R * (1.00 + 0.18 * dens), R * (0.82 + 0.14 * dens), r() * 3);
      }
    }

    // 叶群：几十片小椭圆；受光按整冠的方向，不再按本团的方位
    var n = 88 + Math.floor(r() * 28 + 16 * dens);
    for (i = 0; i < n; i++) {
      a = r() * 6.283;
      d = Math.sqrt(r()) * R * (1 + lobeK * Math.sin(a * 3 + lobeA));
      x = cx + Math.cos(a) * d;
      y = cy + Math.sin(a) * d * 0.94;

      // 叶隙：前面的叶让开这几处，暗部里才透出背景亮点
      if (holesOn && HOLES) {
        var skip = false;
        for (var h = 0; h < HOLES.length; h++) {
          var hx = x - HOLES[h].x, hy = y - HOLES[h].y;
          if (hx * hx + hy * hy < HOLES[h].r * HOLES[h].r) { skip = true; break; }
        }
        if (skip) continue;
      }

      lit = light + (r() - 0.5) * 0.55;
      var al;
      if (lit > 0.30) { tone = 'rgba(148,154,112,'; al = 0.42 + r() * 0.14; }
      else if (lit < -0.14) { tone = 'rgba(54,64,58,'; al = 0.56 + r() * 0.18; }
      else { tone = 'rgba(76,88,66,'; al = 0.54 + r() * 0.16; }
      g.fillStyle = tone + al.toFixed(3) + ')';
      // 冠内的叶也跟着密一点：叶更大，覆盖就连成片，不是撒更多颗粒
      ell(g, x, y, (3.2 + r() * 3.2) * (1 + 0.24 * dens), (1.5 + r() * 0.7) * (1 + 0.14 * dens), r() * 3);
    }

    // 边缘透光：只给冠缘的团，很小；团内不做，否则每团都镶一圈亮边
    if (outer > 0.55) {
      for (i = 0; i < 3; i++) {
        a = -2.3 + r() * 1.7;
        d = R * (0.92 + r() * 0.32);
        g.fillStyle = 'rgba(186,192,146,' + (0.07 + r() * 0.09).toFixed(3) + ')';
        ell(g, cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.9,
          1.3 + r() * 1.9, 1.0 + r() * 1.4, r() * 3);
      }
    }
    if (r() < 0.10) {
      g.fillStyle = 'rgba(142,107,69,0.20)';
      ell(g, cx + (r() - 0.5) * R, cy + (r() - 0.5) * R, 1.8 + r() * 1.8, 1.0 + r(), r() * 3);
    }
  }

  /* 照片树的叶团：沿枝的柔和光斑，不是盖满整冠的小椭圆网。
     每团只放几片大而软的叶簇，颜色贴着照片叶面，边缘自然化开。 */
  function leafMassSoft(g, cx, cy, seed, scale, light, outer, low) {
    var r = rng(seed);
    var R = (16 + r() * 8) * scale;
    var n = 10 + Math.floor(r() * 4);
    for (var i = 0; i < n; i++) {
      var a = r() * 6.283;
      var d = Math.sqrt(r()) * R * 0.95;
      var x = cx + Math.cos(a) * d;
      var y = cy + Math.sin(a) * d * 0.9;
      var rr = R * (0.62 + r() * 0.34);
      var lit = light + (r() - 0.5) * 0.55;
      var col = lit > 0.22 ? [120, 132, 90]
        : (lit < -0.16 ? [44, 54, 42] : [82, 94, 62]);
      var al = (low ? 0.12 : 0.10) + r() * (low ? 0.05 : 0.06);
      var grd = g.createRadialGradient(x, y, rr * 0.12, x, y, rr);
      grd.addColorStop(0, 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',' + al.toFixed(3) + ')');
      grd.addColorStop(0.62, 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',' + (al * 0.55).toFixed(3) + ')');
      grd.addColorStop(1, 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',0)');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(x, y, rr, 0, 6.283);
      g.fill();
    }
    // 冠缘一点透光，别让轮廓变成一条实线
    if (outer > 0.6) {
      for (var k = 0; k < 2; k++) {
        var aa = -2.3 + r() * 1.7;
        var dd = R * (0.92 + r() * 0.3);
        g.fillStyle = 'rgba(196,198,150,' + (0.04 + r() * 0.05).toFixed(3) + ')';
        g.beginPath();
        g.ellipse(cx + Math.cos(aa) * dd, cy + Math.sin(aa) * dd * 0.9,
          2.2 + r() * 2.4, 1.4 + r() * 1.4, r() * 3, 0, 6.283);
        g.fill();
      }
    }
  }

  function buildClumps(d, cell) {
    var leaves = d.leaves || [];
    cell = cell || 24;
    var groups = {};
    leaves.forEach(function (p) {
      var k = Math.floor(p.x / cell) + '_' + Math.floor(p.y / cell);
      (groups[k] = groups[k] || []).push(p);
    });
    var out = [];
    Object.keys(groups).forEach(function (k) {
      var arr = groups[k], sx = 0, sy = 0, ls = 0;
      for (var i = 0; i < arr.length; i++) {
        sx += arr[i].x; sy += arr[i].y;
        ls += (arr[i].scale == null ? 1 : arr[i].scale);
      }
      out.push({
        x: sx / arr.length, y: sy / arr.length, n: arr.length,
        localScale: ls / arr.length,
        seed: h2('clump' + k)
      });
    });
    return out;
  }

  function buildTree(seed, species, over) {
    var S = seed || SEED;
    W = 560; H = 680; baseY = H - 17;
    var d = shapeOf(dataFor(S, species, over));
    return bakeTree(d, d.crown, { seed: S, species: species || 'oak', mode: 'forms' });
  }

  /* 照片树：骨架与叶子都是照片给的，不再做 forms 的比例修正。
     opt: { w, h, baseY, segs, leaves, crown, seed, canopyCv, lowInfo } */
  function buildPhoto(opt) {
    W = opt.w; H = opt.h; baseY = opt.baseY;
    var d = { segs: opt.segs || [], leaves: opt.leaves || [] };
    return bakeTree(d, opt.crown, {
      seed: opt.seed || SEED, species: 'photo', mode: 'photo', maskCv: opt.maskCv,
      canopyCv: opt.canopyCv, lowInfo: !!opt.lowInfo
    });
  }

  var PAINT_MODE = 'forms';

  // 两种树共用的烘焙：叶团、叶隙、前后排序、统一光向
  function bakeTree(d, crown, opt) {
    ellCount = 0;
    var S = opt.seed;
    CUR_SEED = S;
    PAINT_MODE = opt.mode || 'forms';
    var photo = PAINT_MODE === 'photo';
    var photoLow = photo && !!opt.lowInfo;
    var clumps = buildClumps(d, photo ? 22 : 24);

    // 树先画在透明画布上：最后才能整棵统一打光（source-atop 只作用在树上）
    var tc = document.createElement('canvas');
    tc.width = W; tc.height = H;
    var t = tc.getContext('2d');

    // 照片树：铺一层由照片亮度算出的叶面，形状由剪影锁定。
    // 不再平涂深绿——冠内必须有可读的明暗；读不出内部时它是很淡的影子。
    if (photo && opt.canopyCv) {
      t.drawImage(opt.canopyCv, 0, 0);
    } else if (photo && opt.maskCv) {
      t.globalAlpha = 0.42;
      t.drawImage(opt.maskCv, 0, 0);
      t.globalAlpha = 1;
    }

    // 冠层不再铺一层灰雾：叶密了以后那一层会变成一块灰斑

    // 叶隙：三处成簇，落在暗部一带（左中、右下、冠底），不均匀；
    // 只在画面前层让开，透出来的是纸与枝，暗部里才有"亮斑"而不是灰
    HOLES = [];
    (function () {
      var hr = rng(h2('holes' + S));
      var clusters = [
        { nx: -0.34, ny: 0.02, rad: 0.12 },
        { nx: 0.20, ny: 0.30, rad: 0.11 },
        { nx: -0.10, ny: 0.48, rad: 0.09 }
      ];
      clusters.forEach(function (cl) {
        var n = 2 + (hr() < 0.55 ? 1 : 0);
        for (var i = 0; i < n; i++) {
          var a = hr() * 6.283, dd = hr() * cl.rad;
          HOLES.push({
            x: crown.cx + (cl.nx + Math.cos(a) * dd) * crown.rx,
            y: crown.cy + (cl.ny + Math.sin(a) * dd * 0.85) * crown.ry,
            r: 4 + hr() * 4.5
          });
        }
      });
    })();

    var backClumps = [], frontClumps = [];
    // 照片树的形状就是照片：边缘只做一点点参差，不能像程序树那样"啃"掉轮廓
    var cut = photo ? 0.12 : 1;
    clumps.forEach(function (c) {
      var rr = Math.hypot((c.x - crown.cx) / crown.rx, (c.y - crown.cy) / crown.ry);
      var r0 = rng(c.seed);

      // 冠顶的枝梢叶簇往冠体收一点：顶端不留浮着的小团（越靠顶收得越多）
      var ny0 = (c.y - crown.cy) / crown.ry;
      if (!photo && ny0 < -0.34 && rr > 0.62) {
        var pull = Math.min(0.10, (-ny0 - 0.34) * 0.22);
        c.x += (crown.cx - c.x) * pull * 0.5;
        c.y += (crown.cy - c.y) * pull;
        rr = Math.hypot((c.x - crown.cx) / crown.rx, (c.y - crown.cy) / crown.ry);
        ny0 = (c.y - crown.cy) / crown.ry;
      }

      // 背光的一侧（右）是"变稀"，不是抽空：最多让到 8 成
      var side = (c.x - crown.cx) / crown.rx;
      if (side > 0.15 && r0() < (0.04 + Math.max(0, side - 0.15) * 0.22) * cut) return;

      // 只在 1–2 处开缺口（露后面的枝）：缺口窄，且只让掉一半多
      var ang = Math.atan2((c.y - crown.cy) / crown.ry, (c.x - crown.cx) / crown.rx);
      if (r0() < 0.55 * cut && ((ang > -0.58 && ang < -0.34) || (ang > 1.02 && ang < 1.28))) return;

      // 冠缘参差：外一圈啃掉一些，过渡带只让一点点；冠内的小洞要小且少
      if (rr > 0.88 && r0() < 0.26 * cut) return;
      if (rr > 0.70 && r0() < 0.08 * cut) return;
      if (rr < 0.86 && r0() < 0.02 * cut) return;

      // 冠底别切出一条平滑的弧：下缘一带让它稀一点，团也小一点
      var low = (c.y - crown.cy) / crown.ry;
      if (low > 0.52 && r0() < 0.18 * cut) return;
      c.low = low;

      // 团的大小差异别太大，否则又回到"一大颗一小颗"
      c.scale = (photo ? (photoLow ? 0.74 : 0.92) : (0.98 + Math.min(0.34, c.n / 40))) * (c.localScale || 1);
      if (rr > 0.82) c.scale *= 0.84;   // 冠缘的团小一点，边缘才碎
      if (!photo && rr > 0.72 && ny0 < -0.40) c.scale *= 1.06;  // 冠顶稍连一点，别散成浮团
      if (low > 0.5) c.scale *= 0.92;
      // 整冠统一光向：上亮下暗为主、左亮右暗为辅；冠底与背光侧压深
      var nx = (c.x - crown.cx) / crown.rx, ny = (c.y - crown.cy) / crown.ry;
      var lit0 = -(nx * 0.46 + ny * 0.86) * 1.02 - (1 - Math.min(1, rr)) * 0.20;
      c.light = Math.max(-1.0, Math.min(0.58, lit0)) + (r0() - 0.5) * 0.12;
      c.outer = rr;
      // 冠的下半部多让给枝：这些团画在枝后面，暗部里仍能透出枝与叶隙，
      // 不会糊成一整块；上半部照旧压在枝前，冠顶才连成片
      if (r0() < 0.34 || (low > 0.30 && r0() < 0.34)) backClumps.push(c);
      else frontClumps.push(c);
    });

    backClumps.forEach(function (c) {
      if (photo) leafMassSoft(t, c.x, c.y, c.seed, c.scale, c.light - 0.12, c.outer, photoLow);
      else leafMass(t, c.x, c.y, c.seed, c.scale, c.light - 0.16, c.outer, false, c.low);
    });

    // 把叶隙从已画的叶层里挖掉（只挖到纸）：后面的枝还会横过去，是枝穿叶隙。
    // 照片树不挖：那样会把剪影本身挖穿，形状就不对了。
    if (!photo) {
      t.globalCompositeOperation = 'destination-out';
      HOLES.forEach(function (h) {
        var hg = t.createRadialGradient(h.x, h.y, h.r * 0.2, h.x, h.y, h.r * 1.3);
        hg.addColorStop(0, 'rgba(0,0,0,0.94)');
        hg.addColorStop(0.6, 'rgba(0,0,0,0.72)');
        hg.addColorStop(1, 'rgba(0,0,0,0)');
        t.fillStyle = hg;
        t.beginPath();
        t.ellipse(h.x, h.y, h.r * 1.3, h.r * 1.2, 0, 0, 6.283);
        t.fill();
      });
      t.globalCompositeOperation = 'source-over';
    }

    var sorted = d.segs.slice().sort(function (a, b) {
      return (a.depth - b.depth) || (b.w - a.w);
    });
    var trunkSegs = [], behind = [], front = [];
    sorted.forEach(function (s, i) {
      if (s.depth === 0) trunkSegs.push(s);
      else if (s.depth >= 2 && h2('z' + i) % 100 < 26) behind.push(s);
      else front.push(s);
    });
    drawBranches(t, behind);
    var base = drawTrunk(t, trunkSegs);
    drawBranches(t, front);

    frontClumps.forEach(function (c) {
      if (photo) leafMassSoft(t, c.x, c.y, c.seed, c.scale, c.light, c.outer, photoLow);
      else leafMass(t, c.x, c.y, c.seed, c.scale, c.light, c.outer, !photo, c.low);
    });

    // 少数几处深得下去的凹陷：只在树身范围内压深，暗部有自己的起伏。
    // 照片树不加这几块——冠内明暗已经来自照片，再压会盖掉叶面层次。
    t.globalCompositeOperation = 'source-atop';
    if (!photo) [
      { x: crown.cx + crown.rx * 0.34, y: crown.cy + crown.ry * 0.52, r: 62, a: 0.20 },
      { x: crown.cx - crown.rx * 0.10, y: crown.cy + crown.ry * 0.30, r: 48, a: 0.15 },
      { x: crown.cx + crown.rx * 0.08, y: crown.cy + crown.ry * 0.74, r: 40, a: 0.17 }
    ].forEach(function (p) {
      var dg = t.createRadialGradient(p.x, p.y, p.r * 0.15, p.x, p.y, p.r);
      dg.addColorStop(0, 'rgba(30,40,34,' + p.a + ')');
      dg.addColorStop(1, 'rgba(30,40,34,0)');
      t.fillStyle = dg;
      t.beginPath();
      t.ellipse(p.x, p.y, p.r, p.r * 0.86, 0, 0, 6.283);
      t.fill();
    });
    t.globalCompositeOperation = 'source-over';

    // 全树统一光向：左上偏暖提亮，右下压暗（只落在树身上）
    var sh = t.createLinearGradient(W * 0.10, H * 0.02, W * 0.98, H * 0.96);
    sh.addColorStop(0, photo ? 'rgba(255,252,238,0.09)' : 'rgba(255,252,238,0.15)');
    sh.addColorStop(0.42, 'rgba(255,252,238,0.02)');
    sh.addColorStop(1, photo ? 'rgba(42,52,50,0.11)' : 'rgba(42,52,50,0.17)');
    t.globalCompositeOperation = 'source-atop';
    t.fillStyle = sh;
    t.fillRect(0, 0, W, H);
    t.globalCompositeOperation = 'source-over';

    // —— 生长动画数据：每根枝、每簇叶的「出生时刻」（演出模式用；静态画法完全忽略）——
    // 出生时刻按到根的高度归一化：越靠根越早，越靠冠顶越晚；叶比同高度的枝略晚。
    // 演出时用一张增量遮罩按 birth 逐段揭示这张烘焙图，长出来的树和最终树是同一张画。
    var growth = (function () {
      var topY = baseY;
      sorted.forEach(function (s) { topY = Math.min(topY, s.y1, s.y2, s.cy); });
      backClumps.concat(frontClumps).forEach(function (c) { topY = Math.min(topY, c.y); });
      var spanY = Math.max(1, baseY - topY);
      function birthOf(y, depth) {
        var h = (baseY - y) / spanY;
        h = Math.max(0, Math.min(1, h));
        return Math.max(0, Math.min(1, h * 0.92 + (depth || 0) * 0.008));
      }
      var gs = sorted.map(function (s) {
        return {
          x1: s.x1, y1: s.y1, cx: s.cx, cy: s.cy, x2: s.x2, y2: s.y2,
          w: (s.w0 != null ? (s.w0 + s.w1) / 2 : s.w), depth: s.depth,
          birth: birthOf(Math.max(s.y1, s.y2), s.depth)
        };
      }).sort(function (a, b) { return a.birth - b.birth; });
      var gl = backClumps.concat(frontClumps).map(function (c, ci) {
        // 叶簇的出生时刻按高度排，但加一点确定性抖动：
        // 不让同一水平带的叶整条同时绽开（会像百叶窗），而是参差错落。
        var jitter = ((h2('leafbirth' + S + '_' + ci) % 1000) / 1000 - 0.5) * 0.10;
        return {
          x: c.x, y: c.y, scale: c.scale || 1,
          birth: Math.max(0, Math.min(1, birthOf(c.y, 0) * 0.96 + 0.03 + jitter))
        };
      }).sort(function (a, b) { return a.birth - b.birth; });
      return { segs: gs, leaves: gl, baseY: baseY, topY: topY };
    })();

    return {
      tc: tc, base: base, crown: crown, seed: S, species: opt.species,
      w: W, h: H, mode: PAINT_MODE, growth: growth,
      stats: { clumps: clumps.length, leaves: (d.leaves || []).length, segs: d.segs.length, ellipses: ellCount }
    };
  }

  /* —— 空气：微风 / 下雨 / 起雾（画面 + 声音，1.5s 过渡） —— */
  var bgCv = null, TREE = null, mainCtx = null, wetCv = null;
  var weather = 'wind';
  var wI = { wind: 1, rain: 0, fog: 0 };
  var AC = null, master = null, masterFilter = null, windG = null, rainG = null;

  function makeBg(variant, crown, plain) {
    bgCv = document.createElement('canvas');
    bgCv.width = W; bgCv.height = H;
    backdrop(bgCv.getContext('2d'), true, variant, crown, plain);
    wetCv = document.createElement('canvas');
    wetCv.width = W; wetCv.height = H;
  }

  // 树丛的地：极淡的近深远浅，不是一条平灰带
  function groveGround(g) {
    var gd = g.createLinearGradient(0, horizon - 20, 0, H);
    gd.addColorStop(0, 'rgba(218,209,192,0)');
    gd.addColorStop(0.26, 'rgba(216,207,190,0.15)');
    gd.addColorStop(0.66, 'rgba(208,198,180,0.27)');
    gd.addColorStop(1, 'rgba(197,187,168,0.30)');
    g.fillStyle = gd;
    g.fillRect(0, horizon - 20, W, H - horizon + 20);

    // 地平线附近一点点暖光：远浅近深，但不留一条硬边
    var hz = g.createLinearGradient(0, horizon - 34, 0, horizon + 40);
    hz.addColorStop(0, 'rgba(246,242,232,0)');
    hz.addColorStop(0.6, 'rgba(246,242,232,0.20)');
    hz.addColorStop(1, 'rgba(246,242,232,0)');
    g.fillStyle = hz;
    g.fillRect(0, horizon - 34, W, 74);
  }

  // 风：按水平条带错位，越靠冠顶摆得越多、根不动；周期长到看不出来
  function swayAt(y, now, air) {
    air = air || wI;
    var k = 1 - y / H;
    var amp = 1.15 * air.wind + 1.9 * air.rain;
    return Math.sin(now * 0.00042 + y * 0.011) * amp * k * k;
  }

  // 把一张已烘焙的树（透明底）按条带摆动地画进来；起雾时改成整棵柔化
  function drawTreeWith(g, tc, now, air) {
    if (!tc) return;
    // 照片树不切片：切片的重叠边会在半透明叶面上叠出横纹
    if (PAINT_MODE === 'photo') { g.drawImage(tc, 0, 0); return; }
    if (air.fog > 0.02) {
      // 雾里不摆：先让边缘化开，轮廓仍要看得清
      g.save();
      g.filter = 'blur(' + (air.fog * 1.2).toFixed(2) + 'px)';
      g.drawImage(tc, 0, 0);
      g.restore();
      return;
    }
    var strips = 26, sh = H / strips;
    for (var i = 0; i < strips; i++) {
      var y = i * sh;
      g.drawImage(tc, 0, y, W, sh + 1, swayAt(y, now, air), y, W, sh + 1);
    }
  }

  function drawTree(g, now) {
    drawTreeWith(g, TREE && TREE.tc, now, wI);
  }

  function drawRain(g, now, air) {
    air = air || wI;
    if (air.rain < 0.01) return;
    var r = rng(hash('rain'));
    var n = Math.round(170 * air.rain);
    g.save();
    g.lineCap = 'round';
    for (var i = 0; i < n; i++) {
      var x0 = r() * (W + 80) - 40;
      var speed = 0.42 + r() * 0.5;
      var len = 16 + r() * 20;
      var y = ((r() * H) + now * speed) % (H + 40) - 20;
      g.strokeStyle = 'rgba(196,204,204,' + (0.26 + r() * 0.22) * air.rain + ')';
      g.lineWidth = 0.9 + r() * 0.7;
      g.beginPath();
      g.moveTo(x0 - 0.24 * len, y);
      g.lineTo(x0, y + len);
      g.stroke();
    }
    g.restore();
  }

  function compose(now) {
    var g = mainCtx;
    if (!g || !bgCv || !TREE) return;
    g.drawImage(bgCv, 0, 0);

    // 雨：地面先变深；树再压上去
    if (wI.rain > 0.01) {
      g.fillStyle = 'rgba(74,82,64,' + (0.13 * wI.rain).toFixed(3) + ')';
      g.fillRect(0, 0, W, H);
    }

    if (wI.rain > 0.02 && wI.fog < 0.02) {
      // 湿亮只作用在树身上：先画到临时层，再 source-atop 上光
      var wc = wetCv.getContext('2d');
      wc.clearRect(0, 0, W, H);
      drawTree(wc, now);
      wc.globalCompositeOperation = 'source-atop';
      var wet = wc.createLinearGradient(0, H * 0.08, 0, H * 0.66);
      wet.addColorStop(0, 'rgba(238,246,244,' + (0.18 * wI.rain).toFixed(3) + ')');
      wet.addColorStop(1, 'rgba(238,246,244,0)');
      wc.fillStyle = wet;
      wc.fillRect(0, 0, W, H);
      wc.globalCompositeOperation = 'source-over';
      g.drawImage(wetCv, 0, 0);
    } else {
      drawTree(g, now);
    }

    soilFade(g, TREE.base.x, TREE.base.y, TREE.seed);

    if (wI.rain > 0.01) drawRain(g, now);

    // 雾：远景与地平线先化掉，再薄薄压一层；轮廓仍在
    if (wI.fog > 0.01) {
      var fg = wI.fog;
      var mist = g.createLinearGradient(0, horizon - 80, 0, H * 0.98);
      mist.addColorStop(0, 'rgba(247,243,234,0)');
      mist.addColorStop(0.35, 'rgba(247,243,234,' + (0.45 * fg).toFixed(3) + ')');
      mist.addColorStop(1, 'rgba(247,243,234,' + (0.18 * fg).toFixed(3) + ')');
      g.fillStyle = mist;
      g.fillRect(0, 0, W, H);
      g.fillStyle = 'rgba(246,242,233,' + (0.07 * fg).toFixed(3) + ')';
      g.fillRect(0, 0, W, H);
    }
  }

  /* —— 声音：一层风噪声 + 一层雨；雾把高频压掉 —— */
  function initAudio() {
    if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
    var C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    AC = new C();
    master = AC.createGain(); master.gain.value = 0.9;
    masterFilter = AC.createBiquadFilter();
    masterFilter.type = 'lowpass'; masterFilter.frequency.value = 20000;
    masterFilter.connect(master); master.connect(AC.destination);

    var buf = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate);
    var d = buf.getChannelData(0), s = 12345;
    for (var i = 0; i < d.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; d[i] = (s / 0x3fffffff) - 1; }
    function loopSrc() {
      var src = AC.createBufferSource(); src.buffer = buf; src.loop = true; src.start(); return src;
    }

    var wf = AC.createBiquadFilter();
    wf.type = 'lowpass'; wf.frequency.value = 620; wf.Q.value = 0.6;
    windG = AC.createGain(); windG.gain.value = 0;
    loopSrc().connect(wf); wf.connect(windG); windG.connect(masterFilter);

    var lfo = AC.createOscillator(); lfo.frequency.value = 0.07;
    var lg = AC.createGain(); lg.gain.value = 700;
    lfo.connect(lg); lg.connect(wf.frequency); lfo.start();

    var rf = AC.createBiquadFilter();
    rf.type = 'highpass'; rf.frequency.value = 1400;
    rainG = AC.createGain(); rainG.gain.value = 0;
    loopSrc().connect(rf); rf.connect(rainG); rainG.connect(masterFilter);

    applyAudio(true);
  }

  function applyAudio(instant) {
    if (!AC) return;
    var t = AC.currentTime, tc2 = instant ? 0.02 : 0.45;
    var wTarget = weather === 'rain' ? 0.012 : (weather === 'fog' ? 0.030 : 0.045);
    var rTarget = weather === 'rain' ? 0.060 : 0.0;
    var fTarget = weather === 'fog' ? 1500 : 20000;
    windG.gain.cancelScheduledValues(t); windG.gain.setTargetAtTime(wTarget, t, tc2);
    rainG.gain.cancelScheduledValues(t); rainG.gain.setTargetAtTime(rTarget, t, tc2);
    masterFilter.frequency.cancelScheduledValues(t);
    masterFilter.frequency.setTargetAtTime(fTarget, t, tc2);
  }

  function setWeather(w) {
    weather = w;
    if (AC) { if (AC.state === 'suspended') AC.resume(); applyAudio(false); }
    var btns = document.querySelectorAll('#air button');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('on', btns[i].getAttribute('data-w') === w);
    }
  }

  /* —— 给主页面用：同一套画法，但画在透明底上（不铺纸，页面有自己的底） —— */
  function tintArt(art, tint) {
    if (!art) return null;
    if (!tint || tint === 'day') return art.tc;
    art.tints = art.tints || {};
    if (art.tints[tint]) return art.tints[tint];
    var cv = document.createElement('canvas');
    cv.width = art.w; cv.height = art.h;
    var g = cv.getContext('2d');
    g.filter = tint === 'gold'
      ? 'sepia(0.48) saturate(1.38) brightness(1.10) contrast(1.14)'
      : 'hue-rotate(168deg) saturate(0.80) brightness(0.98) contrast(1.10)';
    g.drawImage(art.tc, 0, 0);
    g.filter = 'none';
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = tint === 'gold' ? 'rgba(255,188,86,0.10)' : 'rgba(108,156,214,0.09)';
    g.fillRect(0, 0, art.w, art.h);
    g.globalCompositeOperation = 'source-over';
    art.tints[tint] = cv;
    return cv;
  }

  // 把烘焙好的树连同根下影子、土色一起画进任意画布；风/雨/雾由 air 决定
  var wetPlate = null;
  function paint(g, art, o) {
    if (!art) return;
    // 画法与尺寸都跟着这张树走：照片树的画框是照片的比例
    PAINT_MODE = art.mode || 'forms';
    W = art.w; H = art.h; baseY = art.base.y;
    var air = o.air || { wind: 1, rain: 0, fog: 0 };
    var s = o.scale || 1;
    var tc = o.tint ? tintArt(art, o.tint) : art.tc;
    g.save();
    g.translate(o.x || 0, o.y || 0);
    g.scale(s, s);
    if (o.shadow !== false) softShadow(g, art.seed, art.base.x, art.base.y);

    // 雨：湿亮只加在树身。必须先在透明小画布上做 source-atop，
    // 直接在大画布上做会把整块画框（连背景）一起提亮，露出一个矩形。
    if (air.rain > 0.02 && air.fog < 0.02) {
      if (!wetPlate || wetPlate.width !== W || wetPlate.height !== H) {
        wetPlate = document.createElement('canvas');
        wetPlate.width = W; wetPlate.height = H;
      }
      var wc = wetPlate.getContext('2d');
      wc.clearRect(0, 0, W, H);
      drawTreeWith(wc, tc, o.now || 0, air);
      wc.globalCompositeOperation = 'source-atop';
      var wet = wc.createLinearGradient(0, H * 0.08, 0, H * 0.7);
      wet.addColorStop(0, 'rgba(238,246,244,' + (0.16 * air.rain).toFixed(3) + ')');
      wet.addColorStop(1, 'rgba(238,246,244,0)');
      wc.fillStyle = wet;
      wc.fillRect(0, 0, W, H);
      wc.globalCompositeOperation = 'source-over';
      g.drawImage(wetPlate, 0, 0);
    } else {
      drawTreeWith(g, tc, o.now || 0, air);
    }

    soilFade(g, art.base.x, art.base.y, art.seed);
    g.restore();
  }

  /* ============================================================
     生长演出：按进度 p∈[0,1] 逐段揭示烘焙好的树。
     不是另画一棵树，而是用一张「生长遮罩」把同一张画一点点擦出来——
     长出来的形状和最终定格完全一致。遮罩增量累积（只画新到达的部分），
     所以每帧开销很小；回退（重看）时由调用方重建 grow 状态。
     grow 状态：{ mask, segI, leafI, plate }，由 makeGrow() 创建。
     ============================================================ */
  function makeGrow(art) {
    var mask = document.createElement('canvas');
    mask.width = art.w; mask.height = art.h;
    return { mask: mask, segI: 0, leafI: 0, plate: null, glow: null, artSeed: null };
  }

  // 画一段二次贝塞尔的局部（t0→t1），用于"笔尖"当前正在抽出的那一段
  function bezierPart(g, s, t0, t1) {
    var N = 5, first = true;
    for (var i = 0; i <= N; i++) {
      var t = t0 + (t1 - t0) * (i / N), u = 1 - t;
      var x = u * u * s.x1 + 2 * u * t * s.cx + t * t * s.x2;
      var y = u * u * s.y1 + 2 * u * t * s.cy + t * t * s.y2;
      if (first) { g.moveTo(x, y); first = false; } else g.lineTo(x, y);
    }
  }

  function paintGrowth(g, art, p, o, grow) {
    if (!art || !art.growth) return null;
    PAINT_MODE = art.mode || 'forms';
    W = art.w; H = art.h; baseY = art.growth.baseY;
    var gr = art.growth;
    p = Math.max(0, Math.min(1, p));

    if (!grow || grow.artSeed !== art.seed + '|' + p.toFixed(0)) {
      // 调用方每次演出新建一个 grow；这里只做空值兜底
      if (!grow) grow = makeGrow(art);
    }

    var mg = grow.mask.getContext('2d');
    // 已完成的段/叶留在遮罩上；只补画 birth 落入 (上次, 当前 p] 的部分。
    // 但 p 可能回退（重看/拖动），检测：若 p 比上次小，清空重来。
    if (grow.lastP == null || p < grow.lastP - 1e-6) {
      mg.clearRect(0, 0, grow.mask.width, grow.mask.height);
      grow.segI = 0; grow.leafI = 0;
    }

    mg.lineCap = 'round';
    mg.lineJoin = 'round';
    var activeTip = null;   // {x,y,w} 当前正在抽出的枝尖，供主页面画笔尖光

    // 枝：birth <= p 的，整段点亮（正在长的那一段画局部）
    var gs = gr.segs;
    while (grow.segI < gs.length && gs[grow.segI].birth <= p) {
      var s = gs[grow.segI++];
      // 这一段的"展开进度"：birth 处刚开始，+0.05 后完整
      var local = Math.max(0, Math.min(1, (p - s.birth) / 0.05));
      var wpx = Math.max(0.9, s.w * widthK(s.depth) * 1.1);
      mg.strokeStyle = 'rgba(255,255,255,0.96)';
      mg.lineWidth = wpx;
      mg.beginPath();
      bezierPart(mg, s, 0, local);
      mg.stroke();
      if (local < 1) {
        var u = 1 - local;
        activeTip = {
          x: u * u * s.x1 + 2 * u * local * s.cx + local * local * s.x2,
          y: u * u * s.y1 + 2 * u * local * s.cy + local * local * s.y2,
          w: wpx
        };
      }
    }
    // 叶：birth <= p 的，半径随展开进度长出来
    var gl = gr.leaves;
    while (grow.leafI < gl.length && gl[grow.leafI].birth <= p) {
      var lf = gl[grow.leafI++];
      var lp = Math.max(0, Math.min(1, (p - lf.birth) / 0.06));
      var R = 20 * lf.scale * lp;
      if (R > 0.5) {
        var rg = mg.createRadialGradient(lf.x, lf.y, R * 0.15, lf.x, lf.y, R);
        rg.addColorStop(0, 'rgba(255,255,255,0.97)');
        rg.addColorStop(1, 'rgba(255,255,255,0.55)');
        mg.fillStyle = rg;
        mg.beginPath();
        mg.ellipse(lf.x, lf.y, R * 1.15, R * 0.8, 0, 0, 6.283);
        mg.fill();
      }
    }
    grow.lastP = p;

    // 把遮罩盖到树上（destination-in：只留被点亮处）
    if (!grow.plate || grow.plate.width !== art.w || grow.plate.height !== art.h) {
      grow.plate = document.createElement('canvas');
      grow.plate.width = art.w; grow.plate.height = art.h;
    }
    var pg = grow.plate.getContext('2d');
    pg.clearRect(0, 0, art.w, art.h);
    var tc = (o && o.tint) ? tintArt(art, o.tint) : art.tc;
    pg.drawImage(tc, 0, 0);
    pg.globalCompositeOperation = 'destination-in';
    pg.drawImage(grow.mask, 0, 0);
    pg.globalCompositeOperation = 'source-over';

    // 辉光层：从同一张树图做模糊 + 染色，用同一张生长遮罩裁切。
    // 这样"长到哪、亮到哪"，且辉光形状和树完全重合，不会露出还没长的部分。
    if (!grow.glow || grow.glow.width !== art.w || grow.glow.height !== art.h) {
      grow.glow = document.createElement('canvas');
      grow.glow.width = art.w; grow.glow.height = art.h;
    }
    var ggctx = grow.glow.getContext('2d');
    ggctx.clearRect(0, 0, art.w, art.h);
    try { ggctx.filter = 'blur(7px) brightness(1.5)'; } catch (e) {}
    ggctx.drawImage(grow.plate, 0, 0);
    ggctx.filter = 'none';
    ggctx.globalCompositeOperation = 'source-atop';
    var warm = (o && o.glowColor) || 'rgba(255,206,126,0.30)';
    ggctx.fillStyle = warm;
    ggctx.fillRect(0, 0, art.w, art.h);
    ggctx.globalCompositeOperation = 'source-over';

    // 贴到目标画布（沿用 paint 的构图：阴影、比例、偏移）
    var s2 = (o && o.scale) || 1;
    g.save();
    g.translate((o && o.x) || 0, (o && o.y) || 0);
    g.scale(s2, s2);
    if (!o || o.shadow !== false) softShadow(g, art.seed, art.base.x, art.base.y);
    var air = (o && o.air) || { wind: 0.5, rain: 0, fog: 0 };
    var blit = (o && o.still)
      ? function (cv) { g.drawImage(cv, 0, 0); }
      : function (cv) { drawTreeWith(g, cv, (o && o.now) || 0, air); };
    blit(grow.plate);
    // 辉光用加色叠在树上：夜里发金光，昼色下压得很淡
    if (!o || o.glow !== false) {
      g.globalCompositeOperation = (o && o.addMode) || 'lighter';
      g.globalAlpha = (o && o.glowAlpha) != null ? o.glowAlpha : 0.55;
      blit(grow.glow);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    }
    if (!o || o.soil !== false) soilFade(g, art.base.x, art.base.y, art.seed);
    g.restore();

    return activeTip;
  }

  // 背景 A 的全宽版：地平线一线暖灰 + 根下一小片亮，不出纸边
  function ground(g, w, h, baseY, tint) {
    var day = tint === 'day';
    var q = Math.max(0.6, Math.min(2, h / 900));
    var y = baseY;
    // 深色主题不放这条暖灰带：会在暗底上读成一条亮线；只留根下一小片
    if (day) {
      var hb = g.createLinearGradient(0, y - 54 * q, 0, y + 28 * q);
      hb.addColorStop(0, 'rgba(226,218,203,0)');
      hb.addColorStop(0.55, 'rgba(222,213,196,0.34)');
      hb.addColorStop(1, 'rgba(226,217,201,0)');
      g.fillStyle = hb;
      g.fillRect(0, y - 54 * q, w, 82 * q);
    }

    var rad = Math.min(w, h) * (day ? 0.42 : 0.16);
    var bl = g.createRadialGradient(w * 0.5, y - 6 * q, 8, w * 0.5, y - 6 * q, rad);
    bl.addColorStop(0, day ? 'rgba(250,246,236,0.32)' : 'rgba(238,214,172,0.06)');
    bl.addColorStop(0.55, day ? 'rgba(250,246,236,0.10)' : 'rgba(238,214,172,0.02)');
    bl.addColorStop(1, 'rgba(250,246,236,0)');
    g.fillStyle = bl;
    g.fillRect(0, y - rad, w, rad * 1.5);
  }

  // 屏幕空间的雨丝（整幅，不局限在树的画框里）
  function rainOverlay(g, w, h, now, k) {
    if (!k || k < 0.01) return;
    var r = rng(hash('rain'));
    var n = Math.round(230 * k);
    var q = Math.max(0.7, h / 680);
    g.save();
    g.lineCap = 'round';
    for (var i = 0; i < n; i++) {
      var x0 = r() * (w + 120 * q) - 60 * q;
      var speed = (0.42 + r() * 0.5) * q;
      var len = (14 + r() * 20) * q;
      var y = ((r() * h) + now * speed) % (h + 60 * q) - 30 * q;
      g.strokeStyle = 'rgba(198,206,206,' + ((0.20 + r() * 0.22) * k).toFixed(3) + ')';
      g.lineWidth = (0.8 + r() * 0.7) * q;
      g.beginPath();
      g.moveTo(x0 - 0.22 * len, y);
      g.lineTo(x0, y + len);
      g.stroke();
    }
    g.restore();
  }

  // 屏幕空间的雾：地平线附近先化开，再薄薄压一层
  function fogOverlay(g, w, h, k, baseY) {
    if (!k || k < 0.01) return;
    var y = (baseY == null) ? h * 0.72 : baseY;
    var mist = g.createLinearGradient(0, y - h * 0.16, 0, h);
    mist.addColorStop(0, 'rgba(247,243,234,0)');
    mist.addColorStop(0.34, 'rgba(247,243,234,' + (0.30 * k).toFixed(3) + ')');
    mist.addColorStop(1, 'rgba(247,243,234,' + (0.10 * k).toFixed(3) + ')');
    g.fillStyle = mist;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(246,242,233,' + (0.05 * k).toFixed(3) + ')';
    g.fillRect(0, 0, w, h);
  }

  window.TreeArt = {
    W: 560, H: 680,
    build: buildTree,
    buildPhoto: buildPhoto,
    shape: function (seed, species, over) { return shapeOf(dataFor(seed || SEED, species, over)); },
    tint: tintArt,
    paint: paint,
    makeGrow: makeGrow,
    paintGrowth: paintGrowth,
    ground: ground,
    rain: rainOverlay,
    fog: fogOverlay
  };

  /* —— 跑 —— */
  function run() {
    if (!document.getElementById('new')) return;   // 主页面只借用画法，不跑样张
    var q = new URLSearchParams(location.search);
    var variant = q.get('bg') === 'b' ? 'b' : 'a';
    var single = q.has('bg');
    var crown = shapeOf(tree()).crown;

    var oldCv = document.getElementById('old');
    var newCv = document.getElementById('new');
    var og = oldCv.getContext('2d');
    mainCtx = newCv.getContext('2d');

    // 树丛预览：8 棵、4 个种子交替；只在样张里成立，不碰 grove.js
    var groveN = parseInt(q.get('grove') || '0', 10);
    if (groveN > 1) {
      document.body.classList.add('single');
      document.querySelector('header h1').textContent = '树丛 · ' + groveN + ' 棵（新画法）';
      document.querySelector('header span').textContent =
        '背景 A · ' + (groveN > 8 ? '8' : '4') + ' 个种子交替 · 静态一帧';
      var air0 = document.getElementById('air');
      if (air0) air0.style.display = 'none';
      var cap0 = document.querySelectorAll('.pair figcaption')[1];
      if (cap0) cap0.innerHTML = '<b>树丛预览</b> · 单树画法放进 ' + groveN + ' 棵里，看整体是否还成立';

      makeBg('a', null, true);
      var seeds = groveN > 8
        ? [SEED, 4211, 9007, 3301, 5521, 7310, 2647, 8834]
        : [SEED, 4211, 9007, 3301];
      var sprites = seeds.map(function (s) { return buildTree(s); });
      var g2 = mainCtx;
      g2.drawImage(bgCv, 0, 0);
      groveGround(g2);

      // 远近不靠蒙一层白雾（会把整棵洗平）：用明度/饱和度变换，
      // 远排整体提亮、降饱和并压一点对比，近排保持原样最实最深
      function tintSprite(spr, lv, t) {
        if (!spr.tints) spr.tints = {};
        var key = lv + '_' + t;
        if (spr.tints[key]) return spr.tints[key];
        var cv = document.createElement('canvas');
        cv.width = W; cv.height = H;
        var g3 = cv.getContext('2d');
        var bright = lv === 2 ? 1.30 : (lv === 1 ? 1.14 : 1.0);
        if (t === 1) bright *= 1.03;
        if (t === 2) bright *= 0.97;
        var sat = lv === 0 ? 1 : (lv === 1 ? 0.92 : 0.82);
        g3.filter = 'brightness(' + bright + ') saturate(' + sat + ')';
        g3.drawImage(spr.tc, 0, 0);
        g3.filter = 'none';
        if (lv > 0) {
          // 冷：只加一点偏蓝的灰，不要糊成白纱
          g3.globalCompositeOperation = 'source-atop';
          g3.fillStyle = 'rgba(168,186,196,' + (0.05 + 0.045 * lv).toFixed(3) + ')';
          g3.fillRect(0, 0, W, H);
        }
        if (t === 2 && lv === 0) {
          g3.globalCompositeOperation = 'source-atop';
          g3.fillStyle = 'rgba(40,52,44,0.04)';
          g3.fillRect(0, 0, W, H);
        }
        g3.globalCompositeOperation = 'source-over';
        spr.tints[key] = cv;
        return cv;
      }

      var spots;
      if (groveN <= 8) {
        // 8 棵：三排（3/3/2）；树顶按 60px 左右错开，不能是一条平顶线
        spots = [
          { x: 92, h: 300, y: 592, i: 3, f: 1, lv: 2 },
          { x: 282, h: 272, y: 604, i: 1, f: -1, lv: 2 },
          { x: 456, h: 318, y: 596, i: 2, f: 1, lv: 2 },
          { x: 118, h: 356, y: 634, i: 0, f: -1, lv: 1 },
          { x: 300, h: 330, y: 644, i: 2, f: 1, lv: 1 },
          { x: 448, h: 372, y: 628, i: 3, f: -1, lv: 1 },
          { x: 168, h: 430, y: 676, i: 1, f: 1, lv: 0 },
          { x: 396, h: 398, y: 664, i: 0, f: -1, lv: 0 }
        ];
      } else {
        // 20 棵：8 / 7 / 5 三排，等距 + 抖动；高度随机幅度加大，树顶参差
        spots = [];
        var rows = [
          { n: 8, yA: 552, yB: 568, hA: 196, hB: 268 },
          { n: 7, yA: 602, yB: 618, hA: 250, hB: 330 },
          { n: 5, yA: 650, yB: 668, hA: 310, hB: 400 }
        ];
        var rs = rng(hash('grove' + groveN));
        rows.forEach(function (row, ri) {
          for (var j = 0; j < row.n; j++) {
            var tt = (j + 0.5) / row.n;
            spots.push({
              x: 22 + tt * (W - 44) + (rs() - 0.5) * 22,
              h: row.hA + rs() * (row.hB - row.hA),
              y: row.yA + rs() * (row.yB - row.yA),
              i: (j + ri) % seeds.length,
              f: rs() < 0.5 ? -1 : 1,
              lv: ri === 2 ? 0 : (ri === 1 ? 1 : 2)
            });
          }
        });
      }
      spots.sort(function (a, b) { return a.y - b.y; });

      var boxes = [];
      spots.forEach(function (sp, si) {
        var spr = sprites[sp.i];
        var k = sp.h / H;
        var w = W * k;
        // 冠幅不一定等于整幅宽：按这棵自己的冠算左右边界（再留冠缘叶片的余量），
        // 别让冠被画框切掉
        var half = Math.min(W * 0.47, spr.crown.rx * 1.12 * k + 12);
        var x = Math.max(half + 2, Math.min(W - half - 2, sp.x));
        var y = sp.y;
        var depth = Math.max(0, Math.min(1, (sp.y - 560) / 112));
        var lv = depth < 0.34 ? 2 : (depth < 0.68 ? 1 : 0);
        var src = tintSprite(spr, lv, (si + sp.i) % 3);

        // 根下的接触暗：紧贴树干，让树站进地里（不是浮在地上）
        var core = g2.createRadialGradient(x + 2, y, 1, x + 2, y, 14 + 10 * k);
        core.addColorStop(0, 'rgba(32,42,26,0.44)');
        core.addColorStop(0.5, 'rgba(34,44,28,0.16)');
        core.addColorStop(1, 'rgba(34,44,28,0)');
        g2.fillStyle = core;
        g2.beginPath();
        g2.ellipse(x + 2, y, 14 + 10 * k, 4 + 3 * k, 0, 0, 6.283);
        g2.fill();

        // 顺光的碎影：几块错开的软斑，别成一个能看出来的椭圆
        var sr = rng(hash('gs' + sp.i + sp.x));
        for (var bi = 0; bi < 6; bi++) {
          var u2 = bi / 5;
          var sxx = x + (10 + u2 * 62) * k + (sr() - 0.5) * 10 * k;
          var syy = y + 1 + (sr() - 0.5) * 2;
          var srx = (10 + u2 * 26) * k, sry = (2.2 + u2 * 3.6) * k;
          var sa = (0.10 + 0.07 * depth) * (1 - u2 * 0.7);
          var sgr = g2.createRadialGradient(sxx, syy, 0, sxx, syy, srx);
          sgr.addColorStop(0, 'rgba(36,46,30,' + sa.toFixed(3) + ')');
          sgr.addColorStop(0.6, 'rgba(36,46,30,' + (sa * 0.45).toFixed(3) + ')');
          sgr.addColorStop(1, 'rgba(36,46,30,0)');
          g2.fillStyle = sgr;
          g2.beginPath();
          g2.ellipse(sxx, syy, srx, sry, 0, 0, 6.283);
          g2.fill();
        }

        // 极小一片土色，接住树干
        g2.fillStyle = 'rgba(198,189,167,0.18)';
        g2.beginPath();
        g2.ellipse(x, y - 1, 12 + 14 * k, 3 + 3 * k, 0, 0, 6.283);
        g2.fill();

        g2.save();
        g2.translate(x, y);
        if (sp.f < 0) g2.scale(-1, 1);
        g2.globalAlpha = 0.90 + 0.10 * depth;
        g2.drawImage(src, -w / 2, -sp.h * (spr.base.y / H), w, sp.h);
        g2.restore();
        g2.globalAlpha = 1;
        boxes.push({ x: Math.round(x), top: Math.round(y - sp.h * (spr.base.y / H)), h: sp.h });
      });
      document.getElementById('foot').textContent = groveN + ' 棵：' +
        (groveN > 8 ? '8 个种子' : '4 个种子') +
        '（' + seeds.join(' / ') + '）交替，按落点前后排序与缩放；' +
        '远排提亮偏冷、近排更实，左右按各自冠幅收边，四周留白。';
      window.__grove = { n: groveN, sprites: sprites.length, boxes: boxes };
      return;
    }

    if (single) {
      document.body.classList.add('single');
      document.querySelector('header h1').textContent =
        variant === 'b' ? '单棵树 · 背景 B（空气透视）' : '单棵树 · 背景 A（纸面留白）';
      document.querySelector('header span').textContent = '种子 1758 · 560×680 · 同一棵树、同一画幅';
      var cap = document.querySelectorAll('.pair figcaption')[1];
      if (cap) {
        cap.innerHTML = variant === 'b'
          ? '<b>背景 B</b> · 远丘与近地分层 + 地平线薄雾（空气透视）'
          : '<b>背景 A</b> · 纸面留白 + 地平线一线暖灰（推荐）';
      }
    }

    var oldMs = 0;
    if (!single) {
      backdrop(og, false, variant, crown);
      var t0 = performance.now();
      drawOld(og);
      oldMs = performance.now() - t0;
    }

    makeBg(variant, crown);
    var t1 = performance.now();
    TREE = buildTree();
    var newMs = performance.now() - t1;

    // 带 ?w= 的截图：直接把强度设到位，不走过渡
    var want = q.get('w');
    if (want === 'rain' || want === 'fog' || want === 'wind') {
      weather = want;
      wI = { wind: want === 'wind' ? 1 : 0, rain: want === 'rain' ? 1 : 0, fog: want === 'fog' ? 1 : 0 };
    }

    compose(1200);

    var stats = TREE.stats;
    document.getElementById('foot').innerHTML =
      '同一颗种子 ' + SEED + '：骨架 ' + stats.segs + ' 段 · 叶锚 ' + stats.leaves +
      ' · 叶团 ' + stats.clumps + ' 个 · 椭圆约 ' + ellCount + ' 个（烘焙一次）。<br>' +
      '烘焙耗时：方案 A ' + newMs.toFixed(1) + 'ms' + (single ? '' : '，现状 ' + oldMs.toFixed(1) + 'ms') + '；' +
      '微风每帧 ' + 27 + ' 次 drawImage；下雨 +88 条雨丝 +1 层地面压暗；起雾 +2 层雾 +1 次 blur。';

    var btns = document.querySelectorAll('#air button');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('on', btns[i].getAttribute('data-w') === weather);
      btns[i].onclick = (function (el) {
        return function () { initAudio(); setWeather(el.getAttribute('data-w')); };
      })(btns[i]);
    }
    document.addEventListener('pointerdown', function once() {
      initAudio();
      document.removeEventListener('pointerdown', once);
    });

    window.__sample = { stats: stats, ellCount: ellCount, newMs: newMs, oldMs: oldMs, weather: weather };
    window.__air = {
      set: setWeather,
      init: initAudio,
      state: function () {
        return {
          weather: weather, wI: { wind: wI.wind, rain: wI.rain, fog: wI.fog },
          audio: AC ? AC.state : null,
          gains: AC ? { wind: +windG.gain.value.toFixed(4), rain: +rainG.gain.value.toFixed(4), lowpass: Math.round(masterFilter.frequency.value) } : null
        };
      },
      probe: function (n) {
        var t = performance.now();
        for (var i = 0; i < n; i++) compose(1500 + i * 16);
        return (performance.now() - t) / n;
      }
    };

    var last = 0;
    function frame(now) {
      if (!last) last = now;
      var dt = Math.min(64, now - last); last = now;
      var k = 1 - Math.exp(-dt / 420);
      wI.wind += ((weather === 'wind' ? 1 : 0) - wI.wind) * k;
      wI.rain += ((weather === 'rain' ? 1 : 0) - wI.rain) * k;
      wI.fog += ((weather === 'fog' ? 1 : 0) - wI.fog) * k;
      compose(now);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
