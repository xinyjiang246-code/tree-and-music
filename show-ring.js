/* =========================================================
   年轮 · 生长演出的圆形交互（Three.js）
   ---------------------------------------------------------
   一圈一圈的光点像树的年轮，绕着树根铺开。
   - 树的生长进度走到哪，光环的高亮就走到哪（角度 = 进度）
   - 用鼠标/手指在环上拖动 → 回到生长的任意时刻（showSeek）
   - 只借用 app.js 的公开调试口，不碰它的内部状态；演出关掉就停
   ========================================================= */
import * as THREE from 'three';

(function () {
  'use strict';

  const cv = document.getElementById('ringCv');
  if (!cv) return;

  let renderer, scene, camera, group, dots, dotGeo, head, headGlow, rings = [];
  let raf = 0, ready = false, dragging = false, lastAngle = 0;
  let W = 0, H = 0, cx = 0, cy = 0, R = 0;
  const N = 240;                 // 光点总数
  const SHOW = { seed: 1700, grow: 15000 };   // 与 app.js 的 SHOW_T 同步

  function accent() {
    const v = getComputedStyle(document.body).getPropertyValue('--accent').trim();
    return v || '#c9a24b';
  }

  // 圆点贴图：PointsMaterial 默认是方块，给一张径向渐变的圆斑才像光点
  let dotTex = null;
  function roundTexture() {
    if (dotTex) return dotTex;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.4, 'rgba(255,255,255,0.85)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    dotTex = new THREE.CanvasTexture(c);
    return dotTex;
  }

  function init() {
    try {
      renderer = new THREE.WebGLRenderer({ canvas: cv, alpha: true, antialias: true });
    } catch (e) { return; }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.z = 2;

    group = new THREE.Group();
    scene.add(group);

    // 三圈点：每圈半径不同、相位错开，像年轮又不像同心圆靶
    const pos = new Float32Array(N * 3);
    const sizes = new Float32Array(N);
    dotGeo = new THREE.BufferGeometry();
    dotGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    dotGeo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    const mat = new THREE.PointsMaterial({
      size: 9, sizeAttenuation: false, transparent: true, opacity: 0.72,
      color: new THREE.Color(accent()), depthWrite: false,
      blending: THREE.AdditiveBlending, map: roundTexture(), alphaTest: 0.02
    });
    dots = new THREE.Points(dotGeo, mat);
    group.add(dots);

    // 游走的亮点（当前生长位置）
    const headMat = new THREE.PointsMaterial({
      size: 26, sizeAttenuation: false, transparent: true, opacity: 0.95,
      color: 0xfff2cf, depthWrite: false, blending: THREE.AdditiveBlending,
      map: roundTexture(), alphaTest: 0.02
    });
    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
    head = new THREE.Points(hg, headMat);
    group.add(head);
    const glowMat = headMat.clone();
    glowMat.size = 56; glowMat.opacity = 0.24;
    headGlow = new THREE.Points(hg, glowMat);
    group.add(headGlow);

    ready = true;
    resize();
    window.addEventListener('resize', resize);
    cv.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    loop();
  }

  function resize() {
    if (!ready) return;
    W = window.innerWidth; H = window.innerHeight;
    renderer.setSize(W, H, false);
    camera.left = -W / 2; camera.right = W / 2;
    camera.top = H / 2; camera.bottom = -H / 2;
    camera.updateProjectionMatrix();
    cx = 0; cy = -H * 0.20;                 // 环心下移到树根一带，不盖住树冠
    R = Math.min(W, H) * 0.17;
    group.position.set(cx, cy, 0);
  }

  // 生长进度 0..1 → 环上角度（正上方为 0，顺时针）
  function angleOf(p) { return -Math.PI / 2 + p * Math.PI * 2; }

  function updatePoints(gp, t) {
    const p = dotGeo.attributes.position.array;
    const ringsN = 3;
    for (let i = 0; i < N; i++) {
      const ri = i % ringsN;
      const k = Math.floor(i / ringsN) / Math.ceil(N / ringsN);
      const a = angleOf(k) + ri * 0.05 + Math.sin(t * 0.0004 + ri) * 0.01;
      // 年轮随生长从内往外"长出来"：没到的角度只画内圈，到了才铺外圈
      const reached = k <= gp + 0.02;
      const rr = R * (0.74 + ri * 0.16) * (reached ? 1 : 0.92);
      p[i * 3] = Math.cos(a) * rr;
      p[i * 3 + 1] = -Math.sin(a) * rr * 0.34;   // 压扁成地面上的环（Y 翻转对齐屏幕坐标）
      p[i * 3 + 2] = ri * 0.01;
    }
    dotGeo.attributes.position.needsUpdate = true;
    dots.material.opacity = 0.42 + 0.34 * Math.min(1, gp * 1.4);

    const a = angleOf(gp);
    const hr = R * 0.90;
    const hp = head.geometry.attributes.position.array;
    hp[0] = Math.cos(a) * hr; hp[1] = -Math.sin(a) * hr * 0.34; hp[2] = 0.02;
    head.geometry.attributes.position.needsUpdate = true;
    headGlow.geometry = head.geometry;
  }

  function progress() {
    const T = window.__tree && window.__tree.showDebug && window.__tree.showDebug();
    if (!T || !T.active) return null;
    const el = T.elapsed;
    if (el <= SHOW.seed) return 0;
    return Math.max(0, Math.min(1, (el - SHOW.seed) / SHOW.grow));
  }

  function loop() {
    raf = requestAnimationFrame(loop);
    const on = document.body.classList.contains('showing') && !document.getElementById('showLayer').hidden;
    cv.style.display = on ? 'block' : 'none';
    if (!on) return;
    const p = progress();
    if (p == null) return;
    updatePoints(p, performance.now());
    renderer.render(scene, camera);
  }

  /* —— 拖动：在环上按住并绕圈，回到那个时刻 —— */
  function pointerInfo(e) {
    const rect = cv.getBoundingClientRect();
    const px = e.clientX - rect.left - rect.width / 2;
    const py = e.clientY - rect.top - rect.height / 2 + cy;
    const a = Math.atan2(py / 0.34, px);
    const r = Math.hypot(px, py / 0.34);
    return { a: a, r: r };
  }
  function seekFromAngle(a) {
    let p = (a + Math.PI / 2) / (Math.PI * 2);
    p = ((p % 1) + 1) % 1;
    const el = SHOW.seed + p * SHOW.grow;
    if (window.__tree && window.__tree.showSeek) window.__tree.showSeek(el);
  }
  function onDown(e) {
    const on = document.body.classList.contains('showing');
    if (!on) return;
    const pi = pointerInfo(e);
    if (pi.r < R * 0.45 || pi.r > R * 1.5) return;   // 只响应环附近
    dragging = true; lastAngle = pi.a;
    cv.setPointerCapture && cv.setPointerCapture(e.pointerId);
    seekFromAngle(pi.a);
    e.preventDefault();
  }
  function onMove(e) {
    if (!dragging) return;
    const pi = pointerInfo(e);
    seekFromAngle(pi.a);
    lastAngle = pi.a;
    e.preventDefault();
  }
  function onUp(e) { dragging = false; }

  // 等 DOM / app.js 就绪
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
