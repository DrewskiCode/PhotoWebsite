import { defineConfig } from 'vite';
import fs from 'node:fs';
import { ROOMS, PHOTOS, FILMS, AWARDS, ABOUT, CONTACT, SITE } from './src/gallery/content.js';

// The scrolling site is generated from the same content as the gallery and
// baked into index.html, so it is real HTML for search engines, screen
// readers and browsers without WebGL.
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const PORTRAIT = new Set(['dsc06236', 'dsc07728', 'bri2', 'bri3']);
const read = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'));

function site() {
  const layout = read('./src/gallery/layout.json'), exif = read('./src/gallery/exif.json'), cuts = read('./src/site/cuts.json');
  const meta = (id) => { const e = exif[id]; return e ? [e.body, e.mm, e.f, e.t, e.iso].filter(Boolean).join(' · ') : ''; };
  const img = (id, sizes) => {
    const p = PHOTOS[id] || { title: id, series: '' };
    const [w, h] = PORTRAIT.has(id) ? [683, 1024] : [1024, 683];
    return `<img loading="lazy" decoding="async" width="${w}" height="${h}" alt="${esc(p.title)}, ${esc(p.series)}"
      src="/gallery/p/${id}-1024.webp" srcset="/gallery/p/${id}-640.webp 640w, /gallery/p/${id}-1024.webp 1024w, /gallery/p/${id}-2048.webp 2048w" sizes="${sizes}">`;
  };
  const cap = (id) => { const p = PHOTOS[id] || { title: id }; return `<figcaption><span>${esc(p.title)}</span><span class="exif">${esc(meta(id))}</span></figcaption>`; };
  const print = (id) => `<figure class="print" style="--ar:${PORTRAIT.has(id) ? 0.667 : 1.5}"><div class="paper">${img(id, '(max-width: 760px) 92vw, 40vw')}<i class="glare"></i></div>${cap(id)}</figure>`;
  // a print whose subject is cut free of the frame and sits in front of it
  const depth = (id) => {
    const c = cuts[id], [, y0, , y1] = c.box;
    const top = Math.round((y0 + Math.min(0.15 * (y1 - y0), 0.12)) * 1000) / 10;
    return `<figure class="depth" style="--top:${top}%"><div class="stage">
      <div class="back">${img(id, '(max-width: 860px) 92vw, 62vw')}<i class="glare"></i></div>
      <img class="cut" loading="lazy" decoding="async" width="${c.w}" height="${c.h}" alt="" src="/site/cut-${id}.webp"></div>${cap(id)}</figure>`;
  };
  const rooms = ROOMS.filter((r) => layout.photos.some((p) => p.room === r.id) && r.id !== 'atrium');
  const work = rooms.map((r, i) => {
    const ids = layout.photos.filter((p) => p.room === r.id).map((p) => p.id);
    const lead = ids.find((id) => cuts[id]);
    return `<section class="series${i % 2 ? ' flip' : ''}" id="${r.id}" data-scale="${esc(r.title)}">
      <div class="series-head"><h2>${esc(r.title)}</h2><p>${esc(r.note || '')}</p>
        <button class="quiet" data-act="walk" data-room="${r.id}">Walk this room</button></div>
      ${lead ? depth(lead) : ''}
      <div class="wall">${ids.filter((id) => id !== lead).map(print).join('')}</div></section>`;
  }).join('');
  const film = (f) => `<a class="film" href="https://www.youtube.com/watch?v=${f.yt}" data-film="${f.id}" target="_blank" rel="noopener">
      <div class="lcd"><img loading="lazy" decoding="async" width="640" height="360" alt="" src="https://i.ytimg.com/vi/${f.yt}/sddefault.jpg"><i class="play"></i></div>
      <span class="film-title">${esc(f.title)}</span><span class="film-kind">${esc(f.kind)}</span></a>`;
  return `${work}
      <section class="block films" id="films" data-scale="Motion pictures">
        <div class="series-head"><h2>Motion pictures</h2><p>Short films and documentaries</p>
          <button class="quiet" data-act="walk" data-room="screening">Walk this room</button></div>
        <div class="reel">${FILMS.map(film).join('')}</div></section>
      <section class="block" id="awards" data-scale="Accolades">
        <div class="series-head"><h2>Accolades</h2><p>Recognised across photography and short film</p></div>
        <ol class="awards">${AWARDS.map(([y, n, w]) => `<li><span class="year">${esc(y)}</span><span class="name">${esc(n)}</span><span class="what">${esc(w)}</span></li>`).join('')}</ol></section>
      <section class="block about" id="about" data-scale="About">
        <div class="series-head"><h2>${esc(ABOUT.name)}</h2></div>
        <div class="about-body"><p>${esc(ABOUT.bio)}</p>
          <ul>${ABOUT.capabilities.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></div>
        <blockquote><p>${esc(ABOUT.quote)}</p><cite>${esc(ABOUT.quoteBy)}</cite></blockquote></section>
      <section class="block contact" id="contact" data-scale="Contact">
        <div class="series-head"><h2>${esc(CONTACT.head)}</h2><p>${esc(CONTACT.sub)}</p></div>
        <form class="form" action="${SITE.formspree}" method="POST">
          <label>Name<input name="name" required autocomplete="name"></label>
          <label>Email<input name="email" type="email" required autocomplete="email"></label>
          <label class="wide">Message<textarea name="message" rows="5" required></textarea></label>
          <button class="btn primary" type="submit"><span>Send inquiry</span></button><p class="form-note" role="status"></p>
        </form></section>
      <footer class="foot"><span class="mark">Drewski Photos</span>
        <a href="mailto:${SITE.email}">${SITE.email}</a><a href="${SITE.instagram}" rel="noopener">Instagram</a><a href="${SITE.youtube}" rel="noopener">YouTube</a></footer>`;
}

export default defineConfig({
  plugins: [{ name: 'site', transformIndexHtml: (html) => html.replace('<!--SITE-->', site()) }],
  build: { target: 'es2022', assetsInlineLimit: 0 },
});
