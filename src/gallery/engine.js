// The gallery renderer: loads the baked building, streams photos by distance,
// draws it with a planar floor reflection, and handles picking / focus.
import layout from './layout.json';
import thumbs from './thumbs.json';
import * as S from './shaders.js';
import { program, texFromBitmap, loadBitmap, perspective, basis, view, mul, planes, boxVisible } from './gl.js';
import { Player, Input, yawTo } from './player.js';
import { paintLabel, paintScreen } from './labels.js';
import { FILMS } from './content.js';

const BASE = import.meta.env.BASE_URL + 'gallery/';
const LM_RANGE = 4.0;
const SUN_COL = [14.5, 13.4, 11.8], SKY_COL = [1.5, 1.9, 2.6];
const GROUND = new Set(['floor', 'floor_dark', 'grass', 'path', 'plaza']);

// detail = [r, g, b channel weights, amplitude], scale = texture repeats per metre
const MAT = {
  plaster: { det: [0, 1, 0, 0.05], scale: 0.7 },
  ceiling: { det: [0, 1, 0, 0.03], scale: 0.7 },
  concrete: { det: [0.4, 0, 0.6, 0.15], scale: 0.3 },
  floor: { det: [1, 0, 0, 0.2], scale: 0.21, gloss: 0.9 },
  floor_dark: { det: [1, 0, 0, 0.25], scale: 0.21, gloss: 1.0 },
  dark: { det: [0, 1, 0, 0.12], scale: 0.7 },
  steel: { det: [1, 0, 0, 0.2], scale: 0.8 },
  oak: { det: [0, 0, 1, 0.42], scale: 0.7 },
  grass: { det: [0.3, 0.7, 0, 0.5], scale: 1.3 },
  path: { det: [1, 0, 0, 0.2], scale: 0.3 },
  plaza: { det: [1, 0, 0, 0.18], scale: 0.3 },
  lane: { det: [1, 0, 0, 0.08], scale: 0.9, albedo: [0.58, 0.07, 0.03] },
  baton: { det: [0, 0, 0, 0], scale: 1, sun: 0.22, albedo: [0.58, 0.07, 0.03] },
  leaf: { det: [0, 0, 0, 0], scale: 1, sun: 0.6 },
  line: { det: [1, 0, 0, 0.08], scale: 0.9 },
};
// how far the eye opens up in each room (auto-exposure target)
const EXPOSURE = { atrium: 0.62, track: 1.0, rotunda: 1.25, north: 0.74, dark: 1.2, grads: 1.1, screening: 1.7, awards: 1.2, court: 0.42 };

