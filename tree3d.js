/* =========================================================
   单树 3D 原型（Three.js）
   - 几何不另起一套：直接读 forms.js 的骨架（同一 seed 得到同一棵树）
   - 树干/枝条：按骨架采样成有锥度的管，节点用球做过渡，基部做根盘
   - 叶：逐叶实例化（各自朝向、法线），沿枝条分布，带冠内 AO
   - 光：一盏主平行光（左上）+ 半球光；地面接收接触阴影
   - 不变的部分：forms.js / index / grove / world3d 一律不动
   ========================================================= */
import * as THREE from 'three';

(function () {
  'use strict';

  var W = 560, H = 680, BASE = H - 17, SEED = 1758;
  var qs = new URLSearchParams(location.search);

  var TIERS = {
    high: { leaves: 16000, shadow: 2048, dpr: 2 },
    mid: { leaves: 9000, shadow: 1024, dpr: 1.6 },
    low: { leaves: 4500, shadow: 512, dpr: 1 }
  };
  var isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && (navigator.hardwareConcurrency || 8) <= 6);
  var tierName = TIERS[qs.get('q')] ? qs.get('q') : (isMobile ? 'mid' : 'high');
  var TIER = TIERS[tierName];

  if (qs.get('only') === '3d') document.body.classList.add('only3d');

  var t0 = performance.now();

  /* —— 与 tree-sample.js 完全一致的形状修正：只压光杆、冠横向放宽 —— */
  function shapeOf(d) {
    var c = d.crown || { cx: W / 2, cy: H * 0.36, rx: W * 0.42, ry: H * 0.32 };
    var minY = H;
    d.segs.forEach(function (s) { minY = Math.min(minY, s.y1, s.y2); });
    (d.leaves || []).forEach(function (p) { minY = Math.min(minY, p.y); });
    var span = Math.max(1, BASE - minY);
    var yb = Math.min(BASE - span * 0.22, c.cy + c.ry * 0.96);
    var k = 0.58;
    var yb2 = BASE - (BASE - yb) * k;
    function wy(y) {
      if (y >= yb) return BASE - (BASE - y) * k;
      return yb2 - (yb - y);
    }
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
    return {
      segs: segs, leaves: leaves,
      crown: { cx: wx(c.cx, c.cy), cy: wy(c.cy), rx: c.rx * 1.10, ry: c.ry }
    };
  }

  var D = shapeOf(window.TreeForms.generate('oak', SEED, W, H));

  /* —— 2D 平面 → 3D：X 右、Y 上、Z 朝镜头。Z 只跟 (x,y) 有关，枝干接点不会错开 —— */
  function zOf(x, y) {
    var dx = (x - W / 2) / (W / 2);
    return dx * 34 + Math.sin((y / H) * 3.1 + dx) * 6;
  }
  function v3(x, y, z) { return new THREE.Vector3(x - W / 2, BASE - y, z); }

  /* —— 场景 —— */
  var canvas = document.getElementById('c3d');
  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, TIER.dpr));
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.34;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;   // 静态静物：阴影只烘一次

  var scene = new THREE.Scene();
  var PAPER = new THREE.Color(0xF1EBE0);
  scene.background = PAPER;
  scene.fog = new THREE.Fog(PAPER.getHex(), 1150, 2350);

  var camera = new THREE.PerspectiveCamera(33, W / H, 10, 4000);
  camera.position.set(58, 352, 1178);
  camera.lookAt(0, 300, 0);

  var key = new THREE.DirectionalLight(0xFFF7E6, 1.62);
  key.position.set(-430, 1480, 210);
  key.target.position.set(0, 230, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(TIER.shadow, TIER.shadow);
  // 阴影范围按冠幅贴合、并在画布外留足余量：画面里不会出现阴影贴图的直边
  (function () {
    var half = Math.max(D.crown.rx, D.crown.ry) * 1.9 + 40;
    key.shadow.camera.left = -half;
    key.shadow.camera.right = half;
    key.shadow.camera.top = half * 1.05;
    key.shadow.camera.bottom = -half * 1.15;
  })();
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 3200;
  key.shadow.bias = -0.0009;
  key.shadow.normalBias = 0.8;
  key.shadow.radius = 4.2;
  scene.add(key); scene.add(key.target);

  var hemi = new THREE.HemisphereLight(0xEDEADD, 0xB3B8AF, 1.12);
  scene.add(hemi);

  var fill = new THREE.DirectionalLight(0xC9D2D2, 0.30);
  fill.position.set(520, 300, -320);
  scene.add(fill);

  var treeGroup = new THREE.Group();
  scene.add(treeGroup);

  /* —— 枝干：管状 + 锥度 + 根盘，节点球过渡 —— */
  /* —— 树皮：竖向纤维；每根纤维在 v 方向是周期曲线，平铺时不会出现横断 —— */
  function barkTexture() {
    var c = document.createElement('canvas');
    c.width = 96; c.height = 256;
    var g = c.getContext('2d');
    g.fillStyle = '#756E57';
    g.fillRect(0, 0, 96, 256);
    var s = 0x1f3a5b;
    function rr() { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }
    for (var i = 0; i < 120; i++) {
      var x0 = rr() * 96, amp = 1.6 + rr() * 4.4, ph = rr() * 6.283;
      var w = 0.6 + rr() * 2.3;
      var dark = rr() < 0.55;
      var p = new Path2D();
      for (var k = 0; k <= 32; k++) {
        var t = k / 32;
        var x = x0 + amp * Math.sin(ph + t * 6.283185);
        if (k) p.lineTo(x, t * 256); else p.moveTo(x, 0);
      }
      g.strokeStyle = dark
        ? 'rgba(50,46,34,' + (0.06 + rr() * 0.12).toFixed(3) + ')'
        : 'rgba(172,166,132,' + (0.05 + rr() * 0.09).toFixed(3) + ')';
      g.lineWidth = w;
      // 横向也平铺：左右各补一份，圆周接缝处不出现一条竖线
      [-96, 0, 96].forEach(function (dx) {
        g.save(); g.translate(dx, 0); g.stroke(p); g.restore();
      });
    }
    var t2 = new THREE.CanvasTexture(c);
    t2.wrapS = t2.wrapT = THREE.RepeatWrapping;
    t2.colorSpace = THREE.SRGBColorSpace;
    t2.anisotropy = 4;
    return t2;
  }

  var barkMat = new THREE.MeshStandardMaterial({
    color: 0xFFFFFF, map: barkTexture(), roughness: 0.95, metalness: 0, side: THREE.DoubleSide
  });
  // 节点球用不带贴图的同色材质：球面 UV 会把纤维贴图拧成菱形编织感
  var barkFlatMat = new THREE.MeshStandardMaterial({
    color: 0x6B6550, roughness: 0.95, metalness: 0, flatShading: false
  });

  function buildBranches(d) {
    var pos = [], nor = [], uv = [], idx = [];
    var SEG = 6, RING = 10;
    var vcount = 0;
    var nodeMap = {};

    function addNode(x, y, r) {
      var k = Math.round(x * 2) + '_' + Math.round(y * 2);
      var n = nodeMap[k];
      if (!n) nodeMap[k] = { x: x, y: y, r: r, c: 1 };
      else { n.c++; if (r > n.r) n.r = r; }
    }

    // 与 2D 一致：depth 0 里只画主干主线，短根段不画（否则脚下会炸出一圈爪状细管）
    var wmax = 0;
    d.segs.forEach(function (s) { if (s.depth === 0) wmax = Math.max(wmax, s.w); });
    var lowY = 0;
    d.segs.forEach(function (s) {
      if (s.depth === 0 && s.w >= wmax * 0.55) lowY = Math.max(lowY, s.y1, s.y2);
    });

    d.segs.forEach(function (s) {
      if (s.depth === 0 && s.w < wmax * 0.55) return;
      var w0 = Math.max(0.55, s.w * 0.5);
      // 段内保持等径：整根干的锥度由 31 段自身的宽度递减给出，
      // 若每段再收锥，段尾会比下一段细，接缝就叠成一圈圈台阶。
      var w1 = w0;
      var pts = [];
      // 两端按管径多伸出一点（世界单位），把相邻两段错开的环缝盖进对方管身里
      var segLen = Math.max(1, Math.hypot(s.x2 - s.x1, s.y2 - s.y1));
      var ext = Math.min(0.45, 1.7 * w0 / segLen);
      for (var i = 0; i <= SEG; i++) {
        var t = -ext + (i / SEG) * (1 + 2 * ext);
        var u = 1 - t;
        var x = u * u * s.x1 + 2 * u * t * s.cx + t * t * s.x2;
        var y = u * u * s.y1 + 2 * u * t * s.cy + t * t * s.y2;
        // 插到地面以下的部分直接压平：管口埋进地里，不需要额外的柱脚
        if (y > BASE + 6) y = BASE + 6;
        if (s.depth === 0 && y > lowY - 2 && y < BASE + 6) y = BASE + 6;
        var r = w0 + (w1 - w0) * t;
        var rBase = r;
        // 根盘：钝一点、贴地一点，只在最底下 10px 微微外扩
        if (s.depth === 0) {
          var hgt = BASE - y;
          if (hgt < 10) r *= 1 + 0.08 * (1 - hgt / 10);
        }
        var z = zOf(x, y);
        pts.push({ x: x, y: y, z: z, r: r });
        if (i === 0 || i === SEG) addNode(x, y, rBase);
      }

      var start = vcount, vRun = 0;
      // 每段固定一个参考轴：参考轴若随采样点在 X/Y 之间跳，UV 会扭转成菱形编织
      var dirX = s.x2 - s.x1, dirY = s.y2 - s.y1;
      var refX = Math.abs(dirX) > Math.abs(dirY) * 1.2 ? 0 : 1;
      var refY = 0;
      var refZ = refX === 0 ? 1 : 0;
      for (var j = 0; j <= SEG; j++) {
        var p = pts[j];
        // v 只跟离地高度走：接点处不会因为重新起算而出现一圈圈横向条纹
        vRun = (BASE - p.y) / 86;
        var pPrev = pts[Math.max(0, j - 1)], pNext = pts[Math.min(SEG, j + 1)];
        var tx = pNext.x - pPrev.x, ty = pNext.y - pPrev.y, tz = pNext.z - pPrev.z;
        var tl = Math.hypot(tx, ty, tz) || 1;
        tx /= tl; ty /= tl; tz /= tl;
        // u = ref × t（ref 固定，环的方向只随切向平滑变化）
        var ux = refY * tz - refZ * ty;
        var uy = refZ * tx - refX * tz;
        var uz = refX * ty - refY * tx;
        var ul = Math.hypot(ux, uy, uz) || 1;
        ux /= ul; uy /= ul; uz /= ul;
        var vx = ty * uz - tz * uy, vy = tz * ux - tx * uz, vz = tx * uy - ty * ux;

        for (var m = 0; m < RING; m++) {
          var a = (m / RING) * Math.PI * 2;
          var ca = Math.cos(a), sa = Math.sin(a);
          var nx = ux * ca + vx * sa, ny = uy * ca + vy * sa, nz = uz * ca + vz * sa;
          pos.push(p.x - W / 2 + nx * p.r, BASE - p.y + ny * p.r, p.z + nz * p.r);
          nor.push(nx, ny, nz);
          uv.push(m / RING, vRun);
          vcount++;
        }
        if (j > 0) {
          var b0 = start + (j - 1) * RING, b1 = start + j * RING;
          for (var m2 = 0; m2 < RING; m2++) {
            var a0 = b0 + m2, a1 = b0 + ((m2 + 1) % RING);
            var b2 = b1 + m2, b3 = b1 + ((m2 + 1) % RING);
            idx.push(a0, b2, a1, a1, b2, b3);
          }
        }
      }
    });

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeBoundingSphere();

    var mesh = new THREE.Mesh(geo, barkMat);
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    treeGroup.add(mesh);

    // 柱脚：骨架最低点在离地约 10px 处，主干已插到地面以下，不再额外补圆柱

    // 节点球：每个接点都补一颗同半径的球。
    // 相邻两段各自算切向，接缝处环的方向会差一点，不补球就会漏出细缝。
    // 只有细枝的接点补球；主干靠多出来的那 4% 重叠就够，加球反而会鼓成一节一节
    var nodes = Object.keys(nodeMap).map(function (k) { return nodeMap[k]; })
      .filter(function (n) { return n.r > 1.15 && n.r < 9 && (BASE - n.y) > 22; });
    var sph = new THREE.SphereGeometry(1, 10, 8);
    var joints = new THREE.InstancedMesh(sph, barkFlatMat, nodes.length);
    var dummy = new THREE.Object3D();
    nodes.forEach(function (n, i) {
      dummy.position.set(n.x - W / 2, BASE - n.y, zOf(n.x, n.y));
      var r = n.r;
      dummy.scale.set(r, r, r);
      dummy.updateMatrix();
      joints.setMatrixAt(i, dummy.matrix);
    });
    joints.instanceMatrix.needsUpdate = true;
    joints.castShadow = true;
    treeGroup.add(joints);

    return { verts: vcount, nodes: nodes.length };
  }

  /* —— 叶：一片小弯叶，逐叶实例 —— */
  function leafGeometry() {
    var g = new THREE.PlaneGeometry(4.6, 10.5, 1, 3);
    var p = g.attributes.position;
    for (var i = 0; i < p.count; i++) {
      var x = p.getX(i), y = p.getY(i);
      var t = y / 5.25;
      p.setX(i, x * (0.42 + 0.58 * Math.sqrt(Math.max(0, 1 - t * t))));
      p.setZ(i, 1.35 * t * t - 0.35 * Math.abs(x) / 2);
    }
    g.computeVertexNormals();
    return g;
  }

  var leafMat = new THREE.MeshStandardMaterial({
    color: 0xFFFFFF, roughness: 0.96, metalness: 0, side: THREE.DoubleSide
  });

  function buildLeaves(d, count) {
    var geo = leafGeometry();
    var inst = new THREE.InstancedMesh(geo, leafMat, count);
    inst.castShadow = true;
    inst.receiveShadow = true;   // 冠内自遮挡：前叶把影子打在后面的叶上

    var dummy = new THREE.Object3D();
    var col = new THREE.Color();
    var tones = [0x9AA079, 0x8B9270, 0xA6AC86, 0x7E8663];
    var cool = new THREE.Color(0x7A7F76);
    var paperish = new THREE.Color(0x9C9A84);
    var anchors = d.leaves;
    var crown = d.crown;
    var c3 = new THREE.Vector3(crown.cx - W / 2, BASE - crown.cy, 0);
    var s = 0x9e3779b9;

    function rnd() { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }

    for (var i = 0; i < count; i++) {
      // 按比例取样：同一批锚点，只是疏密不同
      var a = anchors[Math.floor(i * anchors.length / count) % anchors.length];
      var ra = Math.hypot((a.x - crown.cx) / crown.rx, (a.y - crown.cy) / crown.ry);
      // 冠缘的锚点收紧抖动；冠外的枝梢多半让掉，剩下的往冠里收——顶端不要孤立的小团
      var jit = ra > 0.90 ? 7 : 13;
      var x = a.x + (rnd() - 0.5) * jit;
      var y = a.y + (rnd() - 0.5) * jit;
      if (ra > 0.97 && rnd() < 0.55) {
        dummy.scale.set(0, 0, 0);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
        inst.setColorAt(i, col.setHex(0x8B9270));
        continue;
      }
      if (ra > 0.90) {
        var pull = 0.14 + rnd() * 0.20;
        x += (crown.cx - x) * pull;
        y += (crown.cy - y) * pull;
      }
      // 三分之一的叶往冠心收一点：把放射状枝之间的缝补上，树冠才是整块
      if (i % 3 === 0) {
        var k2 = 0.22 + rnd() * 0.34;
        x = x + (crown.cx - x) * k2 + (rnd() - 0.5) * 10;
        y = y + (crown.cy - y) * k2 + (rnd() - 0.5) * 10;
      }
      var rr = Math.hypot((x - crown.cx) / crown.rx, (y - crown.cy) / crown.ry);
      rr = Math.min(1.15, rr);
      var ny = (y - crown.cy) / crown.ry;

      // 冠底不要一圈齐边：下缘随机让掉一点
      if (rr > 0.62 && ny > 0.72 && rnd() < 0.22) {
        dummy.scale.set(0, 0, 0);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
        inst.setColorAt(i, col.setHex(0x7A8260));
        continue;
      }

      var zAmp = 16 + 46 * (1 - Math.min(1, rr));
      var z = zOf(x, y) + (rnd() - 0.5) * 2 * zAmp;
      var px = x - W / 2, py = BASE - y;

      dummy.position.set(px, py, z);
      // 叶面朝向 = 往外（有体积）× 朝光/镜头（看得见面积），再随机歪一点
      var dx = px - c3.x, dy = py - c3.y, dz = z - c3.z;
      var dl = Math.hypot(dx, dy, dz) || 1;
      var nx2 = dx / dl * 0.55 - 0.34;
      var ny2 = dy / dl * 0.55 + 0.42;
      var nz2 = dz / dl * 0.55 + 0.78;
      dummy.lookAt(px + nx2 * 10, py + ny2 * 10, z + nz2 * 10);
      dummy.rotateZ((rnd() - 0.5) * 2.2);
      dummy.rotateX((rnd() - 0.5) * 0.8);
      var sc = 0.82 + rnd() * 0.48;
      dummy.scale.set(sc, sc * (0.92 + rnd() * 0.22), sc);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);

      // 冠内 AO：越靠里越暗；再叠一层整冠的形体阴影（左上亮、右下暗）
      var nx = (x - crown.cx) / crown.rx;
      var ao = 0.55 + 0.45 * (0.18 + 0.82 * Math.min(1, rr));
      var shade = 1.02 - 0.24 * (ny * 0.5 + 0.5) - 0.08 * Math.max(0, nx);
      col.setHex(tones[(i * 7) % 4]).multiplyScalar(ao * shade);
      col.lerp(paperish, 0.16);                 // 往纸墨色板拉：低饱和、略偏黄灰
      col.lerp(cool, (1 - Math.min(1, rr)) * 0.30);
      inst.setColorAt(i, col);
    }
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    treeGroup.add(inst);
    return inst;
  }

  /* —— 地面：纸色 + 从树根往外的 alpha 渐隐 —— */
  /* 影子和地面都在 alpha 里淡掉，画面里不会露出贴图边界或平面边缘 */
  function groundFadeTexture() {
    var c = document.createElement('canvas');
    c.width = c.height = 512;
    var g = c.getContext('2d');
    var grd = g.createRadialGradient(256, 256, 0, 256, 256, 256);
    grd.addColorStop(0, '#ffffff');
    grd.addColorStop(0.50, '#ffffff');
    grd.addColorStop(0.80, '#9d9d9d');
    grd.addColorStop(1, '#000000');
    g.fillStyle = grd;
    g.fillRect(0, 0, 512, 512);
    return new THREE.CanvasTexture(c);
  }

  var groundMat = new THREE.MeshStandardMaterial({
    color: 0xEFE9DC, roughness: 1, metalness: 0,
    transparent: true, alphaMap: groundFadeTexture(), depthWrite: false
  });
  var ground = new THREE.Mesh(new THREE.PlaneGeometry(4200, 4200), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0.6;
  ground.receiveShadow = true;
  scene.add(ground);

  // 树根下再压一点接触暗（很轻，主阴影仍交给 shadow map）
  var contact = new THREE.Mesh(
    new THREE.CircleGeometry(80, 40),
    new THREE.MeshBasicMaterial({ color: 0x37402C, transparent: true, opacity: 0.16, depthWrite: false })
  );
  contact.rotation.x = -Math.PI / 2;
  contact.position.set(0, 1.2, 4);
  contact.scale.set(1.5, 0.26, 1);
  scene.add(contact);

  /* —— 构建 —— */
  var info = buildBranches(D);
  var leaves = buildLeaves(D, TIER.leaves);
  renderer.shadowMap.needsUpdate = true;
  var buildMs = performance.now() - t0;

  var tris = 0;
  scene.traverse(function (o) {
    if (o.isMesh && o.geometry && o.geometry.index) tris += o.geometry.index.count / 3 * (o.count || 1);
  });

  /* —— 首帧 + 统计 —— */
  renderer.render(scene, camera);
  var firstMs = performance.now() - t0;
  canvas.classList.add('on');
  var ph = document.getElementById('ph');
  if (ph) ph.style.display = 'none';

  var gl = renderer.getContext();
  var dbg = gl.getExtension('WEBGL_debug_renderer_info');
  var gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown';

  var frames = 0, fps = 0, frameMs = 0, last = performance.now(), dts = [];
  var sway = true;

  function loop(now) {
    var dt = now - last; last = now;
    if (sway) {
      var s2 = Math.sin(now * 0.00042) * 0.0016;
      treeGroup.rotation.z = s2 * 0.6;
      treeGroup.rotation.x = Math.sin(now * 0.00031) * 0.0009;
    }
    renderer.render(scene, camera);
    if (frames > 2 && dt < 2000) {
      dts.push(dt);
      if (dts.length > 120) dts.shift();
      var sum = 0;
      for (var i = 0; i < dts.length; i++) sum += dts[i];
      frameMs = sum / dts.length;
      fps = 1000 / frameMs;
    }
    frames++;
    if (frames % 20 === 0) paintStats();
    requestAnimationFrame(loop);
  }

  function paintStats() {
    var el = document.getElementById('stats');
    if (!el) return;
    el.innerHTML =
      '叶 <b>' + TIER.leaves.toLocaleString() + '</b> 片 · ' +
      '三角形 <b>' + Math.round(tris / 1000) + 'k</b> · ' +
      '阴影 <b>' + TIER.shadow + '²</b> · DPR <b>' + renderer.getPixelRatio() + '</b> · ' +
      '构建 <b>' + buildMs.toFixed(0) + 'ms</b> · 首帧 <b>' + firstMs.toFixed(0) + 'ms</b> · ' +
      '帧率 <b>' + (fps ? fps.toFixed(0) : '—') + '</b> · 档位 <b>' + tierName + '</b> · ' + gpu;
  }
  paintStats();
  requestAnimationFrame(loop);

  window.__tree3d = {
    seed: SEED, tier: tierName, leaves: TIER.leaves, shadow: TIER.shadow,
    dpr: renderer.getPixelRatio(), firstMs: firstMs, buildMs: buildMs, info: info, gpu: gpu,
    renderer: renderer, scene: scene, camera: camera,
    fps: function () { return fps; },
    frameMs: function () { return frameMs; },
    setSway: function (v) { sway = !!v; },
    // 天气接口（先接风；雨/雾按同一条路加层）
    setWeather: function (w) {
      if (w === 'fog') { scene.fog = new THREE.Fog(PAPER.getHex(), 700, 1600); sway = false; }
      else if (w === 'rain') { scene.fog = new THREE.Fog(PAPER.getHex(), 1000, 2100); sway = true; }
      else { scene.fog = new THREE.Fog(PAPER.getHex(), 1150, 2350); sway = true; }
      return w;
    }
  };
})();
