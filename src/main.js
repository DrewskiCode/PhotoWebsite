import '@fontsource/instrument-serif/latin-400.css';
import '@fontsource/instrument-sans/latin-400.css';
import '@fontsource/instrument-sans/latin-500.css';
import '@fontsource/geist-mono/latin-400.css';
import './style.css';
import { createGallery } from './gallery/engine.js';
import { ROOMS, PHOTOS, AWARDS, ABOUT, CONTACT, SITE, FILMS } from './gallery/content.js';
import exif from './gallery/exif.json';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const html = document.documentElement;
const coarse = matchMedia('(pointer: coarse)').matches;
const mobile = coarse && Math.min(screen.width, screen.height) < 900;
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
html.classList.toggle('touch', coarse);
const roomInfo = Object.fromEntries(ROOMS.map((r) => [r.id, r]));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const camera = (id) => { const e = exif[id]; return e ? [e.body, e.mm, e.f, e.t, e.iso].filter(Boolean).join(' · ') : ''; };

let gallery = null, inGallery = false, savedScroll = 0;
const canvas = $('#gl'), sheet = $('#sheet'), hero = $('.hero');

// ---------------------------------------------------------------- sheets
const sheets = {
  contact: () => `
    <h2>${esc(CONTACT.head)}</h2>
    <p>${esc(CONTACT.sub)}</p>
    <form class="form" action="${SITE.formspree}" method="POST">
      <label>Name<input name="name" required autocomplete="name"></label>
      <label>Email<input name="email" type="email" required autocomplete="email"></label>
      <label class="wide">Message<textarea name="message" rows="4" required></textarea></label>
      <button class="btn primary" type="submit"><span>Send inquiry</span></button>
      <p class="form-note" role="status"></p>
    </form>
    <p class="links"><button class="quiet" data-copy="${SITE.email}">${SITE.email}</button>
      <a class="quiet" href="${SITE.instagram}" target="_blank" rel="noopener">Instagram</a>
      <a class="quiet" href="${SITE.youtube}" target="_blank" rel="noopener">YouTube</a></p>`,
  about: () => `
    <h2>${esc(ABOUT.name)}</h2>
    <p>${esc(ABOUT.bio)}</p>
    <ul>${ABOUT.capabilities.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
    <blockquote><p>${esc(ABOUT.quote)}</p><cite>${esc(ABOUT.quoteBy)}</cite></blockquote>
    <p><button class="btn primary" data-act="contact"><span>Get in touch</span></button></p>`,
  awards: () => `
    <h2>Accolades</h2>
    <ol class="awards">${AWARDS.map(([y, n, w]) => `<li><span class="year">${esc(y)}</span><span class="name">${esc(n)}</span><span class="what">${esc(w)}</span></li>`).join('')}</ol>`,
  film: (f) => `
    <div class="video"><iframe src="https://www.youtube-nocookie.com/embed/${f.yt}?autoplay=1&rel=0" title="${esc(f.title)}"
      allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>
    <h2>${esc(f.title)}</h2><p>${esc(f.kind)}</p>`,
};
function openSheet(kind, data) {
  if (!sheets[kind]) return;
  sheet.className = kind;
  $('.sheet-body', sheet).innerHTML = sheets[kind](data);
  if (!sheet.open) sheet.showModal();
  gallery?.enable(false);
  gallery?.unlock();
}
sheet.addEventListener('close', () => { $('.sheet-body', sheet).innerHTML = ''; gallery?.enable(inGallery); if (inGallery) gallery.lock(); });
sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.close(); });
document.addEventListener('submit', async (e) => {
  const form = e.target.closest('form.form');
  if (!form) return;
  e.preventDefault();
  const note = $('.form-note', form), btn = $('button[type=submit]', form);
  btn.disabled = true; note.textContent = 'Sending';
  try {
    const res = await fetch(form.action, { method: 'POST', body: new FormData(form), headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error();
    form.reset(); note.textContent = 'Sent. Thank you, I will be in touch';
  } catch {
    note.textContent = `That did not send. Email ${SITE.email} instead`;
  }
  btn.disabled = false;
});

// ---------------------------------------------------------------- site <-> gallery
const shutter = async (fn) => {          // a blink of the shutter covers every cut between the two
  html.classList.add('shut');
  await wait(still ? 0 : 240);
  fn();
  await wait(60);
  html.classList.remove('shut');
};
function goFullscreen() {
  if (document.fullscreenElement || !html.requestFullscreen) return;
  try { html.requestFullscreen({ navigationUI: 'hide' })?.catch?.(() => {}); } catch { /* not allowed here (iPhone): carry on windowed */ }
}
async function walk(room) {
  if (inGallery || html.classList.contains('nogl')) return;
  if (!gallery) {                         // still opening: say so on the choice, then carry on
    html.classList.add('opening');
    await ready;
    html.classList.remove('opening');
    if (!gallery) return;
  }
  savedScroll = scrollY;
  if (room) gallery.spawn(room);
  await shutter(() => {
    inGallery = true;
    html.classList.add('in-gallery');
    scrollTo(0, 0);
    gallery.enable(true);
    gallery.lock();                       // the view follows the mouse from here; Esc gives the cursor back
    canvas.focus({ preventScroll: true });
    showRoom(gallery.player.room);
    html.classList.add('howto');
    setTimeout(() => html.classList.remove('howto'), 8000);
  });
}
function leave() {
  if (!inGallery) return;
  shutter(() => {
    inGallery = false;
    gallery.unfocus();
    gallery.unlock();
    if (document.fullscreenElement) document.exitFullscreen?.().catch?.(() => {});
    gallery.enable(false);
    html.classList.remove('in-gallery', 'menu-open');
    $('#menu').hidden = true;
    gallery.spawn('atrium');
    scrollTo(0, savedScroll);
    layoutScale();
  });
}

// ---------------------------------------------------------------- gallery HUD
const brackets = $$('#brackets i'), prompt = $('#prompt'), caption = $('#caption'), roomname = $('#roomname');
let roomTimer = 0;
function showRoom(id) {
  const r = roomInfo[id];
  if (!r || !inGallery) return;
  roomname.textContent = r.title;
  roomname.classList.add('show');
  clearTimeout(roomTimer);
  roomTimer = setTimeout(() => roomname.classList.remove('show'), 2600);
  $$('#menu [data-room]').forEach((el) => el.classList.toggle('here', el.dataset.room === id));
}
function setTarget(t) {
  html.classList.toggle('has-target', !!t);
  prompt.hidden = !t;
  if (!t) return;
  $('span', prompt).textContent = t.verb;
  const pad = t.verb === 'Step back' ? 14 : 10;
  const [x0, y0, x1, y1] = [Math.max(8, t.rect[0] - pad), Math.max(8, t.rect[1] - pad), Math.min(innerWidth - 8, t.rect[2] + pad), Math.min(innerHeight - 8, t.rect[3] + pad)];
  [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].forEach(([x, y], i) => { brackets[i].style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`; });
  html.classList.remove('howto');
}
function setFocus(q) {
  caption.hidden = !q;
  html.classList.toggle('inspecting', !!q);
  if (!q) return;
  const p = PHOTOS[q.id] || { title: q.id, series: '' };
  $('strong', caption).textContent = p.title;
  $('.kind', caption).textContent = p.series;
  $('.exif', caption).textContent = camera(q.id);
}
function buildMenu(layout) {
  const xs = layout.rooms.flatMap((r) => r.poly.map((p) => p[0])), zs = layout.rooms.flatMap((r) => r.poly.map((p) => p[1]));
  const x0 = Math.min(...xs) - 1, x1 = Math.max(...xs) + 1, z0 = Math.min(...zs) - 1, z1 = Math.max(...zs) + 1;
  $('#menu .plan').innerHTML = `<svg viewBox="${x0} ${z0} ${x1 - x0} ${z1 - z0}" role="img" aria-label="Plan of the gallery">` +
    layout.rooms.map((r) => `<polygon data-room="${r.id}" points="${r.poly.map((p) => p.join(',')).join(' ')}"><title>${esc(roomInfo[r.id].title)}</title></polygon>`).join('') +
    '<path class="me" d="M0,-2.4 L1.4,1.3 L0,0.5 L-1.4,1.3Z"/></svg>';
  $('#menu .rooms').innerHTML = ROOMS.map((r) => `<li><button data-room="${r.id}">${esc(r.title)}</button></li>`).join('');
  const me = $('#menu .me');
  return (pl) => { if (html.classList.contains('menu-open')) me.setAttribute('transform', `translate(${pl.pos[0].toFixed(2)} ${pl.pos[1].toFixed(2)}) rotate(${(-pl.yaw * 180 / Math.PI).toFixed(1)})`); };
}
function toggleMenu(on = $('#menu').hidden) {
  $('#menu').hidden = !on;
  html.classList.toggle('menu-open', on);
  $('.menu-btn').setAttribute('aria-expanded', on);
  if (inGallery) { if (on) gallery?.unlock(); else gallery?.lock(); }
  gallery?.player && updateMe?.(gallery.player);
}
let updateMe = null;

document.addEventListener('click', (e) => {
  const filmLink = e.target.closest('a[data-film]');
  if (filmLink && !e.metaKey && !e.ctrlKey) { e.preventDefault(); return openSheet('film', FILMS.find((f) => f.id === filmLink.dataset.film)); }
  const copy = e.target.closest('[data-copy]');
  if (copy) { navigator.clipboard?.writeText(copy.dataset.copy).then(() => { copy.classList.add('copied'); setTimeout(() => copy.classList.remove('copied'), 1600); }); return; }
  const el = e.target.closest('[data-act], #menu [data-room]');
  if (!el) return;
  const act = el.dataset.act;
  if (!act && el.dataset.room) { gallery?.goRoom(el.dataset.room); return toggleMenu(false); }
  if (act === 'walk') { gallery?.lock(); goFullscreen(); walk(el.dataset.room); }   // both must be asked for inside the click
  else if (act === 'leave') leave();
  else if (act === 'menu') toggleMenu();
  else if (act === 'close') sheet.close();
  else if (act === 'use') gallery?.use();
  else { toggleMenu(false); openSheet(act); }
});
addEventListener('keydown', (e) => { if (e.key === 'Escape' && html.classList.contains('menu-open')) toggleMenu(false); });

// ---------------------------------------------------------------- the landing: the portrait leans a little with the pointer
let heroRaf = 0;
hero.addEventListener('pointermove', (e) => {
  if (coarse || still) return;
  cancelAnimationFrame(heroRaf);
  heroRaf = requestAnimationFrame(() => {
    hero.style.setProperty('--px', (e.clientX / innerWidth - 0.5).toFixed(3));
    hero.style.setProperty('--py', (e.clientY / innerHeight - 0.5).toFixed(3));
  });
});

// ---------------------------------------------------------------- prints: one light, moved by the pointer
const lit = new Set();
const seen = new IntersectionObserver((es) => es.forEach((en) => { en.isIntersecting ? lit.add(en.target) : lit.delete(en.target); }), { rootMargin: '80px' });
$$('.print, .depth').forEach((el) => seen.observe(el));
let lightRaf = 0, lightAt = [innerWidth / 2, innerHeight * 0.35];
const relight = () => {
  cancelAnimationFrame(lightRaf);
  lightRaf = requestAnimationFrame(() => {
    for (const el of lit) {
      const r = el.getBoundingClientRect();
      const lx = Math.max(-1, Math.min(1, (lightAt[0] - (r.left + r.width / 2)) / (innerWidth * 0.5)));
      const ly = Math.max(-1, Math.min(1, (lightAt[1] - (r.top + r.height / 2)) / (innerHeight * 0.6)));
      el.style.setProperty('--lx', lx.toFixed(3));
      el.style.setProperty('--ly', ly.toFixed(3));
      if (el.classList.contains('depth')) {       // the subject slides against its frame, snapped to device pixels so it stays sharp
        const dpr = devicePixelRatio || 1;
        el.style.setProperty('--cx', `${Math.round(lx * -9 * dpr) / dpr}px`);
        el.style.setProperty('--cy', `${Math.round(ly * -5 * dpr) / dpr}px`);
      }
    }
  });
};
if (!coarse) addEventListener('pointermove', (e) => { if (!inGallery) { lightAt = [e.clientX, e.clientY]; relight(); } }, { passive: true });

// ---------------------------------------------------------------- the scrollbar: a lens focus scale
const scale = $('#scale'), tape = $('.tape', scale);
const K = 6;                                  // page pixels per pixel of tape
let marks = [];
function layoutScale() {
  marks = [{ label: 'Top', y: 0 }, ...$$('[data-scale]').map((el) => ({ label: el.dataset.scale, y: el.offsetTop, id: el.id }))];
  tape.style.height = `${document.documentElement.scrollHeight / K}px`;
  tape.innerHTML = marks.map((m) => `<button tabindex="-1" data-y="${m.y}" style="top:${m.y / K}px">${esc(m.label)}</button>`).join('');
  onScroll();
}
function onScroll() {
  if (inGallery) return;
  const y = scrollY;
  tape.style.transform = `translateY(${(scale.clientHeight / 2 - y / K).toFixed(1)}px)`;
  let cur = 0;
  marks.forEach((m, i) => { if (y >= m.y - innerHeight * 0.4) cur = i; });
  [...tape.children].forEach((b, i) => b.classList.toggle('on', i === cur));
  html.classList.toggle('scrolled', y > 24);
  if (coarse) { lightAt = [innerWidth / 2, innerHeight * 0.3]; }
  relight();
}
addEventListener('scroll', onScroll, { passive: true });
addEventListener('resize', layoutScale);
new ResizeObserver(layoutScale).observe($('#site'));
tape.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) scrollTo({ top: +b.dataset.y, behavior: still ? 'auto' : 'smooth' }); });
let grab = null;                               // turn the ring to scroll
scale.addEventListener('pointerdown', (e) => { grab = { y: e.clientY, s: scrollY, moved: false }; scale.setPointerCapture(e.pointerId); });
scale.addEventListener('pointermove', (e) => { if (grab && Math.abs(e.clientY - grab.y) > 3) { grab.moved = true; scrollTo(0, grab.s - (e.clientY - grab.y) * K); } });
scale.addEventListener('pointerup', (e) => { if (grab && !grab.moved) { const b = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.tape button'); if (b) scrollTo({ top: +b.dataset.y, behavior: still ? 'auto' : 'smooth' }); } grab = null; });

// ---------------------------------------------------------------- boot
async function boot() {
  const stick = $('#stick');
  try {
    gallery = await createGallery(canvas, {
      mobile,
      events: {
        room: showRoom,
        focus: setFocus,
        open: openSheet,
        target: setTarget,
        key: (code) => { if (code === 'KeyM' || code === 'Tab') toggleMenu(); },
        frame: (pl) => updateMe?.(pl),
        stick: (x, y, ox, oy, on) => {
          stick.hidden = !on;
          if (on) { stick.style.transform = `translate(${x}px, ${y}px)`; stick.firstElementChild.style.transform = `translate(${ox}px, ${oy}px)`; }
        },
      },
    });
  } catch (err) {
    console.warn(err);
    html.classList.add('nogl');           // no WebGL: the site still works, the walk is simply not offered
    return;
  }
  if (import.meta.env.DEV) window.__gallery = gallery;
  updateMe = buildMenu(gallery.layout);
  gallery.start();                        // idles until entered: it only draws when something changes
  html.classList.add('ready');
}
// The landing page comes first. The gallery opens quietly in the background once the page is idle,
// so "Walk the gallery" is instant by the time anyone has read the two choices.
const ready = new Promise((done) => {
  const go = () => boot().then(done, done);
  if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 1200 }); else setTimeout(go, 300);
});
if (location.hash === '#walk') walk();
layoutScale();