export async function createGallery(canvas, { mobile = false, onProgress = () => {}, events = {} } = {}) {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance', stencil: false, desynchronized: true });
  if (!gl) throw new Error('WebGL2 unavailable');
  gl._aniso = gl.getExtension('EXT_texture_filter_anisotropic');
  gl._anisoMax = gl._aniso ? gl.getParameter(gl._aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : 0;

  const P = {
    surface: program(gl, S.WORLD_VS, S.SURFACE_FS),
    unlit: program(gl, S.WORLD_VS, S.UNLIT_FS),
    sky: program(gl, S.SKY_VS, S.SKY_FS),
    photo: program(gl, S.QUAD_VS, S.PHOTO_FS),
    label: program(gl, S.QUAD_VS, S.LABEL_FS),
    glass: program(gl, S.GLASS_VS, S.GLASS_FS),
  };

  // ---- assets needed for the first frame, in parallel
  let got = 0;
  const step = (p) => p.then((v) => { onProgress(++got / 4); return v; });
  const [worldBuf, lmLow, detailBmp, thumbBmp] = await Promise.all([
    step(fetch(BASE + 'world.bin').then((r) => r.arrayBuffer())),
    step(loadBitmap(BASE + 'lightmap-1024.webp')),
    step(loadBitmap(BASE + 'detail.webp')),
    step(loadBitmap(BASE + 'thumbs.webp')),
  ]);

  // ---- geometry
  const head = (() => {
    const n = new DataView(worldBuf).getUint32(0, true);
    return { n, json: JSON.parse(new TextDecoder().decode(new Uint8Array(worldBuf, 4, n))) };
  })();
  const Q = 1 / head.json.q;
  const pad4 = (n) => (n + 3) & ~3;
  let off = 4 + head.n;
  const groups = [];
  for (const g of head.json.groups) {
    const pos = new Int16Array(worldBuf, off, g.verts * 3); off += pad4(g.verts * 6);
    let uv = null;
    if (g.lm) { uv = new Uint16Array(worldBuf, off, g.verts * 2); off += pad4(g.verts * 4); }
    const idx = new Uint32Array(worldBuf, off, g.tris * 3); off += g.tris * 12;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.SHORT, false, 0, 0);
    if (uv) {
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 2, gl.UNSIGNED_SHORT, true, 0, 0);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (let i = 0; i < pos.length; i += 3) for (let c = 0; c < 3; c++) {
      const v = pos[i + c] * Q;
      if (v < mn[c]) mn[c] = v;
      if (v > mx[c]) mx[c] = v;
    }
    const m = g.key.match(/^(decal:|unlit:)?([^|]+)\|(.+)$/);
    const kind = m[1] ? m[1].slice(0, -1) : 'baked', room = m[2], mat = m[3];
    groups.push({
      vao, count: idx.length, mn, mx, kind, room, mat, albedo: MAT[mat]?.albedo || layout.mats[mat], cfg: MAT[mat] || { det: [0, 0, 0, 0], scale: 1 },
      ground: GROUND.has(mat), cen: [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2],
      outdoor: room === 'ext' || room === 'court', twoSided: mat.startsWith('leaf'),
    });
  }
  gl.bindVertexArray(null);

  // unit quad + fullscreen triangle
  const quad = gl.createVertexArray();
  gl.bindVertexArray(quad);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const tri = gl.createVertexArray();
  gl.bindVertexArray(tri);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  // glass
  const glassVao = gl.createVertexArray();
  const gv = [];
  for (const g of layout.glass) { const q = g.q; for (const i of [0, 1, 2, 0, 2, 3]) gv.push(...q[i]); }
  gl.bindVertexArray(glassVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(gv), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  // ---- textures
  let lmTex = texFromBitmap(gl, lmLow);
  const detailTex = texFromBitmap(gl, detailBmp, { mips: true, repeat: true, aniso: 8 });
  const thumbTex = texFromBitmap(gl, thumbBmp, { mips: false });
  const black = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, black);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
  const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  const lmHi = mobile || maxTex < 4096 || (navigator.deviceMemory && navigator.deviceMemory < 4) ? 2048 : 4096;
  loadBitmap(`${BASE}lightmap-${lmHi}.webp`).then((bmp) => {
    const old = lmTex;
    lmTex = texFromBitmap(gl, bmp);
    gl.deleteTexture(old);
    bmp.close?.();
    dirty = true;
  }).catch(() => loadBitmap(`${BASE}lightmap-2048.webp`).then((bmp) => { lmTex = texFromBitmap(gl, bmp); dirty = true; }));

  // ---- quads: photos, film screens, wall graphics
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const mkQuad = (q) => {
    const rt = cross([0, 1, 0], q.n);
    return { ...q, rt: rt.map((v) => v * q.w), up: [0, q.h, 0], rdir: rt };
  };
  const tw = 1 / thumbs.cols, th = 1 / thumbs.rows, inset = 0.5 / 160;
  const photos = layout.photos.map((p, i) => {
    const k = thumbs.map[p.id];
    return {
      ...mkQuad(p), index: i, tex: thumbTex, size: 0, loading: 0,
      uv: [(k % thumbs.cols + inset) * tw, (Math.floor(k / thumbs.cols) + inset) * th, tw * (1 - 2 * inset), th * (1 - 2 * inset)],
    };
  });
  const screens = layout.screens.map((s) => ({ ...mkQuad(s), tex: null, film: FILMS.find((f) => f.id === s.id) }));
  const labels = layout.labels.map((l) => ({ ...mkQuad(l), tex: null }));
  const FULL = [0, 0, 1, 1];

  // ---- state
  const player = new Player(layout);
  player.instant = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sun = layout.sun;
  let W = 1, H = 1, dpr = 1, scale = 1, dirty = true, running = false, exposure = 1, focus = null, hoverId = null;
  let fov = (mobile ? 74 : 68) * Math.PI / 180;
  const proj = new Float32Array(16), vw = new Float32Array(16), vp = new Float32Array(16), vpR = new Float32Array(16);
  let refl = null, kick = 0, fovNow = fov, target = null, lastTarget = '';
  const nudge = [0, 0];

  function resize() {
    const cw = canvas.clientWidth || innerWidth, ch = canvas.clientHeight || innerHeight;
    dpr = Math.min(devicePixelRatio || 1, mobile ? 2 : 2) * scale;
    const w = Math.max(2, Math.round(cw * dpr)), h = Math.max(2, Math.round(ch * dpr));
    if (w === W && h === H) return;
    W = canvas.width = w; H = canvas.height = h;
    fov = (cw < ch ? 82 : mobile ? 72 : 68) * Math.PI / 180;
    // reflection target (half res)
    const rw = Math.max(2, Math.round(w * (mobile ? 0.4 : 0.5))), rh = Math.max(2, Math.round(h * (mobile ? 0.4 : 0.5)));
    if (refl) { gl.deleteTexture(refl.tex); gl.deleteRenderbuffer(refl.rb); gl.deleteFramebuffer(refl.fb); }
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, rw, rh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const rb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, rw, rh);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    refl = { tex, rb, fb, w: rw, h: rh };
    dirty = true;
  }

  const bindTex = (unit, tex) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); };

  function drawScene(VP, eye, cam, flip, pass) {
    const isRefl = pass === 'refl';
    const pl = planes(VP);
    gl.frontFace(flip < 0 ? gl.CW : gl.CCW);
    gl.enable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    // sky
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    let p = P.sky;
    gl.useProgram(p.p);
    gl.uniform3fv(p.u.uF, cam.f); gl.uniform3fv(p.u.uR, cam.r); gl.uniform3fv(p.u.uU, cam.u);
    gl.uniform2f(p.u.uTan, Math.tan(fovNow / 2) * (W / H), Math.tan(fovNow / 2));
    gl.uniform3fv(p.u.uSun, sun); gl.uniform3fv(p.u.uCam, eye);
    gl.uniform3f(p.u.uGround, 1.84, 1.8, 1.72);
    gl.uniform1f(p.u.uFlip, flip); gl.uniform1f(p.u.uExposure, exposure);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(tri);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.CULL_FACE);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);

    // baked surfaces, near to far
    p = P.surface;
    gl.useProgram(p.p);
    gl.uniformMatrix4fv(p.u.uVP, false, VP);
    gl.uniform1f(p.u.uQ, Q); gl.uniform1f(p.u.uExposure, exposure); gl.uniform1f(p.u.uLmRange, LM_RANGE);
    gl.uniform3fv(p.u.uCam, eye);
    gl.uniform2f(p.u.uInvRes, 1 / W, 1 / H);
    gl.uniform1i(p.u.uLm, 0); gl.uniform1i(p.u.uDetail, 1); gl.uniform1i(p.u.uRefl, 2);
    bindTex(0, lmTex); bindTex(1, detailTex); bindTex(2, isRefl ? black : refl.tex);
    const vis = [];
    for (const g of groups) {
      if (isRefl && (g.ground || g.kind === 'decal')) continue;
      if (!boxVisible(pl, g.mn, g.mx)) continue;
      g.d = (g.cen[0] - eye[0]) ** 2 + (g.cen[2] - eye[2]) ** 2;
      vis.push(g);
    }
    vis.sort((a, b) => a.d - b.d);
    const surf = (g) => {
      gl.uniform3fv(p.u.uAlbedo, g.albedo);
      gl.uniform4fv(p.u.uDet, g.cfg.det);
      gl.uniform1f(p.u.uScale, g.cfg.scale);
      gl.uniform1f(p.u.uGloss, isRefl ? 0 : g.cfg.gloss || 0);
      gl.bindVertexArray(g.vao);
      gl.drawElements(gl.TRIANGLES, g.count, gl.UNSIGNED_INT, 0);
    };
    for (const g of vis) if (g.kind === 'baked') surf(g);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(-2, -2);
    for (const g of vis) if (g.kind === 'decal') surf(g);
    gl.disable(gl.POLYGON_OFFSET_FILL);

    // unbaked props
    p = P.unlit;
    gl.useProgram(p.p);
    gl.uniformMatrix4fv(p.u.uVP, false, VP);
    gl.uniform1f(p.u.uQ, Q); gl.uniform1f(p.u.uExposure, exposure); gl.uniform1f(p.u.uFlip, flip);
    gl.uniform3fv(p.u.uSun, sun);
    gl.uniform3fv(p.u.uSunCol, SUN_COL);
    for (const g of vis) {
      if (g.kind !== 'unlit') continue;
      gl.uniform3fv(p.u.uAlbedo, g.albedo);
      gl.uniform1f(p.u.uSunAmt, g.outdoor ? (g.cfg.sun ?? 1) : 0);
      const k = g.outdoor ? 1 : 0.3;
      gl.uniform3f(p.u.uSkyCol, SKY_COL[0] * k, SKY_COL[1] * k, SKY_COL[2] * k);
      if (g.twoSided) gl.disable(gl.CULL_FACE);
      gl.bindVertexArray(g.vao);
      gl.drawElements(gl.TRIANGLES, g.count, gl.UNSIGNED_INT, 0);
      if (g.twoSided) gl.enable(gl.CULL_FACE);
    }

    // photos + screens
    p = P.photo;
    gl.useProgram(p.p);
    gl.uniformMatrix4fv(p.u.uVP, false, VP);
    gl.uniform1i(p.u.uTex, 0);
    gl.bindVertexArray(quad);
    const drawQuad = (q, uv) => {
      gl.uniform3fv(p.u.uO, q.p); gl.uniform3fv(p.u.uRt, q.rt); gl.uniform3fv(p.u.uUp, q.up);
      gl.uniform4fv(p.u.uUV, uv);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };
    for (const q of photos) {
      const d = (q.p[0] - eye[0]) * q.n[0] + (q.p[2] - eye[2]) * q.n[2];
      if (d > 0) continue;                                   // behind its wall
      bindTex(0, q.tex);
      gl.uniform1f(p.u.uBright, q.id === hoverId ? 1.06 : 0.985);
      drawQuad(q, q.tex === thumbTex ? q.uv : FULL);
    }
    for (const q of screens) {
      if (!q.tex) continue;
      bindTex(0, q.tex);
      gl.uniform1f(p.u.uBright, q.id === hoverId ? 1.12 : 0.95);
      drawQuad(q, FULL);
    }

    // wall graphics
    p = P.label;
    gl.useProgram(p.p);
    gl.uniformMatrix4fv(p.u.uVP, false, VP);
    gl.uniform1i(p.u.uTex, 0); gl.uniform1i(p.u.uLm, 1);
    gl.uniform1f(p.u.uExposure, exposure); gl.uniform1f(p.u.uLmRange, LM_RANGE);
    bindTex(1, lmTex);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    for (const q of labels) {
      if (!q.tex) continue;
      const d = (q.p[0] - eye[0]) * q.n[0] + (q.p[2] - eye[2]) * q.n[2];
      if (d > 0) continue;
      bindTex(0, q.tex);
      gl.uniform1f(p.u.uGlow, q.uv ? (q.glow ? 0.8 / exposure : 0) : 0.85 / exposure);
      if (q.uv) gl.uniform2fv(p.u.uLmUV, q.uv.flat());
      drawQuad(q, FULL);
    }

    // glass
    p = P.glass;
    gl.useProgram(p.p);
    gl.uniformMatrix4fv(p.u.uVP, false, VP);
    gl.uniform3fv(p.u.uCam, eye); gl.uniform1f(p.u.uFlip, flip); gl.uniform1f(p.u.uExposure, exposure);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(glassVao);
    gl.drawArrays(gl.TRIANGLES, 0, gv.length / 3);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  function render() {
    const eye = [player.pos[0], player.eye, player.pos[1]];
    const cam = basis(player.yaw + nudge[0], player.pitch + nudge[1]);
    kick += (Math.min(1, Math.max(0, (player.speed || 0) - 6) / 11) * 0.13 - kick) * 0.12;      // a little speed in the lens
    fovNow = fov + kick;
    perspective(proj, fovNow, W / H, 0.07, 500);
    // mirrored pass for the floor
    mul(vpR, proj, view(vw, eye, cam, true));
    gl.bindFramebuffer(gl.FRAMEBUFFER, refl.fb);
    gl.viewport(0, 0, refl.w, refl.h);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    drawScene(vpR, eye, cam, -1, 'refl');
    gl.bindTexture(gl.TEXTURE_2D, refl.tex);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    mul(vp, proj, view(vw, eye, cam, false));
    drawScene(vp, eye, cam, 1, 'main');
  }

  // ---- photo streaming: thumbnails everywhere, sharper prints where you are
  const TIERS = mobile ? [640, 1024] : [1024, 2048];
  let loads = 0, lastStream = 0;
  function stream(now) {
    if (now - lastStream < 250) return;
    lastStream = now;
    const scored = [];
    for (const q of photos) {
      const d = Math.hypot(q.p[0] - player.pos[0], q.p[2] - player.pos[1]);
      const same = q.room === player.room;
      let want = 0;
      if (focus === q) want = TIERS[1];
      else if (d < (same ? 34 : 16)) want = TIERS[0];
      q.d = d;
      if (want > q.size && !q.loading) scored.push([want === TIERS[1] ? -1 : d, q, want]);
    }
    scored.sort((a, b) => a[0] - b[0]);
    for (const [, q, want] of scored) {
      if (loads >= 3) break;
      loads++; q.loading = want;
      loadBitmap(`${BASE}p/${q.id}-${want}.webp`).then((bmp) => {
        const t = texFromBitmap(gl, bmp, { mips: true, aniso: 8 });
        bmp.close?.();
        if (q.tex !== thumbTex) gl.deleteTexture(q.tex);
        q.tex = t; q.size = want;
      }).catch(() => {}).finally(() => { loads--; q.loading = 0; dirty = true; });
    }
    // free far prints
    const held = photos.filter((q) => q.size && q !== focus).sort((a, b) => b.d - a.d);
    const budget = mobile ? 14 : 30;
    for (let i = 0; held.length - i > budget; i++) {
      const q = held[i];
      if (q.d < 30) break;
      gl.deleteTexture(q.tex); q.tex = thumbTex; q.size = 0;
    }
  }

  // ---- wall graphics & screens are painted lazily, one per frame
  const paintQueue = [];
  let fontsReady = false;
  const canvasTex = (cv) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.generateMipmap(gl.TEXTURE_2D);
    if (gl._aniso) gl.texParameterf(gl.TEXTURE_2D, gl._aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl._anisoMax));
    return t;
  };
  function queuePaint() {
    fontsReady = true;
    for (const l of labels) if (!l.ghost) paintQueue.push(() => { l.tex = canvasTex(paintLabel(l, mobile)); });
    for (const s of screens) paintQueue.push(() => { s.tex = canvasTex(paintScreen(s.film)); });
    paintQueue.sort(() => 0);
    dirty = true;
  }
  Promise.all(['400 40px "Instrument Serif"', '400 20px "Instrument Sans"', '500 20px "Instrument Sans"', '400 20px "Geist Mono"']
    .map((f) => document.fonts.load(f))).then(queuePaint, queuePaint);

  // film stills arrive from YouTube only once you are near the screening room
  let stills = false;
  function loadStills() {
    stills = true;
    for (const sc of screens) {
      // sddefault always exists (4:3 with bars; the painter crops it back to 16:9)
      loadBitmap(`https://i.ytimg.com/vi/${sc.film.yt}/sddefault.jpg`).then((bmp) => {
        if (bmp.width < 200) return;
        paintQueue.push(() => { const old = sc.tex; sc.tex = canvasTex(paintScreen(sc.film, bmp)); if (old) gl.deleteTexture(old); bmp.close?.(); });
      }).catch(() => {});
    }
  }

  // ---- picking
  function ray(px, py) {
    const r = canvas.getBoundingClientRect();
    const nx = px === null ? 0 : ((px - r.left) / r.width) * 2 - 1, ny = px === null ? 0 : 1 - ((py - r.top) / r.height) * 2;
    const cam = basis(player.yaw, player.pitch);
    const tx = Math.tan(fovNow / 2) * (W / H) * nx, ty = Math.tan(fovNow / 2) * ny;
    const d = [cam.f[0] + cam.r[0] * tx + cam.u[0] * ty, cam.f[1] + cam.r[1] * tx + cam.u[1] * ty, cam.f[2] + cam.r[2] * tx + cam.u[2] * ty];
    const l = Math.hypot(...d);
    return { o: [player.pos[0], player.eye, player.pos[1]], d: d.map((v) => v / l) };
  }
  function hitQuad(r, q) {
    const den = r.d[0] * q.n[0] + r.d[1] * q.n[1] + r.d[2] * q.n[2];
    if (den > -1e-5) return null;
    const t = ((q.p[0] - r.o[0]) * q.n[0] + (q.p[1] - r.o[1]) * q.n[1] + (q.p[2] - r.o[2]) * q.n[2]) / den;
    if (t <= 0) return null;
    const hx = r.o[0] + r.d[0] * t - q.p[0], hy = r.o[1] + r.d[1] * t - q.p[1], hz = r.o[2] + r.d[2] * t - q.p[2];
    const a = hx * q.rdir[0] + hz * q.rdir[2];
    return Math.abs(a) <= q.w / 2 && Math.abs(hy) <= q.h / 2 ? t : null;
  }
  function pick(px, py) {
    const r = ray(px, py);
    let best = null;
    const consider = (list, type) => {
      for (const q of list) {
        if (type === 'label' && !q.action) continue;
        const t = hitQuad(r, q);
        if (t !== null && (!best || t < best.t)) best = { t, type, q };
      }
    };
    consider(photos, 'photo'); consider(screens, 'screen'); consider(labels, 'label');
    if (best) {
      const hit = [r.o[0] + r.d[0] * best.t - best.q.n[0] * 0.2 * -1, r.o[2] + r.d[2] * best.t - best.q.n[2] * 0.2 * -1];
      if (player.blocked(player.pos, hit, false)) best = null;
    }
    if (best) return best;
    if (r.d[1] < -0.02) {
      const t = -r.o[1] / r.d[1];
      if (t < 90) return { t, type: 'floor', point: [r.o[0] + r.d[0] * t, r.o[2] + r.d[2] * t] };
    }
    return null;
  }

  // ---- focus: stand in front of a print
  function standPoint(q) {
    const aspect = W / H, tv = Math.tan(fov / 2), thz = tv * aspect;
    let dist = Math.max(q.w / 2 / thz, q.h / 2 / tv) * 1.2 + 0.25;
    const lim = player.rayDist([q.p[0] + q.n[0] * 0.3, q.p[2] + q.n[2] * 0.3], [q.n[0], q.n[2]], 30) - 0.3;
    dist = Math.max(1.3, Math.min(dist, lim));
    return { pt: [q.p[0] + q.n[0] * dist, q.p[2] + q.n[2] * dist], dist };
  }
  function focusOn(q, fast = false) {
    if (!q) { if (focus) { focus = null; player.lift = 0; events.focus?.(null); dirty = true; } return; }
    const { pt, dist } = standPoint(q);
    focus = q;
    events.focus?.(q);
    player.lift = q.p[1] - 1.66;
    player.go(pt, { room: q.room, yaw: yawTo(-q.n[0], -q.n[2]), pitch: 0, speed: fast ? 30 : 17 });
    dirty = true;
  }
  const stepFocus = (dir) => {
    let i = focus ? focus.index : -1;
    if (!focus) {
      let bd = 1e9;
      photos.forEach((q) => { const d = Math.hypot(q.p[0] - player.pos[0], q.p[2] - player.pos[1]) + (q.room === player.room ? 0 : 50); if (d < bd) { bd = d; i = q.index - (dir > 0 ? 1 : 0); } });
    }
    focusOn(photos[(i + dir + photos.length) % photos.length]);
  };

  // ---- what the viewfinder is on: the nearest thing you are facing
  const VERB = { photo: 'Inspect', screen: 'Play', contact: 'Get in touch', about: 'About Drew', awards: 'Read the list' };
  function findTarget() {
    if (focus) return { q: focus, type: 'photo', verb: 'Step back' };
    if (player.travel) return null;
    const cam = basis(player.yaw, player.pitch), eye = [player.pos[0], player.eye, player.pos[1]];
    let best = null;
    const scan = (list, type) => {
      for (const q of list) {
        if (type === 'label' && !q.action) continue;
        if (q.room !== player.room) continue;
        const v = [q.p[0] - eye[0], q.p[1] - eye[1], q.p[2] - eye[2]], d = Math.hypot(...v);
        if (d > 8 || d < 0.4) continue;
        if (-(v[0] * q.n[0] + v[2] * q.n[2]) / d < 0.25) continue;                 // seen too edge-on, or from behind
        const c = (v[0] * cam.f[0] + v[1] * cam.f[1] + v[2] * cam.f[2]) / d;
        if (c < (d < 4.5 ? 0.72 : 0.84)) continue;                                   // close up, anything roughly ahead counts
        const score = c - d * 0.02 + (type === 'label' ? 0.004 : 0);
        if (!best || score > best.score) best = { q, type, score, verb: VERB[type === 'label' ? q.action : type] };
      }
    };
    scan(photos, 'photo'); scan(screens, 'screen'); scan(labels, 'label');
    if (best && player.blocked(player.pos, [best.q.p[0] + best.q.n[0] * 0.25, best.q.p[2] + best.q.n[2] * 0.25], false)) return null;
    return best;
  }
  function screenRect(q) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const [sx, sy] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
      const x = q.p[0] + q.rt[0] * sx, y = q.p[1] + q.up[1] * sy, z = q.p[2] + q.rt[2] * sx;
      const w = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
      if (w < 0.05) return null;
      const px = ((vp[0] * x + vp[4] * y + vp[8] * z + vp[12]) / w * 0.5 + 0.5) * canvas.clientWidth;
      const py = (0.5 - (vp[1] * x + vp[5] * y + vp[9] * z + vp[13]) / w * 0.5) * canvas.clientHeight;
      x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
    }
    return [x0, y0, x1, y1];
  }
  function updateTarget() {
    target = input.enabled ? findTarget() : null;
    const rect = target ? screenRect(target.q) : null;
    const key = target && rect ? target.q.id + target.verb + rect.map((v) => v | 0).join() : '';
    if (key === lastTarget) return;
    lastTarget = key;
    events.target?.(target && rect ? { id: target.q.id, type: target.type, verb: target.verb, rect, q: target.q } : null);
  }
  const touch = matchMedia('(pointer: coarse)').matches;
  function use() {
    if (focus) {
      const q = focus;
      focusOn(null);
      if (touch) {                           // on touch, "Step back" really does: a couple of paces away, still facing the print
        const room = player.rayDist(player.pos, [q.n[0], q.n[2]], 30) - 0.5;
        const d = Math.max(0, Math.min(2.2, room));
        if (d > 0.2) player.go([player.pos[0] + q.n[0] * d, player.pos[1] + q.n[2] * d], { room: player.room, yaw: yawTo(-q.n[0], -q.n[2]), pitch: 0, speed: 4.5 });
      }
      return;
    }
    const t = target || findTarget();
    if (!t) return;
    if (t.type === 'photo') focusOn(t.q);
    else if (t.type === 'screen') events.open?.('film', t.q.film);
    else events.open?.(t.q.action);
  }

  function act(pt) {
    const h = pt === undefined ? null : pick(pt ? pt[0] : null, pt ? pt[1] : null);
    if (!h) return;
    if (h.type === 'photo') return focusOn(h.q);
    if (h.type === 'screen') return events.open?.('film', h.q.film);
    if (h.type === 'label') return events.open?.(h.q.action);
    if (h.type === 'floor') {
      focusOn(null);
      const room = player.roomAt(h.point[0], h.point[1]);
      if (!room) return;
      const direct = room === player.room || !player.blocked(player.pos, h.point);
      player.go(h.point, { room: direct ? player.room : room, speed: 13 });
      events.marker?.(h.point);
    }
  }

  // ---- input
  const input = new Input(canvas, {
    onTap: (pt) => act(pt),
    onKey: (code) => {
      if (code.startsWith('Digit')) { const r = layout.rooms[+code.slice(5)]; if (r) api.goRoom(r.id); }
      else if (code === 'BracketRight' || code === 'KeyN' || code === 'Period') stepFocus(1);
      else if (code === 'BracketLeft' || code === 'KeyP' || code === 'Comma') stepFocus(-1);
      else if (code === 'KeyE' || code === 'Enter') use();
      else if (code === 'Space') { if (focus) stepFocus(1); else use(); }
      else if (focus && code === 'ArrowRight') stepFocus(1);
      else if (focus && code === 'ArrowLeft') stepFocus(-1);
      else if (code === 'Escape') focusOn(null);
      else events.key?.(code);
    },
    onActivity: () => { dirty = true; },
  });
  input.onHover = (x, y) => {
    const h = pick(x, y);
    const id = h && h.type !== 'floor' ? h.q.id : null;
    canvas.style.cursor = id ? 'pointer' : '';
    if (id !== hoverId) { hoverId = id; dirty = true; events.hover?.(h && h.type !== 'floor' ? h : null); }
  };
  input.onStick = (...a) => events.stick?.(...a);

  // ---- loop
  let last = 0, lastRoom = null, slow = 0, fast = 0, frames = 0;
  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    resize();
    const moved = player.update(dt, input.poll());
    if (moved && focus && !player.travel && (input.moveX || input.moveZ)) focusOn(null);
    if (player.room !== lastRoom) { lastRoom = player.room; events.room?.(player.room); }
    const target = EXPOSURE[player.room] || 1;
    if (Math.abs(target - exposure) > 0.003) { exposure += (target - exposure) * (1 - Math.exp(-dt * 2.2)); dirty = true; }
    if (paintQueue.length) { paintQueue.shift()(); dirty = true; }
    if (input.enabled) stream(now);         // prints are only fetched once someone is actually walking
    if (!stills && fontsReady && (player.room === 'screening' || player.room === 'grads' || player.room === 'awards')) loadStills();
    if (!(moved || dirty || input.active || kick > 0.002)) return;
    dirty = false;
    render();
    updateTarget();
    events.frame?.(player);
    // adaptive resolution: stay smooth on weaker GPUs
    frames++;
    if (dt > 0.03) slow++; else if (dt < 0.013) fast++;
    if (frames >= 90) {
      if (slow > 30 && scale > 0.55) { scale = Math.max(0.55, scale * 0.85); W = 0; }
      else if (fast > 85 && scale < 1) { scale = Math.min(1, scale * 1.1); W = 0; }
      frames = slow = fast = 0;
    }
  }

  const api = {
    layout, player, input, photos,
    start() { if (running) return; running = true; last = performance.now(); dirty = true; requestAnimationFrame(frame); },
    stop() { running = false; },
    enable(on) { input.enabled = on; dirty = true; lastTarget = '~'; },
    use,
    lock() { input.lock(); }, unlock() { input.unlock(); },
    nudge(x, y) { if (nudge[0] !== x || nudge[1] !== y) { nudge[0] = x; nudge[1] = y; dirty = true; } },
    goRoom(id) { focusOn(null); player.goRoom(id); dirty = true; },
    spawn(id) { player.spawn(id); dirty = true; },
    focusPhoto(id) { const q = photos.find((p) => p.id === id); if (q) focusOn(q); },
    next() { stepFocus(1); }, prev() { stepFocus(-1); }, unfocus() { focusOn(null); },
    get focus() { return focus; },
    invalidate() { dirty = true; },
  };
  addEventListener('resize', () => { dirty = true; });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { last = performance.now(); dirty = true; } });
  resize();
  player.spawn('atrium');
  render();
  return api;
}
