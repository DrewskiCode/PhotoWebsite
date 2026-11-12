// What is printed on the gallery's walls. Kept to what a real gallery has:
// one vinyl title per room, a small plaque beside each print, engraved plates
// for the awards. Painted to canvas in centimetres, then lit by the lightmap.
import { ROOMS, AWARDS, FILMS, PHOTOS, SITE } from './content.js';

const INK = '#191817', SOFT = '#6b665f', PALE = '#f2efe9', PALE_SOFT = '#b4afa6';
const SERIF = (s) => `400 ${s}px "Instrument Serif", Georgia, serif`;
const SANS = (w, s) => `${w} ${s}px "Instrument Sans", Helvetica, Arial, sans-serif`;
const MONO = (s) => `400 ${s}px "Geist Mono", ui-monospace, Menlo, monospace`;
const title = (id) => ROOMS.find((r) => r.id === id).title;

function text(c, str, x, y, font, color, align = 'left') {
  c.font = font; c.fillStyle = color; c.textAlign = align; c.textBaseline = 'alphabetic';
  c.fillText(str, x, y);
  return c.measureText(str).width;
}
function fit(c, str, maxW, mk, max) {
  let s = max;
  for (let i = 0; i < 10; i++) {
    c.font = mk(s);
    const w = c.measureText(str).width;
    if (w <= maxW) break;
    s *= Math.max(0.6, (maxW / w) * 0.99);
  }
  return s;
}
function wrap(c, str, x, y, maxW, lh, font, color, maxLines = 9) {
  c.font = font; c.fillStyle = color; c.textAlign = 'left';
  let line = '', n = 0;
  for (const w of str.split(' ')) {
    const t = line ? line + ' ' + w : w;
    if (c.measureText(t).width > maxW && line) { c.fillText(line, x, y + n * lh); n++; line = w; if (n >= maxLines) return n; } else line = t;
  }
  if (line) { c.fillText(line, x, y + n * lh); n++; }
  return n;
}
// vinyl lettering: one line, set like an exhibition title
const vinyl = (id, color = INK) => (c, W, H) => {
  const t = id === 'atrium' ? SITE.name : title(id);
  text(c, t, 0, H * 0.74, SERIF(fit(c, t, W - 2, SERIF, H * 0.84)), color);
};

const PAINT = {
  title: vinyl('atrium'),
  t_track: vinyl('track'), t_rotunda: vinyl('rotunda'), t_north: vinyl('north'), t_dark: vinyl('dark'),
  t_grads: vinyl('grads'), t_films: vinyl('screening', PALE), t_awards: vinyl('awards'),
  bri(c, W, H) { text(c, 'Bri, University of San Diego', 0, H * 0.72, SANS(400, H * 0.52), SOFT); },
  jesse(c, W, H) { text(c, 'Jesse, Chapman University', 0, H * 0.72, SANS(400, H * 0.52), SOFT); },
};

export function paintLabel(l, mobile) {
  const small = l.id.startsWith('cap:') || l.id.startsWith('aw:') || /^film\dcap$/.test(l.id) || l.id === 'bri' || l.id === 'jesse';
  const ppm = small ? (mobile ? 620 : 900) : Math.min(mobile ? 220 : 340, 2048 / Math.max(l.w, l.h));
  const cv = document.createElement('canvas');
  cv.width = Math.round(l.w * ppm); cv.height = Math.round(l.h * ppm);
  const c = cv.getContext('2d');
  c.scale(ppm / 100, ppm / 100);
  const W = l.w * 100, H = l.h * 100;
  if (l.id.startsWith('cap:')) {                       // plaque beside a print
    const p = PHOTOS[l.id.slice(4)] || { title: '', series: '' };
    text(c, p.title, 0, 6.4, SERIF(fit(c, p.title, W - 1, SERIF, 5.6)), l.glow ? PALE : INK);
    text(c, p.series, 0, 11, SANS(400, 2.5), l.glow ? PALE_SOFT : SOFT);
    text(c, 'Drew Floyd', 0, 14.6, SANS(400, 2.2), l.glow ? PALE_SOFT : SOFT);
  } else if (l.id.startsWith('aw:')) {                 // engraved plate
    const [year, name, what] = AWARDS[+l.id.slice(3)];
    c.fillStyle = '#23211f'; c.fillRect(0, 0, W, H);
    c.fillStyle = 'rgba(255,255,255,0.07)'; c.fillRect(0, 0, W, 0.5);
    text(c, year, 4, 7.6, MONO(3), '#a8a196');
    const n = wrap(c, name, 4, 14.4, W - 8, 5.6, SERIF(5.2), PALE, 2);
    wrap(c, what, 4, 15.4 + n * 5.6 + 2.4, W - 8, 3.4, SANS(400, 2.3), '#a8a196', 3);
  } else if (/^film\dcap$/.test(l.id)) {
    const f = FILMS[+l.id[4] - 1];
    text(c, f.title, 0, 8, SERIF(fit(c, f.title, W - 1, SERIF, 7.4)), PALE);
    text(c, f.kind, 0, 14.4, SANS(400, 3.3), PALE_SOFT);
  } else (PAINT[l.id] || (() => {}))(c, W, H);
  return cv;
}

// A film screen: the still fills it, with a quiet play mark
export function paintScreen(film, still) {
  const cv = document.createElement('canvas');
  cv.width = 1024; cv.height = 576;
  const c = cv.getContext('2d');
  c.fillStyle = '#0d0d0e'; c.fillRect(0, 0, 1024, 576);
  if (still) {
    const k = Math.max(1024 / still.width, 576 / still.height);
    c.drawImage(still, (1024 - still.width * k) / 2, (576 - still.height * k) / 2, still.width * k, still.height * k);
    c.fillStyle = 'rgba(10,10,11,0.18)'; c.fillRect(0, 0, 1024, 576);
  } else {
    text(c, film.title, 56, 300, SERIF(fit(c, film.title, 900, SERIF, 76)), PALE);
  }
  c.beginPath(); c.arc(512, 288, 44, 0, Math.PI * 2); c.fillStyle = 'rgba(13,13,14,0.5)'; c.fill();
  c.strokeStyle = PALE; c.lineWidth = 2.5; c.stroke();
  c.beginPath(); c.moveTo(499, 266); c.lineTo(536, 288); c.lineTo(499, 310); c.closePath(); c.fillStyle = PALE; c.fill();
  return cv;
}
