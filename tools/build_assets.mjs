// Builds every image the gallery loads: photo sizes, the thumbnail atlas,
// the detail texture and the encoded lightmaps.
//   node tools/build_assets.mjs [photos] [detail] [lightmap]
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'gallery');
const what = process.argv.slice(2);
const want = (k) => (!what.length && k !== 'cutouts') || what.includes(k);
fs.mkdirSync(path.join(OUT, 'p'), { recursive: true });

const PORTRAIT = new Set(['dsc06236', 'dsc07728', 'bri2', 'bri3']);

async function photos() {
  const layout = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/gallery/layout.json'), 'utf8'));
  const ids = layout.photos.map((p) => p.id);
  const src = {};
  for (const d of ['sports', 'grads', 'site']) {
    for (const f of fs.readdirSync(path.join(ROOT, 'photos', d))) {
      if (/\.jpe?g$/i.test(f)) src[f.replace(/\.[^.]+$/, '').toLowerCase()] = path.join(ROOT, 'photos', d, f);
    }
  }
  const CELL = 160, COLS = 6;
  const comps = [], map = {};
  let bytes = 0;
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (!src[id]) throw new Error('missing photo ' + id);
    const ar = PORTRAIT.has(id) ? 2 / 3 : 3 / 2;
    for (const size of [640, 1024, 2048]) {
      const w = ar > 1 ? size : Math.round(size * ar), h = ar > 1 ? Math.round(size / ar) : size;
      const out = path.join(OUT, 'p', `${id}-${size}.webp`);
      await sharp(src[id]).rotate().resize(w, h, { fit: 'cover' })
        .webp({ quality: size === 2048 ? 82 : 78, effort: 6, smartSubsample: true }).toFile(out);
      bytes += fs.statSync(out).size;
    }
    comps.push({
      input: await sharp(src[id]).rotate().resize(CELL, CELL, { fit: 'fill' }).toBuffer(),
      left: (i % COLS) * CELL, top: Math.floor(i / COLS) * CELL,
    });
    map[id] = i;
  }
  const rows = Math.ceil(ids.length / COLS);
  await sharp({ create: { width: COLS * CELL, height: rows * CELL, channels: 3, background: '#888' } })
    .composite(comps).webp({ quality: 62, effort: 6 }).toFile(path.join(OUT, 'thumbs.webp'));
  fs.writeFileSync(path.join(ROOT, 'src/gallery/thumbs.json'), JSON.stringify({ cols: COLS, rows, map }));
  console.log(`photos: ${ids.length} x3 sizes, ${(bytes / 1e6).toFixed(1)} MB total; thumbs ${(fs.statSync(path.join(OUT, 'thumbs.webp')).size / 1e3) | 0} KB`);
}

// ---- tileable detail texture: R polished concrete, G plaster, B linear grain
function detail() {
  const N = 512;
  const rnd = (seed) => { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };
  function lattice(period, seed) {
    const r = rnd(seed), g = new Float32Array(period * period);
    for (let i = 0; i < g.length; i++) g[i] = r();
    return g;
  }
  function noise(px, py, g, sx, sy = sx) {     // periodic value noise, sx*sy cells
    const out = new Float32Array(N * N);
    for (let y = 0; y < N; y++) {
      const fy = (y / N) * sy, y0 = Math.floor(fy), ty = fy - y0, wy = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < N; x++) {
        const fx = (x / N) * sx, x0 = Math.floor(fx), tx = fx - x0, wx = tx * tx * (3 - 2 * tx);
        const a = g[(y0 % sy) * px + (x0 % sx)], b = g[(y0 % sy) * px + ((x0 + 1) % sx)];
        const c = g[((y0 + 1) % sy) * px + (x0 % sx)], d = g[((y0 + 1) % sy) * px + ((x0 + 1) % sx)];
        out[y * N + x] = a + (b - a) * wx + (c - a) * wy + (a - b - c + d) * wx * wy;
      }
    }
    return out;
  }
  const fbm = (octs, seed, ax = 1) => {
    const out = new Float32Array(N * N);
    let amp = 0;
    octs.forEach(([cells, w], i) => {
      const sx = cells, sy = Math.max(1, Math.round(cells * ax));
      const g = lattice(Math.max(sx, sy), seed + i * 17), n = noise(Math.max(sx, sy), 0, g, sx, sy);
      for (let k = 0; k < out.length; k++) out[k] += (n[k] - 0.5) * w;
      amp += w;
    });
    for (let k = 0; k < out.length; k++) out[k] /= amp;
    return out;
  };
  const conc = fbm([[3, 1], [7, 0.8], [19, 0.5], [61, 0.3], [190, 0.16]], 11);
  const plas = fbm([[9, 0.7], [40, 0.5], [160, 0.4]], 23);
  const grain = fbm([[4, 0.6], [12, 0.6], [48, 0.8], [128, 0.7]], 37, 16);     // stretched: fine across, long along
  const buf = Buffer.alloc(N * N * 3);
  const r = rnd(5);
  for (let k = 0; k < N * N; k++) {
    const y = Math.floor(k / N);
    let c = 0.5 + conc[k] * 1.5;
    if (r() < 0.0016) c -= 0.25 * r();                             // pores
    const board = Math.abs(((y / N) * 8) % 1 - 0.5) > 0.485 ? -0.16 : 0;   // board-form seams, 8 per tile
    buf[k * 3] = Math.max(0, Math.min(255, c * 255));
    buf[k * 3 + 1] = Math.max(0, Math.min(255, (0.5 + plas[k] * 1.1) * 255));
    buf[k * 3 + 2] = Math.max(0, Math.min(255, (0.5 + grain[k] * 1.6 + board) * 255));
  }
  return sharp(buf, { raw: { width: N, height: N, channels: 3 } }).webp({ quality: 80, effort: 6 })
    .toFile(path.join(OUT, 'detail.webp')).then(() => console.log('detail:', (fs.statSync(path.join(OUT, 'detail.webp')).size / 1e3) | 0, 'KB'));
}

