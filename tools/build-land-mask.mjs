/* 生成陆地掩膜：TopoJSON(world-atlas land-50m) → 等经纬灰度 PNG
 * 源：Natural Earth 1:50m land，经 world-atlas 打成 TopoJSON
 *   https://registry.npmmirror.com/world-atlas/-/world-atlas-2.0.2.tgz
 * 用法：node tools/build-land-mask.mjs /path/to/land-50m.json
 * 产物：data/land-mask-4k.png（4096×2048）、data/land-mask-2k.png（2048×1024）
 * 约定：u = (lon+180)/360，v 由 three 的 SphereGeometry 取 1-v，
 *       所以图上必须是「北在上、西在左」的标准等经纬投影。
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const SRC = process.argv[2];
if (!SRC) { console.error('need topojson path'); process.exit(1); }

const topo = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const { scale: [sx, sy], translate: [tx, ty] } = topo.transform;

// ---- TopoJSON 弧解码 ----
const arcs = topo.arcs.map((arc) => {
  let x = 0, y = 0;
  return arc.map(([dx, dy]) => {
    x += dx; y += dy;
    return [x * sx + tx, y * sy + ty];
  });
});

function ringFromArcs(idxList) {
  const out = [];
  for (const i of idxList) {
    const arc = i < 0 ? arcs[~i].slice().reverse() : arcs[i];
    // 相邻弧首尾相接，去掉重复点
    for (let k = out.length ? 1 : 0; k < arc.length; k++) out.push(arc[k]);
  }
  return out;
}

// ---- 收集所有环（奇偶填充，孔洞自动成立）----
const rings = [];
const geom = topo.objects.land;
const geoms = geom.type === 'GeometryCollection' ? geom.geometries : [geom];
for (const g of geoms) {
  const polys = g.type === 'MultiPolygon' ? g.arcs : [g.arcs];
  for (const poly of polys) for (const r of poly) rings.push(ringFromArcs(r));
}

console.log('rings', rings.length, 'points', rings.reduce((a, r) => a + r.length, 0));

// ---- 栅格化：2× 超采样后缩小，得到反锯齿 ----
const W = 4096, H = 2048, SS = 2;
const SW = W * SS, SH = H * SS;
const hi = new Uint8Array(SW * SH);

// 行桶：把边的行覆盖范围压到具体行，避免 全边×全行
const rowXs = Array.from({ length: SH }, () => []);

// 半平面裁剪（Sutherland–Hodgman）：keep x >= bound 或 x <= bound
function clipX(poly, bound, keepGreater) {
  const out = [];
  const inside = (p) => keepGreater ? p.x >= bound : p.x <= bound;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i];
    const ia = inside(a), ib = inside(b);
    if (ia) out.push(a);
    if (ia !== ib) {
      const t = (bound - a.x) / (b.x - a.x);
      out.push({ x: bound, y: a.y + t * (b.y - a.y) });
    }
  }
  return out;
}

for (const ring of rings) {
  // 经度解缠：跨 ±180° 的环（弗兰格尔岛、斐济、南极）不能直接按直线栅格化，
  // 否则会画出一条横贯全图的假线。解缠后按 ±180 窗口裁剪成闭合多边形。
  const xs = new Float64Array(ring.length);
  xs[0] = ring[0][0];
  for (let i = 1; i < ring.length; i++) {
    let d = ring[i][0] - ring[i - 1][0];
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    xs[i] = xs[i - 1] + d;
  }

  for (const shift of [-360, 0, 360]) {
    let poly = ring.map((p, i) => ({ x: xs[i] + shift, y: p[1] }));
    poly = clipX(poly, -180, true);
    poly = clipX(poly, 180, false);
    if (poly.length < 3) continue;

    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xa = (poly[j].x + 180) / 360 * SW;
      const ya = (90 - poly[j].y) / 180 * SH;
      const xb = (poly[i].x + 180) / 360 * SW;
      const yb = (90 - poly[i].y) / 180 * SH;
      if (ya === yb) continue;
      const y0 = Math.max(0, Math.floor(Math.min(ya, yb) - 0.5));
      const y1 = Math.min(SH - 1, Math.ceil(Math.max(ya, yb) + 0.5));
      for (let y = y0; y <= y1; y++) {
        const yc = y + 0.5;
        if ((ya > yc) === (yb > yc)) continue;
        rowXs[y].push(xa + (yc - ya) * (xb - xa) / (yb - ya));
      }
    }
  }
}

for (let y = 0; y < SH; y++) {
  const xs = rowXs[y];
  if (!xs.length) continue;
  xs.sort((a, b) => a - b);
  const base = y * SW;
  for (let k = 0; k + 1 < xs.length; k += 2) {
    const a = Math.max(0, Math.round(xs[k]));
    const b = Math.min(SW, Math.round(xs[k + 1]));
    for (let x = a; x < b; x++) hi[base + x] = 255;
  }
  rowXs[y] = null;
}

// ---- 缩小 ----
function down(src, sw, sh, factor) {
  const w = sw / factor, h = sh / factor;
  const out = new Uint8Array(w * h);
  const n = factor * factor;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = 0; dy < factor; dy++) {
        const row = (y * factor + dy) * sw + x * factor;
        for (let dx = 0; dx < factor; dx++) s += src[row + dx];
      }
      out[y * w + x] = Math.round(s / n);
    }
  }
  return out;
}

const mask4k = down(hi, SW, SH, 2);
const mask2k = down(mask4k, W, H, 2);

// 南极极冠：Natural Earth 的南极多边形在 -85 附近收口，投影下会缺一块。
// 对每一列，若最南的陆地已越过 -60°，就把它补到 -90。
function fillPolarCap(pix, w, h) {
  for (let x = 0; x < w; x++) {
    let yMax = -1;
    for (let y = h - 1; y >= 0; y--) if (pix[y * w + x] > 128) { yMax = y; break; }
    if (yMax < 0) continue;
    if (90 - (yMax + 0.5) / h * 180 >= -60) continue;
    for (let y = yMax + 1; y < h; y++) pix[y * w + x] = 255;
  }
}
fillPolarCap(mask4k, W, H);
fillPolarCap(mask2k, W / 2, H / 2);

// ---- PNG（灰度 8bit，无滤波）----
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function grayPng(pix, w, h) {
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w + 1)] = 0;
    Buffer.from(pix.buffer, y * w, w).copy(raw, y * (w + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = path.resolve('data');
fs.writeFileSync(path.join(outDir, 'land-mask-4k.png'), grayPng(mask4k, W, H));
fs.writeFileSync(path.join(outDir, 'land-mask-2k.png'), grayPng(mask2k, W / 2, H / 2));
console.log('written', fs.statSync(path.join(outDir, 'land-mask-4k.png')).size,
  fs.statSync(path.join(outDir, 'land-mask-2k.png')).size);
