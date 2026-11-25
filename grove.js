/* =========================================================
   树丛原型：同一地点 1 / 3 / 8 / 20 棵
   - 每棵树由「树的 id」定形状：同一棵树永远是同一棵，换的是它身边这片林子
   - 高度按到达先后错开（先来的高，新来的矮），带随机，不是等差
   - 布局三种气质：自然林（疏密不均）/ 公园（略规整）/ 行道（成排）
   - 有前后遮挡、地面起伏与草叶暗示；球面聚合点不变，这里是看得清个体的一层
   - 生物层只在这一层：1 棵只有风；3 棵起有虫；8 棵起有鸟；20 棵夜里整片树冠亮起
     昼：蝴蝶 + 鸟；夜：萤火虫。稀疏、慢、带呼吸，不是粒子烟花。
   ========================================================= */
(function () {
  'use strict';

  var MAX_DRAW = 20;          // 一处最多画 20 棵，再多只在球面上变稠
  var CROWD_AT = 8;           // 8 棵起算拥挤
  var FPS_CAP = 45;           // 树 sprite 每帧重绘，封顶 45fps

  var q = new URLSearchParams(location.search);
  var N = Math.max(1, Math.min(60, parseInt(q.get('n'), 10) || 1));
  var layout = q.get('layout') || 'wild';
  var species = q.get('sp') || 'oak';
  var place = q.get('place') || '上环 · 石墙细叶榕';
  var night = q.get('t') === 'night';
  var lifeOn = true;

  var cv = document.getElementById('grove');
  var ctx = cv.getContext('2d');
  var W = 0, H = 0, DPR = 2;

  var PALETTES = {
    day: {
      sky0: '#F2ECE1', sky1: '#EBE4D6',
      hillFar: '#E3DBCB', hillNear: '#DCD3C0',
      ground0: '#D9D1BE', ground1: '#CFC6B1',
      ink: '#33402F', inkTop: '#5A6650',
      leaf: '#7C8A5E', dry: '#9A6B45'
    },
    night: {
      sky0: '#0A1118', sky1: '#101C1C',
      hillFar: '#13201E', hillNear: '#16241F',
      ground0: '#182722', ground1: '#131F1B',
      ink: '#0E1D16', inkTop: '#1B3326',
      leaf: '#2E4031', dry: '#463A2D'
    }
  };
  var paper = night ? PALETTES.night : PALETTES.day;

  function hash(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return Math.abs(h) % 900000 + 1000;
  }
  function rng(seed) {
    var s = seed >>> 0;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  /* —— 位置：逐棵生成 —— */
  var placed = [];
  // 人少时树要散得开，人多时允许重叠：间距随棵数收
  var MIN_GAP = Math.max(0.10, Math.min(0.32, 0.55 / Math.sqrt(N)));
  function placeAt(i) {
    var r = rng(hash(place + '#' + i));
    var x, d;
    if (layout === 'park') {
      x = 0.12 + Math.floor(i / 2) * 0.085 + (r() - 0.5) * 0.014;
      d = i % 2 ? 0.60 : 0.30;
    } else if (layout === 'street') {
      x = 0.08 + Math.floor(i / 2) * 0.092 + (r() - 0.5) * 0.010;
      d = i % 2 ? 0.64 : 0.40;
    } else {
      // 自然林：纯随机起手，挤到别人身上就顺着方向推开
      x = 0.06 + r() * 0.88;
      d = r();
      for (var t = 0; t < 40; t++) {
        var near = null, nd = 9;
        for (var k = 0; k < placed.length; k++) {
          var dd = Math.hypot(placed[k].x - x, (placed[k].d - d) * 1.35);
          if (dd < nd) { nd = dd; near = placed[k]; }
        }
        if (!near || nd > MIN_GAP) break;
        var dx = x - near.x, dz = (d - near.d) * 1.35;
        var L = Math.hypot(dx, dz) || 0.001;
        x += (dx / L) * 0.06 + (r() - 0.5) * 0.02;
        d += (dz / L) * 0.06 + (r() - 0.5) * 0.02;
      }
    }
    x = Math.max(0.04, Math.min(0.96, x));
    d = Math.max(0, Math.min(1, d));
    var p = { x: x, d: d };
    placed.push(p);
    return p;
  }

  /* —— 一棵树：形状由 id 决定；高度由到达先后决定 —— */
  function makeTree(i) {
    var id = place + '·' + i;
    var seed = hash(id);
    var r = rng(seed ^ 0x5f356495);

    // 先来的高、新来的矮，像幼树；再叠一层自然随机
    var rank = 0.58 + 0.42 * Math.exp(-i / 5.5);
    var height = rank * (0.90 + r() * 0.20);
    var crownK = 0.86 + r() * 0.30;        // 冠幅
    var tilt = (r() - 0.5) * 0.10;         // 轻微倾角（弧度）
    var face = r() < 0.5 ? -1 : 1;         // 朝向：镜像一下，重复感立刻降一半
    var phase = r() * 6.283;

    var sw = 560, sh = 680;
    var data = window.TreeForms.generate(species, seed, sw, sh);

    var spr = document.createElement('canvas');
    spr.width = sw; spr.height = sh;
    var g = spr.getContext('2d');
    var grad = g.createLinearGradient(0, sh, 0, 0);
    grad.addColorStop(0, paper.ink);
    grad.addColorStop(0.66, paper.ink);
    grad.addColorStop(1, paper.inkTop);
    g.strokeStyle = grad;
    g.lineCap = 'round';
    for (var s = 0; s < data.segs.length; s++) {
      var sg = data.segs[s];
      g.lineWidth = Math.max(0.7, sg.w);
      g.beginPath();
      g.moveTo(sg.x1, sg.y1);
      g.quadraticCurveTo(sg.cx, sg.cy, sg.x2, sg.y2);
      g.stroke();
    }
    // 叶群：稀一点的金绿点，压住"纯剪影贴纸"的感觉
    var leaves = data.leaves || [];
    for (var li = 0; li < leaves.length; li += 3) {
      g.globalAlpha = night ? 0.18 + (li % 5) * 0.03 : 0.30 + (li % 5) * 0.05;
      g.fillStyle = li % 7 === 0 ? paper.dry : paper.leaf;
      g.beginPath();
      g.arc(leaves[li].x, leaves[li].y, night ? 1.8 : 2.2, 0, 6.283);
      g.fill();
    }
    g.globalAlpha = 1;

    var pos = placed[i] || placeAt(i);
    return {
      i: i, id: id, seed: seed, pos: pos, height: height, crownK: crownK,
      tilt: tilt, face: face, phase: phase, sprite: spr, glowGrad: null
    };
  }

  /* —— 屏幕布局：树、影子、生物锚点共用 —— */
  function layoutTrees(trees) {
    var horizon = H * 0.46;
    var groundTop = horizon + 22;
    var margin = W * 0.05;
    var midX = 0;
    trees.forEach(function (t) { midX += t.pos.x; });
    midX = trees.length ? midX / trees.length : 0.5;

    // 棵数越多，单棵收小一点：1 棵是主角，20 棵才装得进一片
    var sizeK = N <= 3 ? 1 : (N <= 8 ? 0.86 : 0.68);

    trees.forEach(function (t) {
      var d = t.pos.d;
      var scale = 0.52 + 0.62 * d;
      var gx = W / 2 + (t.pos.x - midX) * (W - margin * 2) * (0.80 + 0.20 * d);
      var gy = groundTop + Math.pow(d, 1.15) * (H - groundTop - 54);
      var h = H * 0.56 * t.height * scale * sizeK;
      var w = h * 0.80 * t.crownK;
      var half = w * 0.40;
      gx = Math.max(margin + half, Math.min(W - margin - half, gx));
      t.lay = { gx: gx, gy: gy, h: h, w: w, d: d };
    });
  }

  function resize() {
    W = window.innerWidth; H = window.innerHeight;
    DPR = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(W * DPR);
    cv.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  /* —— 地面与远景画一次，缓存起来 —— */
  var groundCv = document.createElement('canvas');
  function renderGround() {
    groundCv.width = cv.width;
    groundCv.height = cv.height;
    var g = groundCv.getContext('2d');
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawGround(g);
  }

  function drawGround(g) {
    var sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, paper.sky0);
    sky.addColorStop(1, paper.sky1);
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);

    var horizon = H * 0.46;
    var r = rng(hash(place + '#hill'));

    // 夜里加一层很浅的星，给"夜"一个参照，不是满屏
    if (night) {
      var rs = rng(hash(place + '#stars'));
      g.fillStyle = '#E7E2C8';
      for (var si = 0; si < 54; si++) {
        var sx = rs() * W, sy = rs() * horizon * 0.82;
        g.globalAlpha = 0.10 + rs() * 0.34;
        g.beginPath();
        g.arc(sx, sy, 0.5 + rs() * 0.7, 0, 6.283);
        g.fill();
      }
      g.globalAlpha = 1;
    }

    // 远山：两笔很浅的起伏
    g.fillStyle = paper.hillFar;
    g.globalAlpha = 0.75;
    g.beginPath();
    g.moveTo(0, horizon);
    for (var x = 0; x <= W; x += W / 6) g.quadraticCurveTo(x + W / 12, horizon - 26 - r() * 30, x + W / 6, horizon - 6 - r() * 10);
    g.lineTo(W, H); g.lineTo(0, H); g.closePath(); g.fill();
    g.globalAlpha = 1;

    // 地面：轻微起伏，不是一条直线
    var g0 = g.createLinearGradient(0, horizon, 0, H);
    g0.addColorStop(0, paper.hillNear);
    g0.addColorStop(1, paper.ground1);
    g.fillStyle = g0;
    g.beginPath();
    g.moveTo(0, horizon + 18);
    for (var x2 = 0; x2 <= W; x2 += W / 5) {
      g.quadraticCurveTo(x2 + W / 10, horizon + 6 + r() * 16, x2 + W / 5, horizon + 18 + r() * 8);
    }
    g.lineTo(W, H); g.lineTo(0, H); g.closePath(); g.fill();

    // 草与落叶：只做暗示，不抢树
    var rr = rng(hash(place + '#grass'));
    g.strokeStyle = night ? '#1F3028' : paper.ink;
    for (var i = 0; i < 260; i++) {
      var gx = rr() * W;
      var gy = horizon + 40 + rr() * (H - horizon - 60);
      var len = 3 + rr() * 5;
      g.globalAlpha = (night ? 0.10 : 0.06) + rr() * 0.10;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(gx, gy);
      g.quadraticCurveTo(gx + (rr() - 0.5) * 3, gy - len * 0.6, gx + (rr() - 0.5) * 5, gy - len);
      g.stroke();
    }
    for (var j = 0; j < 90; j++) {
      var lx = rr() * W, ly = horizon + 26 + rr() * (H - horizon - 40);
      g.globalAlpha = 0.10 + rr() * 0.12;
      g.fillStyle = rr() < 0.5 ? paper.dry : paper.leaf;
      g.beginPath();
      g.ellipse(lx, ly, 2.4 + rr() * 2, 1.1 + rr(), rr() * 3, 0, 6.283);
      g.fill();
    }
    g.globalAlpha = 1;
  }

  function drawGrove(trees, now) {
    // 远的先画，近的后画：遮挡才成立
    var order = trees.slice().sort(function (a, b) { return a.lay.d - b.lay.d; });

    // 影子单独一遍、全部先落在地上：否则近处的影子会盖到远处树的冠上，像一块污渍
    order.forEach(function (t) {
      var lay = t.lay;
      ctx.fillStyle = night ? 'rgba(0,0,0,' + (0.12 + 0.08 * lay.d) + ')'
        : 'rgba(51,64,47,' + (0.06 + 0.07 * lay.d) + ')';
      ctx.beginPath();
      ctx.ellipse(lay.gx, lay.gy + lay.h * 0.015, lay.w * 0.30, lay.w * 0.055, 0, 0, 6.283);
      ctx.fill();
    });

    order.forEach(function (t) {
      var lay = t.lay;
      // 风：极慢的摆，1 棵时也只靠它证明"活着"
      var sway = Math.sin(now * 0.00042 + t.phase) * (N <= 3 ? 0.006 : 0.0035);

      ctx.save();
      ctx.translate(lay.gx, lay.gy);
      ctx.rotate(t.tilt + sway);
      ctx.scale(t.face, 1);
      ctx.globalAlpha = (night ? 0.62 : 0.40) + (night ? 0.38 : 0.60) * lay.d;
      ctx.drawImage(t.sprite, -lay.w / 2, -lay.h * 0.959, lay.w, lay.h);
      ctx.restore();
      ctx.globalAlpha = 1;
    });
  }

  /* —— 20 棵的夜：整片树冠亮起来（灯不是粒子） —— */
  function drawCanopyGlow(trees, now) {
    ctx.globalCompositeOperation = 'lighter';
    trees.forEach(function (t) {
      var lay = t.lay;
      if (!t.glowGrad) {
        var cx = lay.gx, cy = lay.gy - lay.h * 0.66, rr = lay.w * 0.50;
        var gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
        gr.addColorStop(0, 'rgba(255,214,140,0.60)');
        gr.addColorStop(0.55, 'rgba(255,190,110,0.24)');
        gr.addColorStop(1, 'rgba(255,176,96,0)');
        t.glowGrad = { g: gr, cx: cx, cy: cy, r: rr };
      }
      var gg = t.glowGrad;
      var breath = 0.5 + 0.5 * Math.sin(now * 0.00055 + t.phase);
      ctx.globalAlpha = 0.16 + 0.10 * breath;
      ctx.fillStyle = gg.g;
      ctx.beginPath();
      ctx.arc(gg.cx, gg.cy, gg.r, 0, 6.283);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /* —— 生物：数量按棵数分级，昼蝶/鸟，夜萤火虫 —— */
  var life = { butterflies: [], birds: [], fireflies: [] };

  function buildLife() {
    life = { butterflies: [], birds: [], fireflies: [] };
    if (!lifeOn || !trees.length) return;
    var r = rng(hash(place + '#life' + (night ? 'n' : 'd') + N));

    // 轮流落在每棵树上：随机抽会全挤到同一棵，看起来像一棵树着了火
    var order = trees.map(function (t) { return t.i; });
    for (var q2 = order.length - 1; q2 > 0; q2--) {
      var jj = (r() * (q2 + 1)) | 0;
      var tmp = order[q2]; order[q2] = order[jj]; order[jj] = tmp;
    }
    var oi = 0;

    function anchor(kMin, kSpan) {
      var t = trees[order[oi++ % order.length]];
      var lay = t.lay;
      return {
        x: lay.gx + (r() - 0.5) * lay.w * 0.55,
        // 只落在冠层：太低会像挂在树干上
        y: lay.gy - lay.h * (kMin + r() * kSpan),
        s: 0.7 + lay.d * 0.6
      };
    }

    if (!night) {
      // 昼：蝴蝶 3 棵起，最多 6；鸟 8 棵起，最多 3
      var nb = N >= 3 ? Math.min(6, 1 + Math.floor(N / 3)) : 0;
      for (var i = 0; i < nb; i++) {
        var a = anchor(0.56, 0.36);
        life.butterflies.push({
          ax: a.x, ay: a.y, s: 1.6 + a.s * 1.0,
          a1: 12 + r() * 24, a2: 4 + r() * 9,
          w1: 0.00035 + r() * 0.00045, w2: 0.0011 + r() * 0.0012,
          p1: r() * 6.283, p2: r() * 6.283,
          flap: 0.006 + r() * 0.004,
          col: r() < 0.5 ? 'rgba(140,74,43,0.80)' : 'rgba(84,102,64,0.78)',
          col2: r() < 0.5 ? 'rgba(205,158,94,0.62)' : 'rgba(158,174,112,0.60)'
        });
      }
      var nbird = N >= 8 ? Math.min(3, 1 + Math.floor((N - 8) / 5)) : 0;
      for (var b = 0; b < nbird; b++) {
        life.birds.push({
          x0: r() * W, y0: H * (0.14 + r() * 0.16),
          dir: r() < 0.5 ? -1 : 1,
          sp: (5 + r() * 5) * (W / 1280),
          p1: r() * 6.283, s: 1.4 + r() * 0.7
        });
      }
    } else {
      // 夜：萤火虫 3 棵起，最多 24
      var nf = N >= 3 ? Math.min(24, 4 + N) : 0;
      for (var f = 0; f < nf; f++) {
        var af = anchor(0.34, 0.56);
        life.fireflies.push({
          ax: af.x, ay: af.y, s: af.s,
          a1: 8 + r() * 22, a2: 3 + r() * 8,
          w1: 0.00022 + r() * 0.00035, w2: 0.0007 + r() * 0.0011,
          p1: r() * 6.283, p2: r() * 6.283,
          blink: 0.0009 + r() * 0.0014,
          rad: 1.1 + r() * 1.2
        });
      }
    }
  }

  function butterflyPos(b, now) {
    return {
      x: b.ax + Math.sin(now * b.w1 + b.p1) * b.a1 + Math.sin(now * b.w2 + b.p2) * b.a2,
      y: b.ay + Math.cos(now * b.w1 * 0.8 + b.p2) * b.a2 + Math.sin(now * b.w2 * 1.2 + b.p1) * b.a1 * 0.55
    };
  }

  function drawButterflies(now) {
    life.butterflies.forEach(function (b) {
      var p = butterflyPos(b, now);
      var p2 = butterflyPos(b, now + 60);
      var ang = Math.atan2(p2.y - p.y, p2.x - p.x);
      var f = 0.55 + 0.45 * Math.abs(Math.sin(now * b.flap + b.p1));
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(ang);
      ctx.scale(b.s, b.s);

      // 上下两片翅膀分开画，中间留出身体：合在一起就成了一个褐色椭圆
      [-1, 1].forEach(function (side) {
        ctx.fillStyle = b.col;
        ctx.beginPath();
        ctx.ellipse(-0.8 * f, side * 3.3, 3.7 * f, 2.4, side * 0.42, 0, 6.283);
        ctx.fill();
        ctx.fillStyle = b.col2;
        ctx.beginPath();
        ctx.ellipse(-1.0 * f, side * 3.2, 1.9 * f, 1.2, side * 0.42, 0, 6.283);
        ctx.fill();
      });

      ctx.strokeStyle = 'rgba(52,62,46,0.78)';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(-2.4 * f, 0);
      ctx.lineTo(3.2, 0);
      ctx.stroke();
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(3.0, 0);
      ctx.quadraticCurveTo(4.8, -1.2, 6.0, -2.4);
      ctx.moveTo(3.0, 0);
      ctx.quadraticCurveTo(5.0, 0.6, 6.2, 1.6);
      ctx.stroke();
      ctx.restore();
    });
  }

  function drawBirds(now) {
    life.birds.forEach(function (b) {
      var span = W + 140;
      var raw = b.x0 + now * b.sp * b.dir;
      var x = ((raw % span) + span) % span - 70;
      var y = b.y0 + Math.sin(now * 0.0007 + b.p1) * 10;
      var flap = Math.sin(now * 0.0032 + b.p1) * 0.5 + 0.5;
      var glide = 0.30 + 0.70 * Math.max(0, Math.sin(now * 0.0005 + b.p1 * 1.6));
      var k = (2.5 + 4.5 * flap * glide) * b.s;
      ctx.strokeStyle = night ? 'rgba(220,227,210,0.5)' : 'rgba(40,54,48,0.62)';
      ctx.lineWidth = 1.25;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x - k, y - k * 0.7);
      ctx.quadraticCurveTo(x - k * 0.4, y - k * 0.15, x, y);
      ctx.quadraticCurveTo(x + k * 0.4, y - k * 0.15, x + k, y - k * 0.7);
      ctx.stroke();
    });
  }

  function drawFireflies(now) {
    ctx.globalCompositeOperation = 'lighter';
    life.fireflies.forEach(function (f) {
      var x = f.ax + Math.sin(now * f.w1 + f.p1) * f.a1 + Math.sin(now * f.w2 + f.p2) * f.a2;
      var y = f.ay + Math.cos(now * f.w1 * 0.9 + f.p2) * f.a2 + Math.sin(now * f.w2 * 1.1 + f.p1) * f.a1 * 0.5;
      var br = Math.pow(0.5 + 0.5 * Math.sin(now * f.blink + f.p1), 2);
      var a = 0.12 + 0.88 * br;
      if (a < 0.14) return;
      var r = (6 + 4 * br) * f.s;
      var gr = ctx.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,226,160,' + (0.30 * a).toFixed(3) + ')');
      gr.addColorStop(1, 'rgba(255,200,110,0)');
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 6.283);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,244,206,' + (0.85 * a).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(x, y, f.rad * f.s, 0, 6.283);
      ctx.fill();
    });
    ctx.globalCompositeOperation = 'source-over';
  }

  /* —— 渲染循环 —— */
  var trees = [];
  var lastDraw = 0;

  function drawFrame(now) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(groundCv, 0, 0, W, H);

    drawGrove(trees, now);
    if (night && N >= 20) drawCanopyGlow(trees, now);
    if (lifeOn) {
      if (night) drawFireflies(now);
      else { drawButterflies(now); drawBirds(now); }
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (now - lastDraw < 1000 / FPS_CAP) return;
    lastDraw = now;
    drawFrame(now);
  }

  /* —— 状态与文案 —— */
  function stateTag() {
    var base;
    if (N >= MAX_DRAW) base = '上限 · 只画 ' + MAX_DRAW + ' 棵';
    else if (N >= CROWD_AT) base = '拥挤 · 冠层交叠';
    else if (N >= 4) base = '成林 · 开始相接';
    else base = '稀疏 · 各自留白';

    if (!lifeOn) return base + ' · 生物关';
    if (night) return base + (life.fireflies.length ? ' · 萤 ' + life.fireflies.length : ' · 只有风');
    var bits = [];
    if (life.butterflies.length) bits.push('蝶 ' + life.butterflies.length);
    if (life.birds.length) bits.push('鸟 ' + life.birds.length);
    return base + ' · ' + (bits.length ? bits.join(' / ') : '只有风');
  }

  function updateHUD() {
    document.getElementById('sub').textContent =
      N + ' 棵' + (N > MAX_DRAW ? '（画 ' + MAX_DRAW + ' 棵，另有 ' + (N - MAX_DRAW) + ' 棵只在球面加深）' : '') +
      (night ? ' · 夜' : ' · 昼');
    document.getElementById('stateTag').textContent = stateTag();
    document.body.classList.toggle('night', night);

    var tb = document.getElementById('timeBtn');
    if (tb) {
      tb.textContent = night ? '昼' : '夜';
      tb.setAttribute('title', night ? '切到白天' : '切到夜里');
    }
    var lb = document.getElementById('lifeToggle');
    if (lb) {
      lb.textContent = lifeOn ? '生物 · 开' : '生物 · 关';
      lb.classList.toggle('on', lifeOn);
      lb.setAttribute('aria-pressed', lifeOn ? 'true' : 'false');
    }

    var foot = document.getElementById('foot');
    foot.innerHTML =
      '1–3 棵各自占位、留白多 · 4–7 棵成林、冠层相接 · ' + CROWD_AT + ' 棵起算拥挤，后排被前排挡住，间距也不再等距<br>' +
      '生物：1 棵只有风 · 3 棵起有虫（昼蝶 ≤6 / 夜萤 ≤24）· 8 棵起有鸟（≤3）· 20 棵夜里整片树冠亮起来；' +
      '昼间只用实体色，不加色发光；生物可关<br>' +
      '性能预算：地面与远景缓存，每帧最多 20 张树 sprite + 30 个生物，DPR ≤ 2，封顶 ' + FPS_CAP + 'fps；' +
      '上限 ' + MAX_DRAW + ' 棵 / 处，再多只在球面加深，不再往这一层加树';
  }

  /* —— 启动与交互 —— */
  function spreadX() {
    if (placed.length < 2) return;
    var mn = 1, mx = 0;
    placed.forEach(function (p) { if (p.x < mn) mn = p.x; if (p.x > mx) mx = p.x; });
    var span = mx - mn;
    if (span < 0.02) return;
    placed.forEach(function (p) { p.x = 0.06 + ((p.x - mn) / span) * 0.88; });
  }

  function rebuildTrees() {
    trees = [];
    var shown = Math.min(N, MAX_DRAW);
    for (var i = 0; i < shown; i++) trees.push(makeTree(i));
  }

  function boot() {
    resize();
    var shown = Math.min(N, MAX_DRAW);
    placed.length = 0;
    for (var i = 0; i < shown; i++) placeAt(i);
    // 落点再摊开一次：不管随机怎么长，这片林子都该用满画面宽度
    spreadX();

    rebuildTrees();
    layoutTrees(trees);
    renderGround();
    buildLife();
    updateHUD();

    document.querySelectorAll('.steps a').forEach(function (a) {
      var href = a.getAttribute('href') || '';
      if (href.indexOf('n=' + N) > -1 && href.indexOf('layout') < 0) a.classList.add('on');
      if (a.dataset.layout === layout) a.classList.add('on');
    });

    var tb = document.getElementById('timeBtn');
    if (tb) tb.addEventListener('click', function () {
      night = !night;
      paper = night ? PALETTES.night : PALETTES.day;
      trees.forEach(function (t) { t.glowGrad = null; });
      rebuildTrees();
      layoutTrees(trees);
      renderGround();
      buildLife();
      updateHUD();
      drawFrame(performance.now());
      try {
        var u = new URL(location.href);
        if (night) u.searchParams.set('t', 'night'); else u.searchParams.delete('t');
        history.replaceState(null, '', u);
      } catch (e) {}
    });

    var lb = document.getElementById('lifeToggle');
    if (lb) lb.addEventListener('click', function () {
      lifeOn = !lifeOn;
      buildLife();
      updateHUD();
      drawFrame(performance.now());
    });

    window.addEventListener('resize', function () {
      resize();
      layoutTrees(trees);
      renderGround();
      buildLife();
      drawFrame(performance.now());
    });

    requestAnimationFrame(frame);

    // 调试口：位置与生物数量可以直接查
    window.__grove = {
      get trees() { return trees; },
      get life() { return life; },
      get night() { return night; },
      get lifeOn() { return lifeOn; }
    };
  }

  boot();
})();
