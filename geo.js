/* =========================================================
   换骨：把一张真实水系图，重排成一棵向上生长的树

   为什么要重排，而不是直接喂进去：
   河网本身和树是同构的（都是分形输运网络），但河网是"俯视"的，
   铺满画布、没有重心；树是"仰视"的，从根部收拢、向上发散。
   直接喂进去得到的一定是一张躺着的地图。

   所以这里做三件事：
   1. 把河网建成图，取它的主干（图直径）作为树的脊梁
   2. 用 DFS 把网状的河砍成一棵真正的树
   3. 按"子树重量"分配每一层的张角——大河占大扇区，小溪挤在边上，
      于是它张开的样子，就是这个流域真实的分支比例
   ========================================================= */
(function () {
  'use strict';

  var Q = new URLSearchParams(location.search);
  var BASIN = Q.get('b') || '密西西比流域';
  var SPREAD = parseFloat(Q.get('spread') || '1.35');    // 每层基础张角（弧度）
  var DECAY = parseFloat(Q.get('decay') || '0.94');     // 每深一层张角衰减
  var LEAN = parseFloat(Q.get('lean') || '0.05');       // 枝梢受重力下垂的程度
  var TILT = parseFloat(Q.get('tilt') || '1.06');       // 侧枝离"竖直"最多偏多少（弧度）
  var WF = parseFloat(Q.get('wf') || '0.90');           // 张角随深度衰减的下限
  var LE = parseFloat(Q.get('le') || '0.45');           // 枝长 = 地理长度^LE
  var LK = parseFloat(Q.get('lk') || '0.58');           // 枝长系数
  var DH = parseFloat(Q.get('dh') || '0.80');           // 超过这个高度开始压枝
  var DK = parseFloat(Q.get('dk') || '2.20');           // 压枝强度
  var GD = parseFloat(Q.get('gd') || '0.05');           // 嫁接最远距离
  var PT = parseFloat(Q.get('pt') || '0.45');           // 单子节点（河道弯）长度压缩
  var CELL = 0.008;    // 空间哈希格
  var SNAP = 0.0035;   // 这个半径内的两个端点算同一个路口（太大就会把平行河道吸成一条）
  var debugGraft = 0;

  // 稳定的伪随机：同一个下标永远得到同一个值，刷新不会让树变形
  function jitter(i) {
    var x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  /* ---------- 1. 线段 → 图 ---------- */
  function buildGraph(data) {
    var nodes = [];
    var index = {};
    var edges = [];

    // 不能用"四舍五入到格子"直接当 key：两个几乎重合的端点
    // 只要落在格子两侧就会被拆成两个点，整张网就断成很多孤岛。
    // 所以查 3×3 邻域，取半径内最近的那个点复用。
    function idOf(x, y) {
      var gx = Math.floor(x / CELL), gy = Math.floor(y / CELL);
      var best = -1, bestD = SNAP;
      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          var list = index[(gx + dx) + ',' + (gy + dy)];
          if (!list) continue;
          for (var i = 0; i < list.length; i++) {
            var nd = nodes[list[i]];
            var d = Math.hypot(nd.x - x, nd.y - y);
            if (d < bestD) { bestD = d; best = list[i]; }
          }
        }
      }
      if (best >= 0) return best;

      var id = nodes.length;
      nodes.push({ x: x, y: y, nb: [] });
      var k = gx + ',' + gy;
      (index[k] = index[k] || []).push(id);
      return id;
    }

    for (var li = 0; li < data.lines.length; li++) {
      var line = data.lines[li];
      var p = line.p;
      for (var i = 0; i < p.length - 1; i++) {
        var a = idOf(p[i][0], p[i][1]);
        var b = idOf(p[i + 1][0], p[i + 1][1]);
        if (a === b) continue;
        var len = Math.hypot(nodes[a].x - nodes[b].x, nodes[a].y - nodes[b].y);
        if (len < 1e-6) continue;
        edges.push({ a: a, b: b, len: len, rank: line.r, name: line.n });
        nodes[a].nb.push({ v: b, len: len, rank: line.r, name: line.n });
        nodes[b].nb.push({ v: a, len: len, rank: line.r, name: line.n });
      }
    }
    return { nodes: nodes, edges: edges };
  }

  /* ---------- 1.5 压缩：把度数为 2 的中间点串成一条边 ----------
     河道是密集采样点，一条河能压出一百多层。如果不压，深度就是
     "采样点数"而不是"分叉层数"，深度衰减会把所有支流缩成 0 长度，
     整棵树变成一根棍。压完之后深度才等于真正的分叉层数。 */
  function compressGraph(nodes) {
    var n = nodes.length;
    var deg = new Int32Array(n);
    for (var i = 0; i < n; i++) deg[i] = nodes[i].nb.length;

    var isKey = new Uint8Array(n);
    var keyCount = 0;
    for (var j = 0; j < n; j++) {
      if (deg[j] !== 2) { isKey[j] = 1; keyCount++; }
    }
    if (!keyCount) {   // 整张图是个环
      for (var k = 0; k < n; k++) if (deg[k]) { isKey[k] = 1; break; }
    }

    var edges = [];
    var seenEdge = {};

    for (var s = 0; s < n; s++) {
      if (!isKey[s]) continue;
      var nb = nodes[s].nb;
      for (var m = 0; m < nb.length; m++) {
        var a = s, b = nb[m].v, len = nb[m].len, guard = 0;
        // 一条压出来的长边可能跨好几条河，取其中等级最高的那条的名字
        var nm = nb[m].name || '', rk = nb[m].rank || 6;
        while (!isKey[b] && guard++ < 40000) {
          var nb2 = nodes[b].nb;
          var nxt = -1, nl = 0, pick = null;
          for (var q = 0; q < nb2.length; q++) {
            if (nb2[q].v !== a) { nxt = nb2[q].v; nl = nb2[q].len; pick = nb2[q]; break; }
          }
          if (nxt < 0) break;
          if (pick && pick.rank < rk) { rk = pick.rank; nm = pick.name || nm; }
          a = b; b = nxt; len += nl;
        }
        if (b === s) continue;
        var ek = Math.min(s, b) + ':' + Math.max(s, b);
        if (seenEdge[ek]) continue;
        seenEdge[ek] = 1;
        edges.push({ a: s, b: b, len: len, name: nm, rank: rk });
      }
    }

    var out = [];
    var remap = new Int32Array(n).fill(-1);
    function idOf(orig) {
      if (remap[orig] < 0) {
        remap[orig] = out.length;
        out.push({ x: nodes[orig].x, y: nodes[orig].y, nb: [] });
      }
      return remap[orig];
    }

    for (var e = 0; e < edges.length; e++) {
      var ia = idOf(edges[e].a), ib = idOf(edges[e].b);
      if (ia === ib) continue;
      out[ia].nb.push({ v: ib, len: edges[e].len, name: edges[e].name, rank: edges[e].rank });
      out[ib].nb.push({ v: ia, len: edges[e].len, name: edges[e].name, rank: edges[e].rank });
    }
    return out;
  }

  /* ---------- 2. 找最大的连通块（河网常常是几块分开的） ---------- */
  function largestComponent(nodes) {
    var seen = new Uint8Array(nodes.length);
    var best = null, bestSize = 0;

    for (var s = 0; s < nodes.length; s++) {
      if (seen[s] || !nodes[s].nb.length) continue;
      var q = [s], cnt = 0;
      seen[s] = 1;
      for (var i = 0; i < q.length; i++) {
        cnt++;
        var nb = nodes[q[i]].nb;
        for (var j = 0; j < nb.length; j++) {
          var v = nb[j].v;
          if (!seen[v]) { seen[v] = 1; q.push(v); }
        }
      }
      if (cnt > bestSize) { bestSize = cnt; best = q; }
    }

    var mark = new Uint8Array(nodes.length);
    if (best) for (var k = 0; k < best.length; k++) mark[best[k]] = 1;
    return { mark: mark, member: best || [], size: bestSize };
  }

  /* ---------- 2.5 嫁接：把断开的河段接回主干 ----------
     Natural Earth 的河是一段段独立画的，支流河口和干流往往差着十几公里，
     谁也连不上谁。只取"最大连通块"会把四成的河段直接扔掉，树就成了
     一根光杆。这里把每个孤岛按最近距离嫁接到主干上——真实的河本来就是
     连着的，只是这张图没画出来。 */
  function graft(nodes, mainMark) {
    var main = [];
    for (var i = 0; i < nodes.length; i++) if (mainMark[i]) main.push(i);
    if (!main.length) return 0;

    var seen = new Uint8Array(nodes.length);
    var added = 0;

    for (var s = 0; s < nodes.length; s++) {
      if (seen[s] || mainMark[s] || !nodes[s].nb.length) continue;

      // 取出这一块
      var comp = [s], q = [s];
      seen[s] = 1;
      for (var h = 0; h < q.length; h++) {
        var nb = nodes[q[h]].nb;
        for (var j = 0; j < nb.length; j++) {
          var v = nb[j].v;
          if (!seen[v]) { seen[v] = 1; comp.push(v); q.push(v); }
        }
      }
      if (comp.length < 3) continue;   // 太碎的不要，接上去只是毛刺

      // 找这一块离主干最近的接口
      var bestD = 1e9, bestU = -1, bestV = -1;
      for (var a = 0; a < comp.length; a++) {
        var u = comp[a];
        for (var b = 0; b < main.length; b++) {
          var w = main[b];
          var d = Math.hypot(nodes[u].x - nodes[w].x, nodes[u].y - nodes[w].y);
          if (d < bestD) { bestD = d; bestU = u; bestV = w; }
        }
      }
      if (bestU < 0 || bestD > GD) continue;   // 太远的不是支流，是另一条河

      nodes[bestU].nb.push({ v: bestV, len: bestD, rank: 6, name: '' });
      nodes[bestV].nb.push({ v: bestU, len: bestD, rank: 6, name: '' });
      added++;
    }
    return added;
  }

  /* ---------- 3. 两遍 BFS 找图的直径（最长主干） ---------- */
  function bfsFar(nodes, start, mark) {
    var dist = new Int32Array(nodes.length).fill(-1);
    var q = [start];
    dist[start] = 0;
    var best = start;
    for (var i = 0; i < q.length; i++) {
      var u = q[i];
      if (dist[u] > dist[best]) best = u;
      var nb = nodes[u].nb;
      for (var j = 0; j < nb.length; j++) {
        var v = nb[j].v;
        if (dist[v] < 0 && mark[v]) { dist[v] = dist[u] + 1; q.push(v); }
      }
    }
    return { far: best };
  }

  /* ---------- 4. DFS 把网状砍成树 ---------- */
  function makeTree(nodes, root) {
    var parent = new Int32Array(nodes.length).fill(-1);
    var children = new Array(nodes.length);
    var seen = new Uint8Array(nodes.length);
    var order = [];

    for (var i = 0; i < nodes.length; i++) children[i] = [];

    var stack = [root];
    seen[root] = 1;
    while (stack.length) {
      var u = stack.pop();
      order.push(u);
      var nb = nodes[u].nb;
      for (var j = nb.length - 1; j >= 0; j--) {
        var v = nb[j].v;
        if (seen[v]) continue;
        seen[v] = 1;
        parent[v] = u;
        // 记下这条边的长度和河名，布局要用
        children[u].push({ v: v, len: nb[j].len, rank: nb[j].rank, name: nb[j].name });
        stack.push(v);
      }
    }
    return { parent: parent, children: children, order: order };
  }

  /* ---------- 4. 布局：按子树重量分张角 ---------- */
  function layout(nodes, tree, root) {
    var n = nodes.length;
    var weight = new Float32Array(n);
    var order = tree.order;

    for (var i = order.length - 1; i >= 0; i--) {
      var u = order[i];
      weight[u] += 1;
      var pu = tree.parent[u];
      if (pu >= 0) weight[pu] += weight[u];
    }

    var posX = new Float32Array(n);
    var posY = new Float32Array(n);
    var width = new Float32Array(n);
    var nodeAng = new Float32Array(n);
    var accLen = new Float32Array(n);   // 从根到这里已经走过的视觉长度
    var depthOf = new Int32Array(n).fill(-1);
    var maxW = 1;
    for (var k = 0; k < n; k++) if (weight[k] > maxW) maxW = weight[k];

    posX[root] = 0; posY[root] = 0;
    nodeAng[root] = -Math.PI / 2;
    depthOf[root] = 0;
    var queue = [root];
    var head = 0;

    while (head < queue.length) {
      var u = queue[head++];
      var kids = tree.children[u];
      if (!kids.length) continue;

      var depth = depthOf[u];
      var spread = Math.max(0.10, SPREAD * Math.pow(DECAY, depth));
      // 朝向往父链上继承。不能用位置反推——DFS 一回溯，
      // 父节点就可能出现在子节点的右下方，整条链会立刻歪掉
      var ang = nodeAng[u];

      // 每个分叉在一个扇形里展开：主轴占正中，其余按方位左右分列，
      // 相邻两根之间至少留一个最小夹角（否则长出一束平行线）。
      var byW = kids.slice().sort(function (p, q) { return weight[q.v] - weight[p.v]; });
      var main = byW[0];
      var byAz = byW.slice(1).sort(function (p, q) {
        return Math.atan2(nodes[p.v].y - nodes[u].y, nodes[p.v].x - nodes[u].x) -
          Math.atan2(nodes[q.v].y - nodes[u].y, nodes[q.v].x - nodes[u].x);
      });
      var mid = Math.ceil(byAz.length / 2);
      var leftK = byAz.slice(0, mid);
      var rightK = byAz.slice(mid);

      var wide = Math.max(SPREAD * WF, SPREAD * Math.pow(DECAY, depth));
      var angs = {};
      angs[main.v] = ang + (jitter(u * 3 + 1) - 0.5) * 0.05;

      // 侧枝按"第几根"分档：离主轴越远的一根越往外张
      var STEP = Math.min(wide * 1.25, 0.62);
      for (var li = 0; li < leftK.length; li++) {
        angs[leftK[li].v] = ang - STEP * (1 - li / (leftK.length + 0.6));
      }
      for (var ri = 0; ri < rightK.length; ri++) {
        angs[rightK[ri].v] = ang + STEP * (1 - ri / (rightK.length + 0.6));
      }
      // 张角不能超过扇区：超了就压回扇形边界
      for (var kk = 0; kk < kids.length; kk++) {
        var kv = kids[kk].v;
        if (kv === main.v) continue;
        var lim = angs[kv] - ang;
        if (lim > wide) angs[kv] = ang + wide * (1 + (lim - wide) * 0.15);
        if (lim < -wide) angs[kv] = ang - wide * (1 + (-lim - wide) * 0.15);
      }

      // 长度用原地理长度的开方来压缩：干流天然比支流长十倍，
      // 直接照搬会让树瘦成一根藤；开方之后比例接近真树的分叉递减。
      // 不再按"从根算的深度"衰减——那样深处的细枝会全部缩成 0。
      for (var pi = 0; pi < kids.length; pi++) {
        var kid = kids[pi];
        var na = angs[kid.v];

        // 主轴在树干这一段保持竖直。它本来是"最长的那条支流"，
        // 照着走整棵树会歪成一根斜藤
        if (kid === main && depth < 4) na = ang;

        // 枝不能长成水平甚至下垂——那会变成一副鱼骨，不是树。
        // 以"竖直向上"为轴做软钳制：越界的角度只保留 30%，避免硬截断
        // 把一堆枝压到同一角度（之前出现过一束平行线）。
        var UP = -Math.PI / 2;
        var dAng = na - UP;
        if (dAng > TILT) dAng = TILT + (dAng - TILT) * 0.30;
        if (dAng < -TILT) dAng = -TILT + (dAng + TILT) * 0.30;
        na = UP + dAng;

        // 侧枝被重力往下带一点，主干不弯
        var off = na - ang;
        na += (off >= 0 ? 1 : -0.45) * LEAN * Math.min(1, depth / 12);

        // 长度：原地理长度开方压缩后，再乘一个"越高越短"的阻尼。
        // 干流本身就很长，不压的话它会一路撑到画布顶端，
        // 整棵树变成一根藤，树冠全挤在角上。
        // 用高度而不是离根的直线距离——用直线距离会把树冠压成一个球。
        var baseL = Math.pow(kid.len, LE) * LK;
        var hgt = -posY[u];
        var damp = Math.exp(-Math.max(0, hgt - DH) * DK);
        var L = baseL * damp;

        // 只有一个孩子的节点（河道里的一个弯）在树里不该占那么长。
        // 真实地图上干流是一条连续的长线，不压的话树干会占到整棵树的六成，
        // 看起来像插在地上的棍子而不是树。
        if (kids.length === 1) L *= PT;
        posX[kid.v] = posX[u] + Math.cos(na) * L;
        posY[kid.v] = posY[u] + Math.sin(na) * L;
        depthOf[kid.v] = depth + 1;
        nodeAng[kid.v] = na;

        // 线宽 ∝ 子树大小：主干粗、末梢细
        width[kid.v] = 2 + 6.5 * Math.pow(weight[kid.v] / maxW, 0.38);

        queue.push(kid.v);
      }
    }

    return { x: posX, y: posY, w: width, weight: weight, depth: depthOf, order: order };
  }

  /* ---------- 5. 画成线稿 ---------- */
  function render(nodes, tree, lay) {
    var n = nodes.length;
    var minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (var i = 0; i < n; i++) {
      if (lay.depth[i] < 0) continue;
      if (lay.x[i] < minX) minX = lay.x[i];
      if (lay.x[i] > maxX) maxX = lay.x[i];
      if (lay.y[i] < minY) minY = lay.y[i];
      if (lay.y[i] > maxY) maxY = lay.y[i];
    }
    var bw = Math.max(1e-6, maxX - minX);
    var bh = Math.max(1e-6, maxY - minY);

    var H = 1150;
    var Wd = Math.max(240, Math.round(H * (bw / bh)));
    var pad = 34;

    var c = document.createElement('canvas');
    c.width = Wd; c.height = H;
    var g = c.getContext('2d');
    g.fillStyle = '#eae6db';
    g.fillRect(0, 0, Wd, H);

    var sx = (Wd - pad * 2) / bw;
    var sy = (H - pad * 2) / bh;
    var s = Math.min(sx, sy);
    var ox = (Wd - bw * s) / 2 - minX * s;
    var oy = (H - bh * s) / 2 - minY * s;

    function mx(i) { return lay.x[i] * s + ox; }
    function my(i) { return lay.y[i] * s + oy; }

    g.strokeStyle = '#171717';
    g.lineCap = 'round';
    g.lineJoin = 'round';

    // 先细后粗，交叉处才不会被细线切断
    var segs = [];
    for (var u = 0; u < n; u++) {
      if (lay.depth[u] < 0) continue;
      var kids = tree.children[u];
      for (var k = 0; k < kids.length; k++) {
        segs.push({ a: u, b: kids[k].v, w: lay.w[kids[k].v] });
      }
    }
    segs.sort(function (p, q) { return p.w - q.w; });

    var tips = [];
    for (var j = 0; j < segs.length; j++) {
      var sg = segs[j];
      g.lineWidth = sg.w;
      var ax = mx(sg.a), ay = my(sg.a);
      var bx2 = mx(sg.b), by2 = my(sg.b);

      // 直线会变成一副鱼骨。真树的枝在分叉处先顺着父枝方向出来，
      // 再慢慢拐到自己该去的方向——用二次贝塞尔把拐点做出来。
      var ina = lay.depth[sg.a] > 0 ? Math.atan2(lay.y[sg.a] - lay.y[tree.parent[sg.a]],
        lay.x[sg.a] - lay.x[tree.parent[sg.a]]) : -Math.PI / 2;
      var dd = Math.hypot(bx2 - ax, by2 - ay) * 0.52;
      g.beginPath();
      g.moveTo(ax, ay);
      g.quadraticCurveTo(ax + Math.cos(ina) * dd, ay + Math.sin(ina) * dd, bx2, by2);
      g.stroke();
    }

    // 末梢补枝。Natural Earth 只到"大支流"这一级——一条流域在图上
    // 只有几十根枝，真树有几千根。不补的话它永远是一根插了几根刺的棍子。
    // 补法：沿每根细枝按自相似规则再长两级小枝，主干（线宽大）保持光秃。
    var FUZZ = parseFloat(Q.get('fuzz') || '1.25');

    function rnd(i) {
      var x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
      return x - Math.floor(x);
    }

    function twig(x0, y0, ang, len, w, dep, seed) {
      if (len < 9 || dep > 2) return;
      var x1 = x0 + Math.cos(ang) * len, y1 = y0 + Math.sin(ang) * len;
      g.lineWidth = w;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();

      for (var i = 0; i < 2; i++) {
        var side = (rnd(seed + i * 7.3) > 0.5 ? 1 : -1);
        var na = ang + side * (0.42 + 0.35 * rnd(seed + i * 3.1));
        if (Math.sin(na) > -0.10) na = ang - side * (0.50 + 0.3 * rnd(seed + i));  // 别朝下
        twig(x1, y1, na,
          len * (0.58 + 0.16 * rnd(seed + i * 11)),
          w * 0.78, dep + 1, seed + i * 19 + 5);
      }
    }

    if (FUZZ > 0) {
      // 树的下半截是树干，不该长细枝——否则树根附近飘一层碎光点，像噪点
      var yMid = oy + bh * s * 0.58;
      for (var j2 = 0; j2 < segs.length; j2++) {
        var s2 = segs[j2];
        if (s2.w > 4.4) continue;                // 主干不长毛
        var A = { x: mx(s2.a), y: my(s2.a) }, B = { x: mx(s2.b), y: my(s2.b) };
        if ((A.y + B.y) / 2 > yMid) continue;
        var dl = Math.hypot(B.x - A.x, B.y - A.y);
        if (dl < 22) continue;
        var ang0 = Math.atan2(B.y - A.y, B.x - A.x);
        var stepN = Math.min(3, Math.max(1, Math.round(dl / 70)));
        for (var q2 = 0; q2 < stepN; q2++) {
          var f = 0.35 + 0.55 * (stepN === 1 ? 0.5 : q2 / (stepN - 1));
          var px = A.x + (B.x - A.x) * f, py = A.y + (B.y - A.y) * f;
          var sd = rnd(j2 * 5.7 + q2 * 2.3) > 0.5 ? 1 : -1;
          var ta = ang0 + sd * (0.52 + 0.32 * rnd(j2 + q2 * 9.1));
          if (Math.sin(ta) > -0.10) ta = ang0 - sd * (0.55 + 0.25 * rnd(j2 * 2 + q2));
          var tl = Math.min(105, Math.max(30, dl * 0.42)) * (0.80 + 0.45 * rnd(j2 * 13 + q2 * 3.7));
          twig(px, py, ta, tl * FUZZ, 1.8, 0, j2 * 31 + q2 * 17 + 3);
        }
      }
    }

    // 枝梢再补一簇，让轮廓不至于是一根根秃尖
    for (var t3 = 0; t3 < n; t3++) {
      if (lay.depth[t3] < 0) continue;
      if (tree.children[t3].length) continue;
      var pu3 = tree.parent[t3];
      var da = pu3 >= 0
        ? Math.atan2(lay.y[t3] - lay.y[pu3], lay.x[t3] - lay.x[pu3])
        : -Math.PI / 2;
      twig(mx(t3), my(t3), da, (24 + 16 * rnd(t3 * 7.7)) * FUZZ, 1.6, 0, t3 * 13 + 2);
    }

    // 每个节点是从哪条河过来的——挂地名要用
    var nameOf = {}, rankOf = {};
    for (var u2 = 0; u2 < n; u2++) {
      if (lay.depth[u2] < 0) continue;
      var ks = tree.children[u2];
      for (var k2 = 0; k2 < ks.length; k2++) {
        nameOf[ks[k2].v] = ks[k2].name;
        rankOf[ks[k2].v] = ks[k2].rank;
      }
    }

    // 枝梢（树的最外端）——后面要往上挂地名
    for (var v = 0; v < n; v++) {
      if (lay.depth[v] < 0) continue;
      if (tree.children[v].length) continue;
      tips.push({
        nx: mx(v) / Wd, ny: my(v) / H,
        depth: lay.depth[v],
        name: nameOf[v] || '', rank: rankOf[v] || 9
      });
    }

    return { canvas: c, tips: tips, W: Wd, H: H };
  }

  /* ---------- 7. 地图语言：地名 + 图例 ----------
     不能把这些画进线稿里——线稿会被阈值当成"树"再细化一遍，
     字会烂成一团骨架。所以挂成 HTML 层，按树的实际变换对位。 */
  function mapChrome(tips, basin, segCount) {
    var old = document.getElementById('geoOverlay');
    if (old && old.parentNode) old.parentNode.removeChild(old);

    var box = document.createElement('div');
    box.id = 'geoOverlay';
    box.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:3;';
    document.body.appendChild(box);

    // 只挂大河的名字，标太多会糊成一片；同一条河只标一次
    var picked = tips.filter(function (t) { return t.name; });
    picked.sort(function (a, b) { return a.rank - b.rank; });
    var seenName = {};
    picked = picked.filter(function (t) {
      if (seenName[t.name]) return false;
      seenName[t.name] = 1;
      return true;
    }).slice(0, 8);

    var els = picked.map(function (t) {
      var el = document.createElement('div');
      el.textContent = t.name;
      el.style.cssText = 'position:absolute;font-size:9px;letter-spacing:.14em;'
        + 'color:rgba(255,232,202,.56);white-space:nowrap;font-weight:300;opacity:0;'
        + 'transition:opacity .35s;'
        + 'text-shadow:0 0 6px rgba(0,0,0,.95),0 0 12px rgba(0,0,0,.8);';
      box.appendChild(el);
      return el;
    });

    function place() {
      var st = window.__tree.state;
      var tf = st.transform;
      if (!tf || !st.ww) return;
      var boxes = [];

      for (var i = 0; i < picked.length; i++) {
        var t = picked[i];
        var x = tf.tx + t.nx * tf.tw;
        var y = tf.ty + t.ny * tf.th;
        // 沿着"离树心更远"的方向摆，别把字压在枝干上
        var dx = t.nx - 0.5;
        var dy = t.ny - 0.42;
        var tw = t.name.length * 7.2 + 6, th = 11;
        var left, top;
        if (Math.abs(dx) >= Math.abs(dy)) {
          left = dx >= 0 ? x + 17 : x - 13 - tw;
          top = y - th / 2;
        } else {
          left = x - tw / 2;
          top = dy >= 0 ? y + 9 : y - 9 - th;
        }

        // 名字挤在一起就不标——地图上宁可少一个地名，也不能叠成一团
        var clash = false;
        for (var b2 = 0; b2 < boxes.length; b2++) {
          var o = boxes[b2];
          if (left < o.l + o.w && left + tw > o.l && top < o.t + o.h && top + th > o.t) { clash = true; break; }
        }
        if (clash) { els[i].style.opacity = '0'; continue; }

        boxes.push({ l: left, t: top, w: tw, h: th });
        els[i].style.opacity = '1';
        els[i].style.left = left + 'px';
        els[i].style.top = top + 'px';
        els[i].style.transform = 'none';
      }
    }

    place();
    setTimeout(place, 800);
    setTimeout(place, 1700);
    window.addEventListener('resize', function () { setTimeout(place, 280); });

    // 图例
    var lg = document.createElement('div');
    lg.style.cssText = 'position:fixed;right:26px;bottom:152px;z-index:3;pointer-events:none;'
      + 'font-size:8.5px;letter-spacing:.12em;color:rgba(255,228,196,.46);'
      + 'line-height:1.95;text-align:right;';
    lg.innerHTML = '<div style="letter-spacing:.3em;color:rgba(255,228,196,.72);margin-bottom:7px">'
      + basin + '</div>'
      + '<div>主干 · 最长水系</div>'
      + '<div>细枝 · 支流汇入</div>'
      + '<div style="margin-top:7px;opacity:.7">' + segCount + ' 段河 · Natural Earth 1:10m</div>';
    document.body.appendChild(lg);
  }

  /* ---------- 7.5 流域切换 ---------- */
  function switcher(basin) {
    var meta = document.querySelector('.meta');
    if (meta) meta.style.display = 'none';

    var list = ['密西西比流域', '长江流域', '湄公河流域', '恒河-雅鲁藏布'];
    var bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;left:26px;top:110px;z-index:6;'
      + 'display:flex;flex-direction:column;gap:10px;align-items:flex-start;';

    list.forEach(function (n) {
      var on = (n === basin);
      var b = document.createElement('button');
      b.textContent = n;
      b.style.cssText = 'background:none;border:none;padding:0;cursor:pointer;'
        + 'font-size:9.5px;letter-spacing:.16em;font-family:inherit;'
        + 'color:' + (on ? 'rgba(255,214,150,.85)' : 'rgba(255,228,196,.26)') + ';'
        + 'transition:color .3s;';
      b.onmouseenter = function () { if (!on) b.style.color = 'rgba(255,228,196,.6)'; };
      b.onmouseleave = function () { if (!on) b.style.color = 'rgba(255,228,196,.26)'; };
      b.onclick = function () { location.search = '?b=' + encodeURIComponent(n); };
      bar.appendChild(b);
    });
    document.body.appendChild(bar);
  }

  /* ---------- 8. 喂进渲染管线 ---------- */
  function boot() {
    // 优先用 data/basins.js 里的 window.BASINS：双击 file:// 打开时
    // fetch 读不了本地 json（浏览器不让），脚本可以。
    var load = window.BASINS
      ? Promise.resolve(window.BASINS)
      : fetch('data/basins.json').then(function (r) { return r.json(); });

    load.then(function (all) {
      // 名字写错（"密西西比" vs "密西西比流域"）不该变成一片空白，
      // 先找精确、再找包含、最后退回第一个流域
      var key = BASIN;
      if (!all[key]) {
        var ks = Object.keys(all);
        for (var ki = 0; ki < ks.length; ki++) {
          if (ks[ki].indexOf(BASIN) >= 0 || BASIN.indexOf(ks[ki]) >= 0) { key = ks[ki]; break; }
        }
        if (!all[key] && ks.length) key = ks[0];
        BASIN = key;
      }
      var data = all[BASIN];
      if (!data) { console.warn('没有这个流域:', BASIN); return; }

      var raw = buildGraph(data);
      if (!raw.nodes.length) return;

      var graph = { nodes: compressGraph(raw.nodes) };
      var comp = largestComponent(graph.nodes);
      if (comp.size < 8) { console.warn('河网没连上，只有', comp.size, '个路口'); return; }

      // 把断开的支流接回主干，然后再重新取连通块（应该就只剩一块了）
      var grafted = graft(graph.nodes, comp.mark);
      if (grafted) {
        comp = largestComponent(graph.nodes);
        debugGraft = grafted;
      }

      var a = bfsFar(graph.nodes, comp.member[0], comp.mark);
      var b = bfsFar(graph.nodes, a.far, comp.mark);
      // 两端里选靠下的那端当根（流域出口）
      var root = graph.nodes[a.far].y >= graph.nodes[b.far].y ? a.far : b.far;

      var tree = makeTree(graph.nodes, root);
      var lay = layout(graph.nodes, tree, root);
      var out = render(graph.nodes, tree, lay);

      window.__geo = {
        basin: BASIN,
        nodes: graph.nodes.length,
        joined: tree.order.length,
        debug: { raw: raw.nodes.length, rawEdges: raw.edges.length, comp: comp.size, total: graph.nodes.length, grafted: debugGraft },
        tips: out.tips,
        canvas: out.canvas,
        lay: lay, tree: tree, graph: graph
      };

      window.__tree.feed(out.canvas.toDataURL('image/png'));
      mapChrome(out.tips, BASIN, tree.order.length);
      switcher(BASIN);

      setTimeout(function () {
        var el = document.getElementById('treeLabel');
        if (el) el.textContent = BASIN + ' · ' + tree.order.length + ' 个河段长成的树';
      }, 800);
    }).catch(function (e) { console.warn(e); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else setTimeout(boot, 60);
})();