// ---- lightmap: linear float (from Blender) -> gamma-encoded 8 bit WebP at three sizes
export const LM_RANGE = 4.0;
async function lightmap() {
  const file = path.join(ROOT, 'tools/out/lightmap.npy');
  const raw = fs.readFileSync(file);
  const hlen = raw.readUInt16LE(8), header = raw.slice(10, 10 + hlen).toString();
  const res = +header.match(/\((\d+),/)[1];
  let f = new Float32Array(raw.buffer, raw.byteOffset + 10 + hlen, res * res * 3);
  const EXPOSURE = +(process.env.LM_EXPOSURE || 2.5);
  const r = (() => { let s = 99; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); })();
  let n = res;
  for (const size of [4096, 2048, 1024]) {
    if (size > res) continue;
    while (n > size) {                                             // 2x2 box filter in linear light
      const h = n / 2, g = new Float32Array(h * h * 3);
      for (let y = 0; y < h; y++) for (let x = 0; x < h; x++) for (let c = 0; c < 3; c++) {
        const i = (y * 2 * n + x * 2) * 3 + c;
        g[(y * h + x) * 3 + c] = (f[i] + f[i + 3] + f[i + n * 3] + f[i + n * 3 + 3]) / 4;
      }
      f = g; n = h;
    }
    const buf = Buffer.alloc(n * n * 3);
    for (let i = 0; i < buf.length; i++) {
      const e = Math.pow(Math.min(1, Math.max(0, f[i] * EXPOSURE / LM_RANGE)), 1 / 2.2);
      buf[i] = Math.max(0, Math.min(255, Math.floor(e * 255 + r())));     // dithered
    }
    const out = path.join(OUT, `lightmap-${size}.webp`);
    await sharp(buf, { raw: { width: n, height: n, channels: 3 } })
      .webp({ quality: size === 1024 ? 80 : 88, effort: 6, smartSubsample: false }).toFile(out);
    console.log(`lightmap-${size}:`, (fs.statSync(out).size / 1e3) | 0, 'KB');
  }
}

