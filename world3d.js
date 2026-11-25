/* =========================================================
   世界树 · Three.js 3D 地球（纸与墨 / 冷银蓝 / 暖象牙）
   ---------------------------------------------------------
   - 大陆：陆地掩膜 + fwidth 等值线（不用卫星照片，颜色自己定）
   - 大气：贴边薄线 + 屏幕径向高斯，两层，无硬边
   - 光照：太阳跟着鼠标走（指到球面哪一点，哪里就亮）；暗面保一点冷光
   - 树：按 0.75° 聚合的树丛点，五档密度色阶；点开 → 小树从落点长出来
   ========================================================= */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);

  /* =========================================================
     0. 配色
     ========================================================= */
  const PALETTES = {
    /* 默认：纸与墨 */
    paper: {
      bg: '#E7DFD0',
      sea: '#BFB29A', seaDeep: '#96866C', land: '#F6EFE1', landHi: '#FFFCF2',
      coast: '#243238', coastStrength: 0.18,
      night: '#5B5142', floor: 0.10, termLo: 0.0, termHi: 0.24,
      atmo: '#FFF3DC', atmoAlpha: 0.28, relief: 1.0, spec: 0.05,
      rim: '#243238', rimAlpha: 0.08, rimAdd: false,
      halo: '#C9B79E', haloAlpha: 0.10, haloAdd: false,
      stars: 0,
      ramp: ['#7C8A80', '#4F6F63', '#3F7A68', '#8C4A2B', '#241F1C'],
      pointAdd: false, pointAlpha: 0.92,
      shadow: '#243238', shadowAlpha: 0.10
    },
    /* 深色模式：冷银蓝 · 夜海 */
    night: {
      bg: '#05080C',
      sea: '#0B1922', seaDeep: '#04090D', land: '#2A444E', landHi: '#456B79',
      coast: '#6F8FA3', coastStrength: 0.16,
      night: '#02060A', floor: 0.10, termLo: 0.0, termHi: 0.24,
      atmo: '#8FD0FF', atmoAlpha: 0.55, relief: 1.1, spec: 0.10,
      rim: '#CFE8FF', rimAlpha: 0.12, rimAdd: true,
      halo: '#7FC8FF', haloAlpha: 0.12, haloAdd: true,
      stars: 1200,
      ramp: ['#2F6F63', '#4E9E8A', '#8FD3C4', '#D6F2EA', '#FFFFFF'],
      pointAdd: true, pointAlpha: 0.95,
      shadow: '#000000', shadowAlpha: 0.30
    },
    /* 纪念 / 导出：暖象牙 · 琥珀种子光 */
    warm: {
      bg: '#0E0B08',
      sea: '#1B1610', seaDeep: '#0F0B07', land: '#3E3223', landHi: '#614C33',
      coast: '#8A6A3E', coastStrength: 0.28,
      night: '#040302', floor: 0.10, termLo: 0.0, termHi: 0.24,
      atmo: '#FFD9A6', atmoAlpha: 0.50, relief: 1.0, spec: 0.08,
      rim: '#E6C18C', rimAlpha: 0.12, rimAdd: true,
      halo: '#E3B77A', haloAlpha: 0.10, haloAdd: true,
      stars: 600,
      ramp: ['#8A6A3A', '#B8863F', '#D9A05B', '#F2C879', '#FFF0C9'],
      pointAdd: true, pointAlpha: 0.95,
      shadow: '#000000', shadowAlpha: 0.35
    }
  };

  const qs = new URLSearchParams(location.search);
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const paletteKey = PALETTES[qs.get('palette')] ? qs.get('palette') : (prefersDark ? 'night' : 'paper');
  const P = PALETTES[paletteKey];
  document.documentElement.dataset.palette = paletteKey;
  document.body.dataset.palette = paletteKey;

  // 这套着色器直接输出 sRGB 数值，关掉色彩管理以免被二次转换
  THREE.ColorManagement.enabled = false;
  const col = (hex) => new THREE.Color(hex);

  /* =========================================================
     1. 渲染器 / 场景 / 相机
     ========================================================= */
  const stage = $('stage');
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  stage.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = col(P.bg);

  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 0.4, 3.4);

  const RADIUS = 1;

  /* =========================================================
     2. 地体：掩膜 + 等值线 + 柔化晨昏线
     ========================================================= */
  const earthMat = new THREE.ShaderMaterial({
    uniforms: {
      uMask: { value: null },
      uSea: { value: col(P.sea) },
      uSeaDeep: { value: col(P.seaDeep) },
      uLand: { value: col(P.land) },
      uLandHi: { value: col(P.landHi) },
      uCoast: { value: col(P.coast) },
      uNight: { value: col(P.night) },
      uAtmo: { value: col(P.atmo) },
      uAtmoAlpha: { value: P.atmoAlpha },
      uSunDir: { value: new THREE.Vector3(0.5, 0.3, 0.8).normalize() },
      uTermLo: { value: P.termLo },
      uTermHi: { value: P.termHi },
      uFloor: { value: P.floor },
      uRelief: { value: P.relief },
      uSpec: { value: P.spec },
      uCoastStrength: { value: P.coastStrength }
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vView;
      void main(){
        vUv = uv;
        vN = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vView = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform sampler2D uMask;
      uniform vec3 uSea, uSeaDeep, uLand, uLandHi, uCoast, uNight, uAtmo, uSunDir;
      uniform float uTermLo, uTermHi, uFloor, uCoastStrength, uRelief, uSpec, uAtmoAlpha;
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vView;

      void main(){
        float m = texture2D(uMask, vUv).r;
        vec3 N = normalize(vN);
        vec3 V = normalize(vView);
        vec3 L = normalize(uSunDir);

        float landMask = smoothstep(0.35, 0.65, m);

        // 陆地极浅的浮雕：只用掩膜梯度推一下法线，不靠贴图
        float e = max(fwidth(m) * 1.6, 0.0016);
        float gx = texture2D(uMask, vUv + vec2(e, 0.0)).r - texture2D(uMask, vUv - vec2(e, 0.0)).r;
        float gy = texture2D(uMask, vUv + vec2(0.0, e)).r - texture2D(uMask, vUv - vec2(0.0, e)).r;
        vec3 up = vec3(0.0, 1.0, 0.0);
        vec3 T = normalize(cross(up, N));
        vec3 B = cross(N, T);
        float slope = (gx * dot(T, L) - gy * dot(B, L)) * uRelief;
        // 压缩梯度：海岸的陡落差不能烧成一条白边，只留一点点起伏
        float sl = slope / (1.0 + abs(slope) * 3.0);

        // 海：近岸浅、远海深。用掩膜的模糊值估"离陆地多远"，不靠描边
        float sh = 0.0;
        sh += texture2D(uMask, vUv + vec2( 0.012,  0.000)).r;
        sh += texture2D(uMask, vUv + vec2(-0.012,  0.000)).r;
        sh += texture2D(uMask, vUv + vec2( 0.000,  0.012)).r;
        sh += texture2D(uMask, vUv + vec2( 0.000, -0.012)).r;
        sh += texture2D(uMask, vUv + vec2( 0.009,  0.009)).r;
        sh += texture2D(uMask, vUv + vec2(-0.009,  0.009)).r;
        sh += texture2D(uMask, vUv + vec2( 0.009, -0.009)).r;
        sh += texture2D(uMask, vUv + vec2(-0.009, -0.009)).r;
        sh *= 0.125;
        float shelf = smoothstep(0.04, 0.42, sh);   // 靠岸 → 1，深海 → 0
        vec3 sea = mix(uSeaDeep, uSea, mix(0.35, 1.0, shelf));
        vec3 base = mix(sea, uLand, landMask);
        // 受光的坡面亮一点、背光的坡面暗一点（很轻）
        base = mix(base, uLandHi, clamp(sl, 0.0, 1.0) * landMask * 0.20);
        base *= 1.0 - clamp(-sl, 0.0, 1.0) * landMask * 0.16;

        // 明暗交界：光从哪边来就在哪边亮，背光侧落到夜色
        float ndl = dot(N, L) + sl * 0.30;
        float day = smoothstep(uTermLo, uTermHi, ndl);

        // 亮面上的漫反射衰减：球心最亮、越靠暗面越压低（不是靠一圈描边）
        float diff = mix(0.22, 1.0, smoothstep(-0.02, 0.95, ndl));

        // 球体感：轮廓向里收暗
        float ndv = clamp(dot(N, V), 0.0, 1.0);
        float limb = pow(ndv, 0.55);

        vec3 litCol = base * diff;
        vec3 outc = mix(uNight, litCol, mix(uFloor, 1.0, day));
        outc *= mix(0.45, 1.0, limb);

        // 海面高光：只在亮面、只有一点
        vec3 Hv = normalize(L + V);
        float spec = pow(max(dot(N, Hv), 0.0), 46.0) * (1.0 - landMask) * uSpec * day;
        outc += vec3(spec);

        // 海岸线只留极细一层，明暗靠价值差本身
        float w = max(fwidth(m) * 1.1, 0.0008);
        float coast = 1.0 - smoothstep(0.0, 1.0, abs(m - 0.5) / w);
        outc = mix(outc, uCoast, coast * uCoastStrength * (0.20 + 0.80 * day));

        // 大气：极边缘一小圈，柔和；亮面更明显
        float fres = pow(1.0 - ndv, 4.0);
        outc += uAtmo * fres * uAtmoAlpha * (0.28 + 0.72 * day);

        gl_FragColor = vec4(outc, 1.0);
      }
    `
  });

  const earth = new THREE.Mesh(new THREE.SphereGeometry(RADIUS, 128, 64), earthMat);
  scene.add(earth);

  // 掩膜（本地，构建期产物；失败则只画海）
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const texLoader = new THREE.TextureLoader();
  const maskPath = (window.innerWidth < 720) ? 'data/land-mask-2k.png' : 'data/land-mask-4k.png';
  texLoader.load(maskPath, (t) => {
    t.wrapS = THREE.RepeatWrapping;
    t.anisotropy = Math.min(8, maxAniso);
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.colorSpace = THREE.NoColorSpace;
    earthMat.uniforms.uMask.value = t;
  }, undefined, () => {
    // 离线兜底：全海 + 无海岸线（不崩）
    earthMat.uniforms.uMask.value = new THREE.DataTexture(
      new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat
    );
    earthMat.uniforms.uMask.value.needsUpdate = true;
  });

  /* =========================================================
     3. 大气：贴边薄线 + 屏幕径向高斯
     ========================================================= */
  const rimMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: col(P.rim) }, uAlpha: { value: P.rimAlpha } },
    vertexShader: `
      varying vec3 vN;
      varying vec3 vViewPos;
      void main(){
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewPos = mv.xyz;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uAlpha;
      varying vec3 vN;
      varying vec3 vViewPos;
      void main(){
        float ndv = clamp(dot(normalize(vN), normalize(-vViewPos)), 0.0, 1.0);
        float rim = pow(1.0 - ndv, 6.0);
        gl_FragColor = vec4(uColor, rim * uAlpha);
      }
    `,
    transparent: true,
    blending: P.rimAdd ? THREE.AdditiveBlending : THREE.NormalBlending,
    side: THREE.FrontSide,
    depthWrite: false
  });
  const rimMesh = new THREE.Mesh(new THREE.SphereGeometry(RADIUS * 1.0035, 96, 64), rimMat);
  rimMesh.renderOrder = 2;
  scene.add(rimMesh);

  const SHELL = 1.30;
  const haloMat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: col(P.halo) },
      uAlpha: { value: P.haloAlpha },
      uShell: { value: SHELL },
      uDist: { value: 3.0 }
    },
    vertexShader: `
      varying vec3 vViewPos;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewPos = mv.xyz;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uAlpha;
      uniform float uShell;
      uniform float uDist;
      varying vec3 vViewPos;
      void main(){
        float d = length(vViewPos.xy) / uShell;   // 0 中心 → 1 外壳边
        // 透视下球的轮廓在视空间里的半径是 R·D/√(D²−R²)，不是 R
        float s = (1.0 / uShell) * (uDist / sqrt(max(0.001, uDist * uDist - 1.0)));
        float halo = exp(-pow((d - s) / 0.095, 2.0));
        halo *= 1.0 - smoothstep(0.80, 0.95, d);  // 在壳的边之前归零，避免出现同心圆
        gl_FragColor = vec4(uColor, halo * uAlpha);
      }
    `,
    transparent: true,
    blending: P.haloAdd ? THREE.AdditiveBlending : THREE.NormalBlending,
    side: THREE.BackSide,
    depthWrite: false
  });
  const haloMesh = new THREE.Mesh(new THREE.SphereGeometry(RADIUS * SHELL, 64, 48), haloMat);
  haloMesh.renderOrder = 1;
  scene.add(haloMesh);

  /* =========================================================
     4. 星空
     ========================================================= */
  let stars = null;
  function makeStars(n) {
    if (stars) { scene.remove(stars); stars.geometry.dispose(); stars.material.dispose(); stars = null; }
    if (!n) return;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = 40 + Math.random() * 50;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th);
      pos[i * 3 + 2] = r * Math.cos(ph);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: paletteKey === 'warm' ? 0xF3E3C8 : 0xFFFFFF,
      size: 0.09, sizeAttenuation: true, transparent: true,
      opacity: paletteKey === 'night' ? 0.6 : 0.5, depthWrite: false
    });
    stars = new THREE.Points(geo, mat);
    scene.add(stars);
  }
  makeStars(P.stars);

  /* =========================================================
     5. 相机适配
     ========================================================= */
  function fitDistance() {
    const vfov = camera.fov * Math.PI / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
    return RADIUS / Math.sin(Math.min(vfov, hfov) / 2) * 1.15;
  }

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.45;
  controls.zoomSpeed = 0.8;
  controls.enablePan = false;
  controls.autoRotate = false;   // 光在世界空间固定，自转会把你转到夜里
  controls.minDistance = 1.25;

  const initialFit = fitDistance();
  camera.position.setLength(initialFit);
  controls.maxDistance = Math.max(9, initialFit * 1.6);
  $('count').textContent = '0 棵';

  /* =========================================================
     6. 位置：树在哪 / 你在哪
     ========================================================= */
  function llToVec3(lat, lon, r) {
    const la = lat * Math.PI / 180;
    const lo = -lon * Math.PI / 180;
    return new THREE.Vector3(
      r * Math.cos(la) * Math.cos(lo),
      r * Math.sin(la),
      r * Math.cos(la) * Math.sin(lo)
    );
  }

  // 时区兜底（零网络）：UTC 偏移 → 经度；南半球时区给 -25°
  function tzViewer() {
    const off = -new Date().getTimezoneOffset() / 60;
    const tz = (Intl.DateTimeFormat().resolvedOptions().timeZone || '');
    const south = /Australia|Pacific\/Auckland|Pacific\/Fiji|America\/Sao_Paulo|America\/Argentina|America\/Santiago|Africa\/Johannesburg|Africa\/Cairo|Indian\/Mauritius/.test(tz);
    return { lat: south ? -25 : 25, lon: off * 15, city: '', source: 'tz' };
  }

  const viewer = tzViewer();
  const sunDir = earthMat.uniforms.uSunDir.value;
  sunDir.copy(llToVec3(viewer.lat + 10, viewer.lon, 1).normalize());
  const sunTarget = sunDir.clone();

  function slerpDir(a, b, t) {
    const q = new THREE.Quaternion().setFromUnitVectors(a, b);
    const qi = new THREE.Quaternion().slerp(q, t);
    return a.clone().applyQuaternion(qi);
  }

  /* 鼠标指到球面哪一点，太阳就去哪一点。
     指针离开画布 / 停在球外 / 拖动地球时，光回到「镜头前上方」——
     不能钉在访问者的地理位置：镜头飞到纽约而人还在北京，整面就会发黑。
     IP / 时区仍然决定开场朝向，只是不再决定这盏常亮灯。 */
  let hasPointer = false;
  const pointerNDC = new THREE.Vector2(0, 0);
  const sunRay = new THREE.Raycaster();
  const sunSphere = new THREE.Sphere(new THREE.Vector3(), RADIUS * 0.999);
  const _sunHit = new THREE.Vector3();
  const _homeCam = new THREE.Vector3();
  const _homeUp = new THREE.Vector3(0, 1, 0);
  const _homeRight = new THREE.Vector3();

  function homeSunDir(target) {
    // 从镜头方向抬一点、偏右一点：留一道晨昏线，别把球压成一个亮盘
    _homeCam.copy(camera.position).normalize();
    _homeRight.crossVectors(_homeUp, _homeCam).normalize();
    target.copy(_homeCam)
      .addScaledVector(_homeUp, 0.34)
      .addScaledVector(_homeRight, 0.22)
      .normalize();
    return target;
  }

  function aimSun(dt) {
    // 只有指针真的打在球上时，灯才跟着指针走
    let onGlobe = false;
    if (hasPointer && !downAt) {
      sunRay.setFromCamera(pointerNDC, camera);
      if (sunRay.ray.intersectSphere(sunSphere, _sunHit)) {
        sunTarget.copy(_sunHit).normalize();
        onGlobe = true;
      }
    }
    if (!onGlobe) homeSunDir(sunTarget);
    // 平滑跟随：鼠标动得快时灯是滑过去的，不是瞬移
    const k = 1 - Math.pow(0.0012, Math.min(dt || 0.016, 0.1));
    sunDir.lerp(sunTarget, k).normalize();
  }

  async function resolveViewer() {
    try {
      const cached = JSON.parse(sessionStorage.getItem('world3d.viewer') || 'null');
      if (cached && cached.lat != null) return cached;
    } catch (e) {}
    const grab = async (url, pick) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 1200);
      try {
        const r = await fetch(url, { signal: ctrl.signal });
        const j = await r.json();
        return pick(j);
      } catch (e) { return null; }
      finally { clearTimeout(timer); }
    };
    let v = await grab('https://ipwho.is/', (j) =>
      j && j.success !== false && j.latitude != null
        ? { lat: j.latitude, lon: j.longitude, city: j.city || '', source: 'ip' } : null);
    if (!v) v = await grab('https://ipapi.co/json/', (j) =>
      j && j.latitude != null
        ? { lat: j.latitude, lon: j.longitude, city: j.city || '', source: 'ip' } : null);
    if (!v) v = tzViewer();
    try { sessionStorage.setItem('world3d.viewer', JSON.stringify(v)); } catch (e) {}
    return v;
  }

  /* =========================================================
     7. 相机飞行
     ========================================================= */
  let camTween = null;
  function flyTo(lat, lon, dur) {
    camTween = {
      from: camera.position.clone().normalize(),
      to: llToVec3(lat, lon, 1).normalize(),
      dist: camera.position.length(),
      t: 0, dur: dur || 1.2
    };
  }
  const easeInOut = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  /* =========================================================
     8. 照片（IndexedDB）
     ========================================================= */
  const DB_NAME = 'tree-music';
  const DB_STORE = 'photos';
  let dbPromise = null;
  function db() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(DB_STORE)) d.createObjectStore(DB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }
  function idbPut(key, value) {
    return db().then((d) => new Promise((res, rej) => {
      const tx = d.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put(value, key);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    }));
  }
  function idbGet(key) {
    return db().then((d) => new Promise((res, rej) => {
      const tx = d.transaction(DB_STORE, 'readonly');
      const r = tx.objectStore(DB_STORE).get(key);
      r.onsuccess = () => res(r.result || null);
      r.onerror = () => rej(r.error);
    }));
  }

  /* =========================================================
     9. 树数据 / 树丛聚合
     ========================================================= */
  const state = {
    trees: [],          // {id,name,lat,lon,date,hasPhoto,photoKey}
    groves: [],         // {lat,lon,n,items:[idx]}
    activeGrove: -1,
    pickPlaced: null
  };

  function newId() {
    return 't_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
  }

  function seedTrees() {
    try {
      const s = JSON.parse(localStorage.getItem('world3d.trees.v2'));
      if (Array.isArray(s)) { state.trees = s; return; }
    } catch (e) {}
    // 迁移旧记录：清掉已失效的 blob URL
    try {
      const old = JSON.parse(localStorage.getItem('world3d.trees') || 'null');
      if (Array.isArray(old) && old.length) {
        state.trees = old.map((t) => ({
          id: t.id || newId(), name: t.name || '一棵树',
          lat: t.lat, lon: t.lon, date: t.date || '',
          hasPhoto: false, photoKey: null
        }));
        return;
      }
    } catch (e) {}
    state.trees = [
      { id: 'seed1', name: '北京 · 胡同口的槐', lat: 39.92, lon: 116.40, date: '2026-05-02' },
      { id: 'seed2', name: '北京 · 景山的松', lat: 39.86, lon: 116.47, date: '2026-05-03' },
      { id: 'seed3', name: '北京 · 后海的柳', lat: 39.98, lon: 116.35, date: '2026-05-04' },
      { id: 'seed4', name: '上海 · 梧桐', lat: 31.20, lon: 121.50, date: '2026-04-18' },
      { id: 'seed5', name: '悉尼 · 蓝花楹', lat: -33.86, lon: 151.20, date: '2026-03-07' },
      { id: 'seed6', name: '悉尼 · 桉树', lat: -33.94, lon: 151.22, date: '2026-03-08' },
      { id: 'seed7', name: '巴黎 · 塞纳河边', lat: 48.90, lon: 2.30, date: '2026-06-21' }
    ];
  }
  function persist() {
    try { localStorage.setItem('world3d.trees.v2', JSON.stringify(state.trees)); } catch (e) {}
  }

  const GROVE_STEP = 0.75;
  function buildGroves() {
    const map = new Map();
    state.trees.forEach((t, i) => {
      const key = Math.round(t.lat / GROVE_STEP) + '_' + Math.round(t.lon / GROVE_STEP);
      let g = map.get(key);
      if (!g) { g = { lat: 0, lon: 0, n: 0, items: [] }; map.set(key, g); }
      g.lat += t.lat; g.lon += t.lon; g.n++; g.items.push(i);
    });
    state.groves = [...map.values()].map((g) => {
      g.lat /= g.n; g.lon /= g.n;
      return g;
    });
    return state.groves;
  }

  // 生长曲线：指数饱和，N≈30 到顶（生长语义未定，先只用于尺寸）
  const growth = (n) => 1 - Math.exp(-n / 6);

  /* ---- 一丛：同一个地点被记录几次 → 这一丛几棵 ----
     1 次 → 1 棵；2–3 次 → 3 棵；4–7 次 → 8 棵；8 次以上 → 20 棵（上限）。
     超过 20 棵不再往这一层加树，只让球面聚合点更稠更暗。 */
  const GROVE_TREES = [1, 3, 8, 20];
  const GROVE_TUFT = [1, 3, 5, 7];   // 球面聚合点里的小点个数
  function groveStage(n) {
    const c = Math.max(1, n || 1);
    return c >= 8 ? 3 : c >= 4 ? 2 : c >= 2 ? 1 : 0;
  }
  function groveTrees(n) {
    return GROVE_TREES[groveStage(n)];
  }

  /* ---- 地表痕迹：贴地的暖色晕 + 一小撮更密的点 ----
     不立树、不做 billboard：每个标记是贴着球面的一小片"球冠"，
     顶点落在球面上，所以会随曲率收窄，转到球缘后被球体本身遮住。 */
  const MAX_CAPS = 2048;
  const CAP_SEGS = 16;
  const VPC = CAP_SEGS + 1;                 // 1 个圆心 + 16 个缘点
  const markPos = new Float32Array(MAX_CAPS * VPC * 3);
  const markUv = new Float32Array(MAX_CAPS * VPC * 2);
  const markCol = new Float32Array(MAX_CAPS * VPC * 3);
  const markAlpha = new Float32Array(MAX_CAPS * VPC);
  const markIndex = new Uint32Array(MAX_CAPS * CAP_SEGS * 3);

  for (let c = 0; c < MAX_CAPS; c++) {
    const base = c * VPC;
    for (let s = 0; s < CAP_SEGS; s++) {
      const o = (c * CAP_SEGS + s) * 3;
      markIndex[o] = base;
      markIndex[o + 1] = base + 1 + s;
      markIndex[o + 2] = base + 1 + ((s + 1) % CAP_SEGS);
    }
  }

  const markGeo = new THREE.BufferGeometry();
  markGeo.setAttribute('position', new THREE.BufferAttribute(markPos, 3).setUsage(THREE.DynamicDrawUsage));
  markGeo.setAttribute('aUv', new THREE.BufferAttribute(markUv, 2).setUsage(THREE.DynamicDrawUsage));
  markGeo.setAttribute('aColor', new THREE.BufferAttribute(markCol, 3).setUsage(THREE.DynamicDrawUsage));
  markGeo.setAttribute('aAlpha', new THREE.BufferAttribute(markAlpha, 1).setUsage(THREE.DynamicDrawUsage));
  markGeo.setIndex(new THREE.BufferAttribute(markIndex, 1));
  markGeo.setDrawRange(0, 0);

  const markMat = new THREE.ShaderMaterial({
    uniforms: {
      uSunDir: { value: earthMat.uniforms.uSunDir.value },
      uOpacity: { value: 1.0 }
    },
    vertexShader: `
      attribute vec2 aUv;
      attribute vec3 aColor;
      attribute float aAlpha;
      uniform vec3 uSunDir;
      varying vec2 vUv;
      varying vec3 vColor;
      varying float vAlpha;
      void main(){
        vec3 n = normalize(position);
        float ndl = dot(n, normalize(uSunDir));
        // 暗面也留光：这是"被点亮的地方"，不是受光的物体
        vAlpha = aAlpha * (0.74 + 0.26 * smoothstep(-0.15, 0.45, ndl));
        vUv = aUv;
        vColor = aColor;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uOpacity;
      varying vec2 vUv;
      varying vec3 vColor;
      varying float vAlpha;
      void main(){
        float r = length(vUv - vec2(0.5)) * 2.0;
        if (r > 1.0) discard;
        float fall = pow(1.0 - r, 2.6);
        float core = smoothstep(0.62, 0.0, r);
        float a = vAlpha * (fall * 0.82 + core * 0.34) * uOpacity;
        if (a < 0.004) discard;
        gl_FragColor = vec4(vColor, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: P.pointAdd ? THREE.AdditiveBlending : THREE.NormalBlending
  });

  const marksObj = new THREE.Mesh(markGeo, markMat);
  marksObj.renderOrder = 3;
  scene.add(marksObj);

  // 亮底用暖褐（像渗进纸里的光），暗底用发亮的琥珀（像灯）
  const MARK_WARM = col(P.pointAdd ? '#E8A155' : '#B4612B');
  const MARK_HI = col('#FFD9A0');        // 丛心的亮点

  /* ---- 色阶：两锚色插值（不做四段跳变）---- */
  function rampColor(t) {
    const stops = P.ramp.map(col);
    const x = Math.max(0, Math.min(1, t)) * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(x));
    const c = stops[i].clone().lerp(stops[i + 1], x - i);
    return c;
  }

  /* ---- 地球上不再立树：树只出现在卡片里 ---- */

  const _tanA = new THREE.Vector3();
  const _tanB = new THREE.Vector3();
  const _tangentRef = new THREE.Vector3();
  const _pv = new THREE.Vector3();

  // 球面一点的切平面基：给聚合点的亚点做极近偏移（不飘出这一处）
  function tangentBasis(nv, a, b) {
    _tangentRef.set(0, 1, 0);
    if (Math.abs(nv.y) > 0.92) _tangentRef.set(0, 0, 1);
    a.copy(_tangentRef).cross(nv).normalize();
    b.copy(nv).cross(a).normalize();
  }

  const _dv = new THREE.Vector3();
  let capBase = 0;

  // 一片贴地的球冠：圆心 + 一圈落在球面上的缘点。
  // 写成通用 writeCap，树丛痕迹和小飞机的「到过」环共用同一套几何。
  function writeCap(A, nv, tanA, tanB, radius, color, alpha) {
    if (A.base >= A.max) return;
    const H = RADIUS * 1.0008;
    const base = A.base * VPC;
    const p = base * 3, u = base * 2;
    A.pos[p] = nv.x * H; A.pos[p + 1] = nv.y * H; A.pos[p + 2] = nv.z * H;
    A.uv[u] = 0.5; A.uv[u + 1] = 0.5;
    A.col[p] = color.r; A.col[p + 1] = color.g; A.col[p + 2] = color.b;
    A.alpha[base] = alpha;

    for (let s = 0; s < CAP_SEGS; s++) {
      const ang = (s / CAP_SEGS) * Math.PI * 2;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      _pv.copy(nv)
        .addScaledVector(tanA, ca * radius)
        .addScaledVector(tanB, sa * radius)
        .normalize()
        .multiplyScalar(H);
      const vi = base + 1 + s;
      A.pos[vi * 3] = _pv.x; A.pos[vi * 3 + 1] = _pv.y; A.pos[vi * 3 + 2] = _pv.z;
      A.uv[vi * 2] = 0.5 + 0.5 * ca;
      A.uv[vi * 2 + 1] = 0.5 + 0.5 * sa;
      A.col[vi * 3] = color.r; A.col[vi * 3 + 1] = color.g; A.col[vi * 3 + 2] = color.b;
      A.alpha[vi] = alpha;
    }
    A.base++;
  }
  const markCap = { pos: markPos, uv: markUv, col: markCol, alpha: markAlpha, base: 0, max: MAX_CAPS };
  function pushCap(nv, tanA, tanB, radius, color, alpha) {
    writeCap(markCap, nv, tanA, tanB, radius, color, alpha);
  }

  function updatePoints() {
    markCap.base = 0;
    const groves = state.groves;

    for (let i = 0; i < groves.length; i++) {
      if (markCap.base + GROVE_TUFT[3] + 1 >= MAX_CAPS) break;
      const g = groves[i];
      const stage = groveStage(g.n);
      const s = growth(g.n);
      const nv = llToVec3(g.lat, g.lon, 1).normalize();
      tangentBasis(nv, _tanA, _tanB);
      const active = (i === state.activeGrove);

      // 档位 → 面积与亮度：1/3/8/20 四层，20 之后只继续变亮变稠
      const radius = (0.018 + 0.011 * stage + 0.008 * s) * (active ? 1.30 : 1);
      const strength = (0.40 + 0.11 * stage + 0.09 * s) * (active ? 1.35 : 1);
      pushCap(nv, _tanA, _tanB, radius, MARK_WARM, strength);

      // 一小撮更密的点：0 / 2 / 4 / 6 个，全贴在球面上
      const dots = Math.max(0, GROVE_TUFT[stage] - 1);
      const dotR = (0.0040 + 0.0015 * stage) * (active ? 1.2 : 1);
      const spread = radius * 0.42;
      for (let k = 0; k < dots; k++) {
        const ang = i * 1.31 + (k + 1) * 2.39996;
        const rr = spread * (0.55 + 0.45 * ((k * 5) % 7) / 7);
        _dv.copy(nv)
          .addScaledVector(_tanA, Math.cos(ang) * rr)
          .addScaledVector(_tanB, Math.sin(ang) * rr)
          .normalize();
        pushCap(_dv, _tanA, _tanB, dotR, MARK_HI, Math.min(1, strength * 1.55));
      }
    }

    markGeo.setDrawRange(0, markCap.base * CAP_SEGS * 3);
    markGeo.attributes.position.needsUpdate = true;
    markGeo.attributes.aUv.needsUpdate = true;
    markGeo.attributes.aColor.needsUpdate = true;
    markGeo.attributes.aAlpha.needsUpdate = true;

    $('count').textContent = state.trees.length + ' 棵';
  }

  /* =========================================================
     9b. 小飞机：飞行状态 + 「到过」的球面痕迹
     ========================================================= */
  const FLIGHT_KEY = 'world3d.flight.v1';
  function loadFlight() {
    try {
      const f = JSON.parse(localStorage.getItem(FLIGHT_KEY));
      if (f && typeof f === 'object') {
        return {
          usedAt: f.usedAt || 0,
          nextAt: f.nextAt || 0,
          cadence: (f.cadence === 24 ? 24 : 12),
          visits: Array.isArray(f.visits) ? f.visits : []
        };
      }
    } catch (e) {}
    return { usedAt: 0, nextAt: 0, cadence: 12, visits: [] };
  }
  const flight = loadFlight();
  function saveFlight() {
    try { localStorage.setItem(FLIGHT_KEY, JSON.stringify(flight)); } catch (e) {}
  }
  function flightReady() { return Date.now() >= (flight.nextAt || 0); }
  function flightRemain() {
    const ms = Math.max(0, (flight.nextAt || 0) - Date.now());
    const mins = Math.ceil(ms / 60000);
    return mins >= 60
      ? Math.floor(mins / 60) + ' 小时 ' + (mins % 60) + ' 分'
      : mins + ' 分';
  }

  // 到过的地方：一圈贴地的淡环，和树丛的暖色痕迹分开，不抢注意力
  const VISIT_CAPS = 96;
  const visitPos = new Float32Array(VISIT_CAPS * VPC * 3);
  const visitUv = new Float32Array(VISIT_CAPS * VPC * 2);
  const visitCol = new Float32Array(VISIT_CAPS * VPC * 3);
  const visitAlpha = new Float32Array(VISIT_CAPS * VPC);
  const visitIndex = new Uint32Array(VISIT_CAPS * CAP_SEGS * 3);
  for (let c = 0; c < VISIT_CAPS; c++) {
    const base = c * VPC;
    for (let s = 0; s < CAP_SEGS; s++) {
      const o = (c * CAP_SEGS + s) * 3;
      visitIndex[o] = base;
      visitIndex[o + 1] = base + 1 + s;
      visitIndex[o + 2] = base + 1 + ((s + 1) % CAP_SEGS);
    }
  }
  const visitGeo = new THREE.BufferGeometry();
  visitGeo.setAttribute('position', new THREE.BufferAttribute(visitPos, 3).setUsage(THREE.DynamicDrawUsage));
  visitGeo.setAttribute('aUv', new THREE.BufferAttribute(visitUv, 2).setUsage(THREE.DynamicDrawUsage));
  visitGeo.setAttribute('aColor', new THREE.BufferAttribute(visitCol, 3).setUsage(THREE.DynamicDrawUsage));
  visitGeo.setAttribute('aAlpha', new THREE.BufferAttribute(visitAlpha, 1).setUsage(THREE.DynamicDrawUsage));
  visitGeo.setIndex(new THREE.BufferAttribute(visitIndex, 1));
  visitGeo.setDrawRange(0, 0);

  const visitMat = new THREE.ShaderMaterial({
    uniforms: {
      uSunDir: { value: earthMat.uniforms.uSunDir.value }
    },
    vertexShader: `
      attribute vec2 aUv;
      attribute vec3 aColor;
      attribute float aAlpha;
      uniform vec3 uSunDir;
      varying vec2 vUv;
      varying vec3 vColor;
      varying float vAlpha;
      void main(){
        vec3 n = normalize(position);
        float ndl = dot(n, normalize(uSunDir));
        vAlpha = aAlpha * (0.72 + 0.28 * smoothstep(-0.2, 0.5, ndl));
        vUv = aUv;
        vColor = aColor;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      varying vec3 vColor;
      varying float vAlpha;
      void main(){
        float r = length(vUv - vec2(0.5)) * 2.0;
        float ring = smoothstep(0.90, 0.74, r) * smoothstep(0.50, 0.66, r);
        float a = vAlpha * ring;
        if (a < 0.004) discard;
        gl_FragColor = vec4(vColor, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: P.pointAdd ? THREE.AdditiveBlending : THREE.NormalBlending
  });
  const visitObj = new THREE.Mesh(visitGeo, visitMat);
  visitObj.renderOrder = 4;
  scene.add(visitObj);

  const visitCap = { pos: visitPos, uv: visitUv, col: visitCol, alpha: visitAlpha, base: 0, max: VISIT_CAPS };
  const VISIT_COLOR = col(P.pointAdd ? '#9FD8C6' : '#8C4A2B');
  function updateVisits() {
    visitCap.base = 0;
    const vs = flight.visits || [];
    for (let i = 0; i < vs.length && visitCap.base < VISIT_CAPS; i++) {
      const v = vs[i];
      if (!v || !isFinite(v.lat) || !isFinite(v.lon)) continue;
      const nv = llToVec3(v.lat, v.lon, 1).normalize();
      tangentBasis(nv, _tanA, _tanB);
      // 最近一次最亮，越早的越淡，但都留着
      const a = Math.max(0.20, 0.62 - i * 0.05);
      writeCap(visitCap, nv, _tanA, _tanB, 0.034, VISIT_COLOR, a);
    }
    visitGeo.setDrawRange(0, visitCap.base * CAP_SEGS * 3);
    visitGeo.attributes.position.needsUpdate = true;
    visitGeo.attributes.aUv.needsUpdate = true;
    visitGeo.attributes.aColor.needsUpdate = true;
    visitGeo.attributes.aAlpha.needsUpdate = true;
  }

  /* =========================================================
     10. 树种：离线地域锚点（data/species.js）
     只说「这一带常见」，不说「只此一地」；用户自己起的名字优先
     ========================================================= */
  function placeFor(lat, lon) {
    if (!window.TreePlaces || !isFinite(lat) || !isFinite(lon)) return null;
    return window.TreePlaces.lookup(lat, lon);
  }
  function extractTreeSpecies(name) {
    const dict = ['槐', '松', '柳', '梧桐', '银杏', '蓝花楹', '桉树', '枫', '橡', '榕', '桦', '菩提', '猴面包树', '樟', '桂', '梅', '竹', '杨', '柏'];
    for (const s of dict) if (name && name.indexOf(s) >= 0) return s;
    return null;
  }
  function formFor(text) {
    if (!text) return 'oak';
    // 与 data/species.js 同一套中文树种 → 原型映射（榕 / 松 / 椰 / 花树…）
    if (window.TreePlaces && window.TreePlaces.formFor) return window.TreePlaces.formFor(text);
    if (/银杏/.test(text)) return 'ginkgo';
    if (/柳/.test(text)) return 'willow';
    if (/灌木/.test(text)) return 'bush';
    return 'oak';
  }

  /* =========================================================
     11. 地点 / 卡片 / 落点
     ========================================================= */
  const CITIES = {
    '北京': [39.9, 116.4], '上海': [31.2, 121.5], '广州': [23.1, 113.3],
    '深圳': [22.5, 114.1], '杭州': [30.3, 120.2], '成都': [30.6, 104.1],
    '重庆': [29.6, 106.5], '武汉': [30.6, 114.3], '西安': [34.3, 108.9],
    '香港': [22.32, 114.17], '台北': [25.03, 121.56], '澳门': [22.19, 113.54],
    '东京': [35.7, 139.7], '首尔': [37.6, 127.0], '伦敦': [51.5, -0.1],
    '巴黎': [48.9, 2.3], '纽约': [40.7, -74.0], '洛杉矶': [34.1, -118.2],
    '旧金山': [37.8, -122.4], '悉尼': [-33.9, 151.2], '墨尔本': [-37.8, 145.0],
    '新加坡': [1.35, 103.8], '曼谷': [13.8, 100.5], '柏林': [52.5, 13.4],
    '罗马': [41.9, 12.5], '莫斯科': [55.8, 37.6], '迪拜': [25.2, 55.3],
    '孟买': [19.1, 72.9], '开罗': [30.0, 31.2], '内罗毕': [-1.3, 36.8]
  };
  // 小飞机的目的地：比「转过去」的城市表大一圈，够支撑「去没去过的地方」
  const FAR_PLACES = {
    '南京': [32.1, 118.8], '苏州': [31.3, 120.6], '厦门': [24.5, 118.1],
    '昆明': [25.0, 102.7], '大理': [25.6, 100.2], '丽江': [26.9, 100.2],
    '拉萨': [29.7, 91.1], '敦煌': [40.1, 94.7], '桂林': [25.3, 110.3],
    '青岛': [36.1, 120.4], '长沙': [28.2, 112.9], '哈尔滨': [45.8, 126.5],
    '三亚': [18.3, 109.5], '西安': [34.3, 108.9], '洛阳': [34.6, 112.5],
    '京都': [35.0, 135.8], '大阪': [34.7, 135.5], '札幌': [43.1, 141.3],
    '清迈': [18.8, 99.0], '河内': [21.0, 105.8], '巴厘岛': [-8.4, 115.2],
    '雅加达': [-6.2, 106.8], '马尼拉': [14.6, 121.0], '吉隆坡': [3.1, 101.7],
    '加尔各答': [22.6, 88.4], '伊斯坦布尔': [41.0, 28.9], '雅典': [38.0, 23.7],
    '里斯本': [38.7, -9.1], '巴塞罗那': [41.4, 2.2], '阿姆斯特丹': [52.4, 4.9],
    '维也纳': [48.2, 16.4], '布拉格': [50.1, 14.4], '斯德哥尔摩': [59.3, 18.1],
    '奥斯陆': [59.9, 10.8], '赫尔辛基': [60.2, 24.9], '雷克雅未克': [64.1, -21.9],
    '冰岛': [64.9, -19.0],
    '开普敦': [-33.9, 18.4], '里约': [-22.9, -43.2], '布宜诺斯艾利斯': [-34.6, -58.4],
    '墨西哥城': [19.4, -99.1], '温哥华': [49.3, -123.1], '西雅图': [47.6, -122.3],
    '芝加哥': [41.9, -87.6], '奥克兰': [-36.8, 174.8], '惠灵顿': [-41.3, 174.8]
  };
  const DESTINATIONS = Object.assign({}, CITIES, FAR_PLACES);
  function lookupCity(q) {
    q = (q || '').trim();
    if (!q) return null;
    for (const k in CITIES) if (k.indexOf(q) >= 0 || q.indexOf(k) >= 0) return CITIES[k];
    return null;
  }
  // 地名优先；也接受 "13.8,100.5" 这种直接给的坐标
  function resolveDest(q) {
    q = (q || '').trim();
    if (!q) return null;
    const m = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,，\s]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (m) {
      const lat = parseFloat(m[1]), lon = parseFloat(m[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { name: fmtLoc(lat, lon), lat, lon };
    }
    for (const k in DESTINATIONS) {
      if (k.indexOf(q) >= 0 || q.indexOf(k) >= 0) {
        return { name: k, lat: DESTINATIONS[k][0], lon: DESTINATIONS[k][1] };
      }
    }
    return null;
  }
  function suggestDest(q) {
    q = (q || '').trim();
    if (!q) return [];
    return Object.keys(DESTINATIONS)
      .filter((k) => k.indexOf(q) >= 0 || q.indexOf(k) >= 0)
      .slice(0, 6)
      .map((k) => ({ name: k, lat: DESTINATIONS[k][0], lon: DESTINATIONS[k][1] }));
  }
  function fmtLoc(lat, lon) {
    const ns = lat >= 0 ? 'N' : 'S', ew = lon >= 0 ? 'E' : 'W';
    return Math.abs(lat).toFixed(2) + '°' + ns + '  ' + Math.abs(lon).toFixed(2) + '°' + ew;
  }
  function today() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function placeTree(t) {
    state.trees.push(t);
    persist();
    buildGroves();
    const gi = state.groves.findIndex((g) => g.items.includes(state.trees.length - 1));
    state.activeGrove = gi;
    updatePoints();
    updateCard(gi);
  }

  function updateCard(gi) {
    const card = $('card');
    const g = state.groves[gi];
    if (!g) { card.classList.remove('open'); return; }
    // 树丛里取最新的一棵展示
    const tr = state.trees[g.items[g.items.length - 1]];
    const info = placeFor(tr.lat, tr.lon);
    const custom = (tr.name || '').trim();

    // 名字：用户写过的优先；否则用「地名 + 场景 + 树种」，例如「上环的石墙细叶榕」
    $('cardName').textContent = custom || (info ? info.title : '一棵树');
    $('cardTree').textContent = info ? info.species.slice(0, 2).join(' · ') : '';
    // 这是第几次、这一丛几棵：棵数按档位（1/3/8/20），名字优先级不动
    const stage = groveStage(g.n);
    const trees = GROVE_TREES[stage];
    $('cardVisit').textContent = '第 ' + g.n + ' 次来到这里 · 这一丛 ' + trees + ' 棵 · 第 ' + (stage + 1) + ' 档';
    $('cardGroveOpen').textContent = '收起这一丛';
    $('cardGroveOpen').setAttribute('aria-expanded', 'true');
    $('cardGrove').hidden = false;
    $('groveCap').textContent = g.n > 8
      ? '树没变，变的是周围这片林子 · 这一丛已到 20 棵上限'
      : '树没变，变的是周围这片林子';
    $('cardSpecies').textContent = info ? info.tag : '';
    $('cardImagery').textContent = info
      ? [info.imagery, info.note].filter(Boolean).join(' —— ')
      : '';
    // 小飞机寄来的树：把来处留住，不假装它本来就长在这里
    const cf = $('cardFlight');
    if (tr.movedFrom) {
      const from = tr.movedFrom.name || fmtLoc(tr.movedFrom.lat, tr.movedFrom.lon);
      cf.textContent = tr.locSource === 'manual'
        ? '从 ' + from + ' 改到这里'
        : '小飞机从 ' + from + ' 寄来' + (tr.sentTo ? ' · 落在 ' + tr.sentTo : '');
      cf.hidden = false;
    } else {
      cf.hidden = true;
    }
    $('cardDate').textContent = tr.date || '';
    $('cardLoc').textContent = fmtLoc(tr.lat, tr.lon);
    // 位置来源：照片 GPS / 亲手放置 / 按 IP 猜的（不可当真）。一眼看出这坐标能不能信
    const src = $('cardLocSrc');
    const srcLabel = tr.locSource === 'gps' ? '来自照片自带的 GPS'
      : tr.locSource === 'manual' ? '你亲手放的位置'
        : tr.locSource === 'guess' ? '按访问地 IP 猜的 · 不是照片的真实位置'
          : tr.id && tr.id.indexOf('seed') === 0 ? '示例数据' : '';
    if (src) {
      src.hidden = !srcLabel;
      if (srcLabel) src.innerHTML = '位置 · <b>' + srcLabel + '</b>';
    }
    const fixBtn = $('cardLocFix');
    if (fixBtn) fixBtn.hidden = false;
    const editBox = $('cardLocEdit');
    if (editBox) editBox.hidden = true;
    // 这棵树的声音：与树页同一套算法（默认按 id 分配，手选覆盖）
    const song = songForTree(tr.id);
    const cs = $('cardSong');
    if (cs) { cs.textContent = '♫ ' + song.name + ' · ' + song.mood; cs.hidden = false; }

    const img = $('cardImg');
    if (img._url) { URL.revokeObjectURL(img._url); img._url = null; }
    img.style.backgroundImage = '';
    img.hidden = true;
    if (tr.hasPhoto && tr.photoKey) {
      idbGet(tr.photoKey).then((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        img._url = url;
        img.style.backgroundImage = 'url("' + url + '")';
        img.hidden = false;
      }).catch(() => {});
    }
    card.classList.add('open');
    drawGroveCard(g);
  }

  /* ---- 卡片里的「这一丛」：按档位画 1 / 3 / 8 / 20 棵 ----
     复用 forms.js 的树形；同一地点同一颗种子，形状不变。
     只在展开时画一次并缓存，不进入每帧。 */
  const GROVE_CACHE = new Map();

  function groveHash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return Math.abs(h) % 900000 + 1000;
  }

  /* ---- 这棵树的曲风：与树页 app.js 完全同一套算法 ----
     树页按 seedFrom('engine:<treeId>')%3 分配，手选覆盖存 localStorage['tree.engine:<id>']。
     groveHash 就是树页的 seedFrom（同一个 FNV），所以这里能算出同一曲风。
     两页同源、localStorage 共享 → 手选后这里也跟着变，"这棵树的声音"跨页一致。 */
  const SONG_KEYS = ['pluck', 'minimal', 'bell'];
  const SONG_META = {
    pluck:   { name: '拨弦 · 五声', mood: '枝梢像雨点，一颗一颗落下来' },
    minimal: { name: '极简循环',   mood: '一小段音型反复转，像年轮' },
    bell:    { name: '钟琴 · 空谷', mood: '金属泛音悬在空气中，很久才散' }
  };
  function songForTree(id) {
    let key = null;
    if (id) {
      try { key = localStorage.getItem('tree.engine:' + id); } catch (e) {}
    }
    if (!key || !SONG_META[key]) key = SONG_KEYS[groveHash('engine:' + (id || 'x')) % 3];
    return { key: key, name: SONG_META[key].name, mood: SONG_META[key].mood };
  }
  function groveRng(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  function treeInk() {
    if (paletteKey === 'paper') return '#243238';
    if (paletteKey === 'warm') return '#F6EBD6';
    return '#E8F1F8';
  }
  /* 单棵树的 sprite：用树页同一套 TreeArt 烘焙画法，不再画细线骨架。
     形态按当地树种认原型（榕 / 松 / 椰 / 花树…），所以北京和悉尼一眼不同。 */
  const SPRITE_CACHE = new Map();
  function makeGroveSprite(form, seed) {
    const key = form + '|' + seed + '|' + paletteKey;
    if (SPRITE_CACHE.has(key)) return SPRITE_CACHE.get(key);
    const c = document.createElement('canvas');
    c.width = 200; c.height = 240;
    const g = c.getContext('2d');
    let art = null;
    if (window.TreeArt) {
      try { art = window.TreeArt.build(seed, form, null); } catch (e) { art = null; }
    }
    if (art && art.tc) {
      // TreeArt 烘焙在 560×680，等比塞进 200×240（顶上留一点给冠）
      const sw = art.w || 560, sh = art.h || 680;
      const sc = Math.min(200 / sw, 240 / sh);
      g.drawImage(art.tc, 0, 0, sw, sh,
        (200 - sw * sc) / 2, 240 - sh * sc, sw * sc, sh * sc);
    } else if (window.TreeForms) {
      // 兜底：TreeArt 没加载时才退回骨架（正常路径不会走到）
      const data = window.TreeForms.generate(form, seed, 200, 240);
      g.strokeStyle = treeInk(); g.lineCap = 'round'; g.lineJoin = 'round';
      for (const s of data.segs) {
        g.lineWidth = Math.max(3.6, s.w * 1.2);
        g.beginPath(); g.moveTo(s.x1, s.y1);
        g.quadraticCurveTo(s.cx, s.cy, s.x2, s.y2); g.stroke();
      }
    }
    // 夜 / 暖 配色是浅字深底：把树整体提亮成冷银 / 暖象牙，保持明暗层次
    if (paletteKey !== 'paper') {
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = paletteKey === 'warm' ? 'rgba(246,235,214,0.34)' : 'rgba(226,238,246,0.30)';
      g.fillRect(0, 0, 200, 240);
      g.globalCompositeOperation = 'source-over';
    }
    SPRITE_CACHE.set(key, c);
    return c;
  }

  function drawGroveCard(g) {
    const cv = $('groveCv');
    if (!cv) return;
    const W = Math.max(120, cv.clientWidth || 192);
    const H = Math.max(72, cv.clientHeight || 104);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const info = placeFor(g.lat, g.lon);
    // 当地树种原型：按 primary 中文名认，认不出再用锚点 form
    const primaryForm = (window.TreePlaces && info && info.primary)
      ? window.TreePlaces.formFor(info.primary) : ((info && info.form) || 'oak');
    // 一丛里混一点当地的其他树种（species 列表），不再是清一色同一棵
    const localForms = info && info.species && info.species.length
      ? info.species.map((n) => window.TreePlaces ? window.TreePlaces.formFor(n) : primaryForm)
      : [primaryForm];
    const formSig = localForms.join('+');
    const trees = groveTrees(g.n);
    const key = [g.lat.toFixed(4), g.lon.toFixed(4), trees, formSig, paletteKey, W, H].join('|');

    let off = GROVE_CACHE.get(key);
    if (!off) {
      off = document.createElement('canvas');
      off.width = Math.round(W * dpr);
      off.height = Math.round(H * dpr);
      const c = off.getContext('2d');
      c.setTransform(dpr, 0, 0, dpr, 0, 0);

      // 自然林布局：随机落点，挤到一起就换一个（与 grove 原型同一套读法）
      const rnd = groveRng(groveHash(g.lat + ',' + g.lon));
      const pts = [];
      const gap = Math.max(0.09, Math.min(0.30, 0.5 / Math.sqrt(trees)));
      for (let i = 0; i < trees; i++) {
        let x = 0.5, d = 0.5, ok = false;
        for (let t = 0; t < 30 && !ok; t++) {
          x = 0.10 + rnd() * 0.80;
          d = rnd();
          ok = true;
          for (const p of pts) {
            if (Math.hypot((p.x - x) * 1.5, p.d - d) < gap) { ok = false; break; }
          }
        }
        if (!ok) { x = 0.12 + (i + 0.5) / trees * 0.76; d = 0.35 + 0.4 * ((i % 3) / 2); }
        pts.push({ x, d, i });
      }
      const mid = pts.reduce((a, p) => a + p.x, 0) / pts.length;
      // 棵数越多，单棵收小一点：1 棵是主角，20 棵才装得进一小片
      const sizeK = trees <= 3 ? 1 : (trees <= 8 ? 0.82 : 0.64);
      pts.forEach((p) => {
        p.h = H * 0.60 * (0.58 + 0.42 * Math.exp(-p.i / 5.5)) *
          (0.90 + 0.20 * rnd()) * (0.55 + 0.45 * p.d) * sizeK;
        p.w = p.h * 0.82 * (0.86 + 0.30 * rnd());
        p.gx = W / 2 + (p.x - mid) * W * (0.84 + 0.16 * p.d);
        p.gy = H * 0.80 + Math.pow(p.d, 1.15) * (H * 0.20 - 2);
        p.face = rnd() < 0.5 ? -1 : 1;
        p.seed = groveHash(g.lat + ',' + g.lon + '#' + p.i);
      });

      // 远的先画，近的后画：遮挡与纵深才成立
      pts.sort((a, b) => a.d - b.d);

      // 落影（全部先落在地上）
      c.fillStyle = paletteKey === 'paper' ? 'rgba(36,50,56,0.10)' : 'rgba(0,0,0,0.24)';
      pts.forEach((p) => {
        c.beginPath();
        c.ellipse(p.gx, p.gy + p.h * 0.012, p.w * 0.30, p.w * 0.055, 0, 0, 6.2832);
        c.fill();
      });

      const sprites = new Map();
      pts.forEach((p) => {
        // 每棵挑一个当地树种，首棵用主树种；同一 seed 形状稳定
        const form = p.i === 0 ? localForms[0] : localForms[p.i % localForms.length];
        const ck = form + '|' + p.seed;
        let spr = sprites.get(ck);
        if (!spr) { spr = makeGroveSprite(form, p.seed); sprites.set(ck, spr); }
        c.save();
        c.translate(p.gx, p.gy);
        c.scale(p.face, 1);
        c.globalAlpha = 0.44 + 0.56 * p.d;
        c.drawImage(spr, -p.w / 2, -p.h * 0.96, p.w, p.h);
        c.restore();
      });
      c.globalAlpha = 1;
      GROVE_CACHE.set(key, off);
    }

    cv.width = off.width;
    cv.height = off.height;
    const ctx = cv.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(off, 0, 0);
  }

  /* =========================================================
     12. 拾取
     ========================================================= */
  const raycaster = new THREE.Raycaster();
  raycaster.params.Points.threshold = 0.03;
  const mouse = new THREE.Vector2();

  function pickLatLon(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const hit = raycaster.intersectObject(earth, false);
    if (!hit.length) return null;
    const p = earth.worldToLocal(hit[0].point.clone());
    const lat = Math.asin(Math.max(-1, Math.min(1, p.y / RADIUS))) * 180 / Math.PI;
    const lon = -Math.atan2(p.z, p.x) * 180 / Math.PI;
    return { lat, lon };
  }

  // 按屏幕像素找最近的树丛：比 Points 的世界坐标阈值可靠，
  // 点小也能点中，而且不会点到背面的树。
  const _groveV = new THREE.Vector3();
  function hitGrove(clientX, clientY) {
    if (!state.groves.length) return -1;
    const rect = renderer.domElement.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const cam = camera.position;
    let best = -1, bestD = 1e9;

    for (let i = 0; i < state.groves.length; i++) {
      const g = state.groves[i];
      _groveV.copy(llToVec3(g.lat, g.lon, RADIUS));
      // 背面的树丛不参与拾取
      if (_groveV.dot(cam) - _groveV.lengthSq() <= 0) continue;
      _groveV.project(camera);
      if (_groveV.z < -1 || _groveV.z > 1) continue;
      const sx = (_groveV.x * 0.5 + 0.5) * rect.width;
      const sy = (-_groveV.y * 0.5 + 0.5) * rect.height;
      const d = Math.hypot(sx - px, sy - py);
      if (d < 22 && d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  let downAt = null;

  function onPointerDown(event) {
    if (event.button !== 0) return;
    userTouched = true;
    downAt = { x: event.clientX, y: event.clientY, t: performance.now(), moved: false };
    renderer.domElement.style.cursor = 'grabbing';
  }

  function onPointerMove(event) {
    // 指针位置给太阳用：指针在哪一侧，哪一侧亮
    hasPointer = true;
    const rect = renderer.domElement.getBoundingClientRect();
    pointerNDC.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointerNDC.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    if (downAt) {
      if (Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > 6) downAt.moved = true;
      return;
    }
    if (state.pickPlaced) { renderer.domElement.style.cursor = 'crosshair'; return; }
    renderer.domElement.style.cursor = hitGrove(event.clientX, event.clientY) >= 0 ? 'pointer' : 'grab';
  }

  function onPointerUp(event) {
    if (event.button !== 0) return;
    renderer.domElement.style.cursor = state.pickPlaced ? 'crosshair' : 'grab';
    const wasClick = downAt && !downAt.moved && performance.now() - downAt.t < 700;
    downAt = null;
    // 手指抬起就没有"悬停"了，灯回我所在的位置
    if (event.pointerType === 'touch') hasPointer = false;
    if (!wasClick) return;
    handleTap(event);
  }

  function handleTap(event) {
    // 落点模式：点球面放树
    if (state.pickPlaced) {
      const ll = pickLatLon(event);
      if (!ll) return;
      const t = state.pickPlaced;
      t.lat = ll.lat; t.lon = ll.lon;
      t.locSource = 'manual';        // 用户亲手点的位置，不是 IP 猜的
      state.pickPlaced = null;
      document.body.classList.remove('picking');
      renderer.domElement.style.cursor = 'grab';
      placeTree(t);
      $('status').textContent = '已落点：' + fmtLoc(t.lat, t.lon);
      return;
    }

    const gi = hitGrove(event.clientX, event.clientY);
    if (gi >= 0) {
      state.activeGrove = gi;
      updatePoints();
      updateCard(gi);
      return;
    }
    if (state.activeGrove >= 0) {
      state.activeGrove = -1;
      updatePoints();
      $('cardGrove').hidden = true;
      $('card').classList.remove('open');
    }
  }

  /* =========================================================
     13. EXIF：GPS + 说明（说明用 exif.js 的共用解码）
     ========================================================= */
  function readExif(file, cb) {
    const fr = new FileReader();
    fr.onload = function () {
      const dv = new DataView(fr.result);
      if (dv.getUint16(0) !== 0xFFD8) { cb(null); return; }
      let off = 2;
      for (; off + 4 < dv.byteLength;) {
        const marker = dv.getUint16(off), size = dv.getUint16(off + 2);
        if (marker === 0xFFE1 && dv.getUint32(off + 4) === 0x45786966) {
          cb(parseExif(dv, off + 4)); return;
        }
        if (size < 2) break;
        off += 2 + size;
      }
      cb(null);
    };
    fr.readAsArrayBuffer(file);
  }
  function parseExif(dv, base) {
    try {
      const tiff = base + 6;
      const order = dv.getUint16(tiff) === 0x4949;
      const r16 = (o) => order ? dv.getUint16(o, true) : dv.getUint16(o, false);
      const r32 = (o) => order ? dv.getUint32(o, true) : dv.getUint32(o, false);
      const ifd0 = tiff + r32(tiff + 4);
      const n = r16(ifd0);
      let gpsPtr = 0;
      const texts = { desc: null, title: null, comment: null, user: null };
      let rawFailed = null;

      const tagBytes = (e) => {
        const type = r16(e + 2), cnt = r32(e + 4);
        const unit = type === 3 ? 2 : type === 4 ? 4 : type === 5 ? 8 : 1;
        const total = cnt * unit;
        if (!total) return null;
        const start = total <= 4 ? e + 8 : tiff + r32(e + 8);
        if (start < 0 || start + total > dv.byteLength) return null;
        return new Uint8Array(dv.buffer, dv.byteOffset + start, total);
      };
      const readText = (tag, e) => {
        const b = tagBytes(e);
        if (!b) return null;
        const r = window.ExifText ? window.ExifText.forTag(tag, b) : null;
        if (!r) return null;
        if (!r.text && r.raw && !rawFailed) rawFailed = r.raw;
        return r.text || null;
      };

      for (let i = 0; i < n; i++) {
        const e = ifd0 + 2 + i * 12;
        const tag = r16(e);
        // EXIF 里的偏移都是相对 TIFF 头的，不是相对文件头
        if (tag === 0x8825) gpsPtr = tiff + r32(e + 8);
        else if (tag === 0x010E || tag === 0x9C9B || tag === 0x9C9E || tag === 0x9286) {
          const txt = readText(tag, e);
          if (!txt) continue;
          if (tag === 0x010E) texts.desc = txt;
          else if (tag === 0x9C9B) texts.title = txt;
          else if (tag === 0x9C9E) texts.comment = txt;
          else texts.user = txt;
        }
      }

      const desc = (texts.desc || texts.title || texts.comment || texts.user || '').trim() || null;
      const out = { lat: null, lon: null, desc, descRaw: rawFailed };
      if (!gpsPtr) return out;
      const gn = r16(gpsPtr);
      let lat = null, lon = null, latRef = 'N', lonRef = 'E';
      for (let j = 0; j < gn; j++) {
        const ge = gpsPtr + 2 + j * 12;
        const gtag = r16(ge);
        const rat = (o) => r32(o) / r32(o + 4);
        if (gtag === 1) latRef = dv.getUint8(ge + 8) === 0x4E ? 'N' : 'S';
        else if (gtag === 2) { const lp = tiff + r32(ge + 8); lat = rat(lp) + rat(lp + 8) / 60 + rat(lp + 16) / 3600; }
        else if (gtag === 3) lonRef = dv.getUint8(ge + 8) === 0x45 ? 'E' : 'W';
        else if (gtag === 4) { const op = tiff + r32(ge + 8); lon = rat(op) + rat(op + 8) / 60 + rat(op + 16) / 3600; }
      }
      if (lat == null || lon == null) return out;
      out.lat = latRef === 'S' ? -lat : lat;
      out.lon = lonRef === 'W' ? -lon : lon;
      return out;
    } catch (e) { return null; }
  }

  function handleFile(file) {
    if (!file || !/^image\//.test(file.type)) return;
    const id = newId();
    // 名字优先用 EXIF 里真实的说明；没有才交给地域映射
    const rec = { id, name: '', lat: null, lon: null, date: today(), hasPhoto: true, photoKey: id };

    // 照片进 IndexedDB，不再把 blob URL 塞进 localStorage
    idbPut(id, file).catch(() => {});

    readExif(file, (ex) => {
      if (ex && ex.desc) rec.name = ex.desc;
      // 说明字段解不出来时留痕，不静默吞掉
      if (ex && !ex.desc && ex.descRaw) console.warn('[exif] 说明字段解不出来：', ex.descRaw);
      const gps = ex && ex.lat != null && ex.lon != null ? ex : null;
      if (gps) {
        rec.lat = gps.lat; rec.lon = gps.lon;
        rec.locSource = 'gps';        // 照片自带 GPS，真实位置
        placeTree(rec);
        $('status').textContent = '已按照片 GPS 落点：' + fmtLoc(gps.lat, gps.lon);
      } else {
        // 照片没 GPS（微信 / 截图 / 转码都可能抹掉 EXIF）：不偷偷当成真实位置
        rec.lat = viewer.lat; rec.lon = viewer.lon;
        rec.locSource = 'guess';      // 只是按访问者 IP 猜的开场位置，不是照片位置
        state.pickPlaced = rec;
        document.body.classList.add('picking');
        $('status').textContent = '照片里没有 GPS（发图/截图常会抹掉）· 点地球放下真实位置，或在卡片里改坐标';
      }
    });
  }

  /* =========================================================
     13b. 小飞机 UI：飞过去 / 把树寄过去
     ========================================================= */
  let flightMode = 'visit';       // visit = 带你过去看看；send = 改一棵树的归属

  function closeFlightPanel() {
    $('planePanel').hidden = true;
    $('planeBtn').setAttribute('aria-expanded', 'false');
    $('planeSuggest').hidden = true;
  }
  function openFlightPanel() {
    const wasHidden = $('planePanel').hidden;
    $('planePanel').hidden = false;
    $('planeBtn').setAttribute('aria-expanded', 'true');
    renderTreeOptions();
    updateFlightUI();
    if (wasHidden) setTimeout(() => $('planeDest').focus(), 40);
  }

  function renderTreeOptions() {
    const sel = $('planeTree');
    const prev = sel.value;
    sel.innerHTML = '';
    if (state.pickPlaced) {
      const o = document.createElement('option');
      o.value = '__pending__';
      o.textContent = '刚上传的这张（还没落地）';
      sel.appendChild(o);
    }
    state.trees.forEach((t, i) => {
      const o = document.createElement('option');
      o.value = String(i);
      const place = placeFor(t.lat, t.lon);
      o.textContent = (t.name || (place ? place.title : '一棵树')) + (t.sentTo ? ' · 已在' + t.sentTo : '');
      sel.appendChild(o);
    });
    if (!sel.options.length) {
      const o = document.createElement('option');
      o.value = '';
      o.textContent = '还没有树可寄';
      sel.appendChild(o);
    }
    if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
  }

  function updateFlightUI() {
    const ready = flightReady();
    const badge = $('planeBadge');
    badge.textContent = ready ? '1' : (Math.ceil(Math.max(0, flight.nextAt - Date.now()) / 3600000) + 'h');
    $('planeBtn').classList.toggle('cooling', !ready);

    const c = document.querySelectorAll('.plane-seg');
    c.forEach((b) => b.classList.toggle('on', +b.dataset.reset === flight.cadence));
    const m = document.querySelectorAll('.plane-mode');
    m.forEach((b) => b.classList.toggle('on', b.dataset.mode === flightMode));
    $('planeSend').hidden = flightMode !== 'send';

    $('planeRule').textContent = '每 ' + flight.cadence + ' 小时有一次起飞机会';
    $('planeNote').textContent = flightMode === 'visit'
      ? '只带你过去看看，树不动；落地留一圈痕迹。'
      : '把选中的树改记到那里，来处会留在卡片里。';
    $('planeNext').textContent = ready
      ? (flight.usedAt ? '上次起飞：' + new Date(flight.usedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '还没有起飞过')
      : '下次起飞 · ' + flightRemain() + '后 · 改间隔从下次起飞生效';

    const hasDest = !!resolveDest($('planeDest').value);
    const hasTree = flightMode === 'visit' || !!($('planeTree').value && (state.trees.length || state.pickPlaced));
    $('planeGo').disabled = !ready || !hasDest || !hasTree;
  }

  function renderSuggest(q) {
    const box = $('planeSuggest');
    const list = suggestDest(q);
    box.innerHTML = '';
    if (!list.length) { box.hidden = true; return; }
    list.forEach((d) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.appendChild(document.createTextNode(d.name));
      const s = document.createElement('small');
      s.textContent = fmtLoc(d.lat, d.lon);
      b.appendChild(s);
      b.addEventListener('mousedown', (e) => e.preventDefault()); // 别让输入框先失焦
      b.addEventListener('click', () => {
        $('planeDest').value = d.name;
        box.hidden = true;
        updateFlightUI();
      });
      box.appendChild(b);
    });
    box.hidden = false;
  }

  // 纸飞机划一道弧线过去。尊重「减少动态效果」，那种情况直接落地。
  function animateFlight(done) {
    const layer = $('flyLayer'), plane = $('flyPlane'), trail = $('flyTrail');
    const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { done(); return; }
    layer.hidden = false;
    const W = window.innerWidth, H = window.innerHeight;
    const kf = [
      { transform: 'translate(' + (W * 0.05) + 'px,' + (H * 0.80) + 'px) rotate(-20deg) scale(.82)', opacity: 0, offset: 0 },
      { transform: 'translate(' + (W * 0.16) + 'px,' + (H * 0.73) + 'px) rotate(-15deg) scale(1)', opacity: 1, offset: .12 },
      { transform: 'translate(' + (W * 0.48) + 'px,' + (H * 0.14) + 'px) rotate(9deg) scale(1.12)', opacity: 1, offset: .52 },
      { transform: 'translate(' + (W * 0.80) + 'px,' + (H * 0.27) + 'px) rotate(24deg) scale(1)', opacity: 1, offset: .88 },
      { transform: 'translate(' + (W * 0.91) + 'px,' + (H * 0.34) + 'px) rotate(28deg) scale(.88)', opacity: 0, offset: 1 }
    ];
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      trail.classList.remove('on');
      layer.hidden = true;
      plane.getAnimations().forEach((a) => a.cancel());
      done();
    };
    const anim = plane.animate(kf, { duration: 1900, easing: 'cubic-bezier(.36,.02,.24,1)', fill: 'forwards' });
    anim.onfinish = finish;   // 纸飞机一落地就开始转地球，不再空等
    trail.classList.add('on');
    setTimeout(finish, 2400);  // 兜底：动画事件没来也能收场
  }

  function takeFlight() {
    if (!flightReady()) { $('status').textContent = '还没到起飞时间'; return; }
    const dest = resolveDest($('planeDest').value);
    if (!dest) return;

    let tree = null, index = -1, pending = false, from = null;
    if (flightMode === 'send') {
      const v = $('planeTree').value;
      if (v === '__pending__') { pending = !!state.pickPlaced; tree = state.pickPlaced; }
      else if (v !== '') { index = +v; tree = state.trees[index]; }
      if (!tree) return;
      // 来处优先用树自己的名字，别在卡片里冒出第二个身份
      from = {
        lat: tree.lat, lon: tree.lon,
        name: (tree.name || '').trim() || (placeFor(tree.lat, tree.lon) || {}).title || ''
      };
    }

    // 先消耗机会再飞，避免动画途中重复点
    const now = Date.now();
    flight.usedAt = now;
    flight.nextAt = now + flight.cadence * 3600 * 1000;
    flight.visits.unshift({ lat: dest.lat, lon: dest.lon, name: dest.name, at: now, mode: flightMode });
    flight.visits = flight.visits.slice(0, 48);
    saveFlight();
    updateVisits();
    updateFlightUI();
    closeFlightPanel();
    $('planeDest').value = '';

    animateFlight(() => {
      flyTo(dest.lat, dest.lon, 2.0);
      if (flightMode === 'send' && tree) {
        if (pending) {
          tree.lat = dest.lat; tree.lon = dest.lon;
          state.pickPlaced = null;
          document.body.classList.remove('picking');
          placeTree(tree);
        } else {
          tree.movedFrom = from;
          tree.sentTo = dest.name;
          tree.lat = dest.lat; tree.lon = dest.lon;
          persist();
          buildGroves();
          updatePoints();
          const gi = state.groves.findIndex((g) => g.items.includes(index));
          if (gi >= 0) { state.activeGrove = gi; updatePoints(); updateCard(gi); }
        }
        $('status').textContent = '已把树寄到 ' + dest.name
          + (from && !pending ? '（从 ' + (from.name || fmtLoc(from.lat, from.lon)) + '）' : '');
      } else {
        $('status').textContent = '抵达 ' + dest.name + ' · 这里留了一圈痕迹';
      }
    });
  }

  function initFlight() {
    $('planeBtn').addEventListener('click', () => {
      if ($('planePanel').hidden) openFlightPanel(); else closeFlightPanel();
    });
    $('planeDest').addEventListener('input', function () {
      renderSuggest(this.value);
      updateFlightUI();
    });
    $('planeDest').addEventListener('blur', () => {
      setTimeout(() => { $('planeSuggest').hidden = true; }, 180);
    });
    $('planeDest').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !$('planeGo').disabled) takeFlight();
      if (e.key === 'Escape') closeFlightPanel();
    });
    $('planeTree').addEventListener('change', updateFlightUI);
    $('planeGo').addEventListener('click', takeFlight);
    document.querySelectorAll('.plane-mode').forEach((b) => {
      b.addEventListener('click', () => {
        flightMode = b.dataset.mode;
        renderTreeOptions();
        updateFlightUI();
      });
    });
    document.querySelectorAll('.plane-seg').forEach((b) => {
      b.addEventListener('click', () => {
        flight.cadence = +b.dataset.reset;  // 只影响下一次起飞
        saveFlight();
        updateFlightUI();
      });
    });
    document.addEventListener('pointerdown', (e) => {
      const panel = $('planePanel');
      if (panel.hidden) return;
      if (panel.contains(e.target) || $('planeBtn').contains(e.target)) return;
      closeFlightPanel();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeFlightPanel();
    });
    // 倒计时每分钟刷一次，面板关着也刷角标
    setInterval(updateFlightUI, 60000);
    updateFlightUI();
  }

  /* =========================================================
     14. UI
     ========================================================= */
  function initUI() {
    $('pickBtn').addEventListener('click', () => $('fileImg').click());
    $('fileImg').addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) handleFile(e.target.files[0]);
      e.target.value = '';
    });

    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => {
      e.preventDefault();
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f && /^image\//.test(f.type)) handleFile(f);
    });

    $('locSearch').addEventListener('input', function () {
      const c = lookupCity(this.value);
      $('locHint').textContent = c ? ('转到：' + fmtLoc(c[0], c[1])) : '';
      $('locGo').disabled = !c;
    });
    $('locGo').addEventListener('click', () => {
      const c = lookupCity($('locSearch').value);
      if (!c) return;
      flyTo(c[0], c[1]);
      $('locSearch').value = '';
      $('locHint').textContent = '';
      $('locGo').disabled = true;
    });

    $('cardClose').addEventListener('click', () => {
      state.activeGrove = -1;
      updatePoints();
      $('cardGrove').hidden = true;
      $('card').classList.remove('open');
    });

    // 位置不对：手填地名或坐标，改这一棵树的归属（EXAMPLE 示例也能改）
    function activeTree() {
      const g = state.groves[state.activeGrove];
      return g ? state.trees[g.items[g.items.length - 1]] : null;
    }
    // 卡片改位置：地名或 "13.75,100.50" 都认；返回 [lat, lon]
    function cardLocValue(q) {
      const d = resolveDest(q);
      return d ? [d.lat, d.lon] : null;
    }
    const locInput = $('cardLocInput');
    $('cardLocFix').addEventListener('click', () => {
      $('cardLocEdit').hidden = false;
      $('cardLocHint').textContent = '填地名（如 曼谷 / Bangkok / 清迈）或 纬度,经度';
      locInput.value = '';
      locInput.focus();
    });
    $('cardLocCancel').addEventListener('click', () => { $('cardLocEdit').hidden = true; });
    locInput.addEventListener('input', function () {
      const q = this.value.trim();
      // 地名联想：直接列出候选，点一下就填好
      const sug = suggestDest(q);
      const hint = $('cardLocHint');
      if (!q) { hint.textContent = '填地名（如 曼谷 / Bangkok）或 纬度,经度'; return; }
      const c = cardLocValue(this.value);
      hint.textContent = c ? ('可改到：' + fmtLoc(c[0], c[1]))
        : (sug.length ? ('也许：' + sug.map((s) => s.name).join(' / ')) : '没找到这个地名，可直接填 13.75,100.50');
    });
    function saveCardLoc() {
      const t = activeTree();
      if (!t) return;
      const c = cardLocValue(locInput.value);
      if (!c) { $('cardLocHint').textContent = '没认出来 · 试试 "曼谷" 或 "13.75,100.50"'; return; }
      const from = { lat: t.lat, lon: t.lon, name: t.name || '' };
      t.lat = c[0]; t.lon = c[1];
      t.locSource = 'manual';
      t.movedFrom = from;              // 留住来处，不假装本来就长在这
      persist();
      buildGroves();
      state.activeGrove = state.groves.findIndex((g) => g.items.includes(state.trees.indexOf(t)));
      updatePoints();
      updateCard(state.activeGrove);
      flyTo(t.lat, t.lon, 1.4);
      $('status').textContent = '已改到 ' + fmtLoc(c[0], c[1]);
      $('cardLocEdit').hidden = true;
    }
    $('cardLocSave').addEventListener('click', saveCardLoc);
    locInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveCardLoc(); });

    // 卡片是这一丛的入口：原地展开/收起，不新开页面
    $('cardGroveOpen').addEventListener('click', () => {
      const g = state.groves[state.activeGrove];
      if (!g) return;
      const box = $('cardGrove');
      const open = box.hidden;
      box.hidden = !open;
      $('cardGroveOpen').setAttribute('aria-expanded', open ? 'true' : 'false');
      $('cardGroveOpen').textContent = open ? '收起这一丛' : ('看这一丛 · ' + groveTrees(g.n) + ' 棵');
      if (open) drawGroveCard(g);
    });

    $('cardListen').addEventListener('click', () => {
      const g = state.groves[state.activeGrove];
      if (!g) return;
      const tr = state.trees[g.items[g.items.length - 1]];
      const info = placeFor(tr.lat, tr.lon);
      const named = extractTreeSpecies(tr.name) || (info ? info.primary : null);
      const song = songForTree(tr.id);
      const q = new URLSearchParams({
        id: tr.id || '',
        name: (tr.name || '').trim(),
        lat: tr.lat, lon: tr.lon,
        form: formFor(named),
        // 把这一处的记录次数带过去：越密的丛，混响空间越大
        n: String(g.n),
        // 把卡片上显示的曲风带过去，保证点进来听到的就是卡片写的那首
        eng: song.key
      });
      location.href = 'index.html?' + q.toString();
    });

    $('clearBtn').addEventListener('click', () => {
      if (!confirm('清空世界树上的所有标记？')) return;
      state.trees = [];
      persist();
      state.activeGrove = -1;
      buildGroves();
      updatePoints();
      $('card').classList.remove('open');
    });

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointercancel', () => {
      downAt = null;
      renderer.domElement.style.cursor = 'grab';
    });
    renderer.domElement.addEventListener('pointerleave', () => {
      hasPointer = false;   // 指针离开画布，灯回到我所在的位置
      if (!downAt) renderer.domElement.style.cursor = 'grab';
    });

    // 用户缩放过就不再自动设距离，避免抢视角
    renderer.domElement.addEventListener('wheel', () => { userZoomed = true; }, { passive: true });
    renderer.domElement.addEventListener('touchstart', () => { userTouched = true; }, { passive: true });
    renderer.domElement.addEventListener('pointerdown', () => { userTouched = true; });
  }

  /* =========================================================
     15. 尺寸 / 主循环
     ========================================================= */
  let userZoomed = false;
  let userTouched = false;

  function resize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    controls.maxDistance = Math.max(9, fitDistance() * 1.6);
    if (!userZoomed) camera.position.setLength(fitDistance());
    updatePointScale();
  }
  function updatePointScale() {
    // 标记是贴地球面的球冠，尺寸按球面走，不再随视口改点径
  }

  const clock = new THREE.Clock();
  let elapsed = 0;

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(0.05, clock.getDelta());
    elapsed += dt;

    // 相机飞行
    if (camTween) {
      camTween.t = Math.min(1, camTween.t + dt / camTween.dur);
      const k = easeInOut(camTween.t);
      const d = slerpDir(camTween.from, camTween.to, k);
      camera.position.copy(d.multiplyScalar(camTween.dist));
      if (camTween.t >= 1) camTween = null;
    }

    controls.update();

    // 太阳跟着鼠标（在相机更新之后算，射线才是当前视角）
    aimSun(dt);
    haloMat.uniforms.uDist.value = camera.position.length();

    renderer.render(scene, camera);
  }

  /* =========================================================
     16. 启动
     ========================================================= */
  seedTrees();
  buildGroves();
  updatePoints();
  updateVisits();
  initUI();
  initFlight();
  resize();
  updatePointScale();
  window.addEventListener('resize', resize);

  // 开场：先按时区朝向访问者半球（零网络），IP 返回后再轻推一次
  const startLat = viewer.lat, startLon = viewer.lon;
  const startDist = camera.position.length();
  camera.position.copy(llToVec3(startLat, startLon, startDist));
  camera.lookAt(0, 0, 0);
  controls.update();

  resolveViewer().then((v) => {
    if (!v) return;
    // IP 拿到了：主光方向改成我真的所在位置
    viewer.lat = v.lat; viewer.lon = v.lon;
    if (v.source === 'ip' && !userTouched) {
      if (Math.abs(v.lat - startLat) > 1 || Math.abs(v.lon - startLon) > 1) {
        flyTo(v.lat, v.lon, 1.4);
      }
    }
  }).catch(() => {});

  // 从树页「放回地球」过来：接住那棵树（放在开场朝向之后，避免抢镜头）
  (function takePending() {
    let rec = null;
    try {
      const raw = localStorage.getItem('world3d.pending');
      if (!raw) return;
      localStorage.removeItem('world3d.pending');
      rec = JSON.parse(raw);
    } catch (e) { return; }
    if (!rec || !rec.id) return;

    const exist = state.trees.findIndex((t) => t.id === rec.id);
    if (exist >= 0) {
      const gi = state.groves.findIndex((g) => g.items.includes(exist));
      state.activeGrove = gi;
      updatePoints();
      if (gi >= 0) { updateCard(gi); flyTo(rec.lat, rec.lon, 1.2); }
      return;
    }
    if (rec.lat != null && rec.lon != null) {
      placeTree(rec);
      flyTo(rec.lat, rec.lon, 1.4);
      $('status').textContent = '已落回地球：' + (rec.name || '一棵树');
    } else {
      rec.lat = viewer.lat; rec.lon = viewer.lon;
      state.pickPlaced = rec;
      document.body.classList.add('picking');
      $('status').textContent = '这张照片没有位置：点地球放下，或用小飞机寄到一座城';
    }
  })();

  animate();

  // 调试钩子
  window.__world3d = {
    state, placeTree, flyTo, updatePoints, camera, THREE,
    llToVec3, marksObj, visitObj, palette: paletteKey, PALETTES,
    buildGroves, updateCard, drawGroveCard,
    groveStage, groveTrees,
    // 小飞机调试口
    flight, takeFlight, updateVisits, updateFlightUI,
    openFlightPanel, closeFlightPanel, resolveDest, suggestDest,
    get flightMode() { return flightMode; },
    set flightMode(v) { flightMode = v; }
  };
})();