// ---- subject cut-outs (Apple Vision, macOS only) for the depth prints on the site
const FEATURED = ['dsc04620', 'dsc00626-2', 'dsc07721', 'hunt', 'bri5'];
async function cutouts() {
  const { execFileSync } = await import('node:child_process');
  const os = await import('node:os');
  const dir = path.join(ROOT, 'public', 'site');
  fs.mkdirSync(dir, { recursive: true });
  const src = {};
  for (const d of ['sports', 'grads', 'site']) for (const f of fs.readdirSync(path.join(ROOT, 'photos', d))) {
    if (/\.jpe?g$/i.test(f)) src[f.replace(/\.[^.]+$/, '').toLowerCase()] = path.join(ROOT, 'photos', d, f);
  }
  const meta = {};
  for (const id of FEATURED) {
    // Vision gives the mask only. Colour comes from the photograph itself, resized exactly like
    // the 2048px print it sits on, so the two layers are the same pixels.
    const tmp = path.join(os.tmpdir(), `mask-${id}.png`);
    execFileSync('swift', [path.join(ROOT, 'tools/cutout.swift'), src[id], tmp, '4096'], { stdio: 'pipe' });
    const W = 2048, H = Math.round(2048 / 1.5);
    // a crisp edge: smooth the mask a touch, then steepen it and pull it in ~1px so no background fringe survives
    const alpha = await sharp(tmp).resize(W, H, { fit: 'cover' }).extractChannel(0).blur(1.0).linear(5, -0.7 * 5 * 255 + 127.5).toColourspace('b-w').raw().toBuffer();
    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (alpha[y * W + x] > 40) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    meta[id] = { w: W, h: H, box: [x0 / W, y0 / H, x1 / W, y1 / H].map((v) => +v.toFixed(3)) };
    const rgb = await sharp(src[id]).rotate().resize(W, H, { fit: 'cover' }).removeAlpha().toColourspace('srgb').raw().toBuffer();
    const rgba = Buffer.alloc(W * H * 4);
    for (let i = 0; i < W * H; i++) { rgba[i * 4] = rgb[i * 3]; rgba[i * 4 + 1] = rgb[i * 3 + 1]; rgba[i * 4 + 2] = rgb[i * 3 + 2]; rgba[i * 4 + 3] = alpha[i]; }
    await sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).webp({ quality: 90, alphaQuality: 100, effort: 6, smartSubsample: true }).toFile(path.join(dir, `cut-${id}.webp`));
  }
  // the photographer: already cut out in the original PNG
  const drew = sharp(path.join(ROOT, 'photos/site/start3.png')).trim({ threshold: 2 });
  const buf = await drew.resize({ height: 1160 }).webp({ quality: 78, alphaQuality: 88, effort: 6 }).toBuffer({ resolveWithObject: true });
  fs.writeFileSync(path.join(dir, 'drew.webp'), buf.data);
  await sharp(buf.data).resize({ height: 760 }).webp({ quality: 80, alphaQuality: 90 }).toFile(path.join(dir, 'drew-760.webp'));
  meta.drew = { w: buf.info.width, h: buf.info.height };
  fs.writeFileSync(path.join(ROOT, 'src/site/cuts.json'), JSON.stringify(meta));
  console.log('cutouts:', Object.keys(meta).join(', '), fs.readdirSync(dir).map((f) => `${f} ${(fs.statSync(path.join(dir, f)).size / 1e3) | 0}KB`).join(' | '));
}

// ---- real camera data from the files themselves
async function exif() {
  const exifr = (await import('exifr')).default;
  const out = {};
  const BODY = { 'ILCE-7SM3': 'Sony A7S III', 'ILCE-7RM5': 'Sony A7R V', 'ILCE-7M4': 'Sony A7 IV', 'ILCE-7M3': 'Sony A7 III', 'ILCE-6400': 'Sony A6400' };
  for (const d of ['sports', 'grads', 'site']) for (const f of fs.readdirSync(path.join(ROOT, 'photos', d))) {
    if (!/\.jpe?g$/i.test(f)) continue;
    let x = null;
    try { x = await exifr.parse(path.join(ROOT, 'photos', d, f), ['Model', 'LensModel', 'FocalLength', 'FNumber', 'ExposureTime', 'ISO']); } catch { /* no metadata */ }
    if (!x || !x.ExposureTime) continue;
    const t = x.ExposureTime >= 1 ? `${+x.ExposureTime.toFixed(1)}s` : `1/${Math.round(1 / x.ExposureTime)}`;
    out[f.replace(/\.[^.]+$/, '').toLowerCase()] = {
      body: BODY[x.Model] || x.Model || '', lens: (x.LensModel || '').replace(/\s*\|.*$/, ''),
      mm: x.FocalLength ? `${Math.round(x.FocalLength)}mm` : '', f: x.FNumber ? `f/${+x.FNumber.toFixed(1)}` : '', t, iso: x.ISO ? `ISO ${x.ISO}` : '',
    };
  }
  fs.writeFileSync(path.join(ROOT, 'src/gallery/exif.json'), JSON.stringify(out));
  console.log('exif:', Object.keys(out).length, 'photos with camera data;', JSON.stringify(Object.values(out)[3]));
}

if (want('cutouts')) await cutouts();
if (want('exif')) await exif();
if (want('photos')) await photos();
if (want('detail')) await detail();
if (want('lightmap')) await lightmap();
