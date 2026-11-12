# Drewski Photos

Two ways through the same work:

- **The site** — a calm landing page that offers the two ways in (walk, or scroll),
  then a scrolling page on graphite: prints that catch one moving light, and
  "depth prints" whose subject is cut free of its own frame. The cut-outs use the
  photograph's own pixels with only a mask added, so colour and sharpness are untouched.
- **The gallery** — a first-person walk through a daylit building. One lap around a
  glass courtyard, eight rooms. Walk up to a print and press `E` to inspect it.

```
After hours ──── After the line ──── The moment
     │               (infield)            │
  Class of                          On your marks
     │                                    │
Motion pictures ── Accolades ──────── Entrance
```

## Run it

```bash
npm install
npm run dev
```

`npm run build` writes the site to `dist/`.

## Change the words

Everything written on the walls, every photo title, the films, awards, bio and
contact copy live in **`src/gallery/content.js`**. Edit, save, done — no rebuild
of the 3D building needed.

## Change the photos

Originals live in `photos/` (`sports/`, `grads/`, `site/`). To swap an image keep
the same file name and run:

```bash
npm run assets
```

That writes three sizes of every photo plus the thumbnail atlas to
`public/gallery/`. Where each photo hangs (which wall, how big) is set in
`tools/build_gallery.py` — search for `hang(`.

## Change the building

The architecture, the hang and the lighting come from one Blender script,
`tools/build_gallery.py` (needs Blender 4.2+; tested on 5.2):

```bash
npm run layout   # geometry + photo positions only, seconds
npm run bake     # full rebuild: path-traced lightmap, a few minutes on a GPU
```

It writes `public/gallery/world.bin` (geometry), `public/gallery/lightmap-*.webp`
(baked sun, sky and spotlights) and `src/gallery/layout.json` (photo anchors,
collision, rooms).

## How it stays fast

- No 3D framework: a small WebGL2 renderer, about 25 KB of JavaScript gzipped.
- Lighting is baked into one lightmap, so there are no real-time lights or
  shadows to compute. A 1024px lightmap shows first, the sharp one swaps in.
- Photos stream by distance: a single thumbnail atlas covers the whole building
  on first paint; full prints load for the room you are in and sharpen again
  when you step up to one.
- Frames are only drawn when something changes, and resolution adapts on slow
  GPUs.
- The scrolling site is real HTML generated at build time, so search engines,
  screen readers and browsers without WebGL get everything; the walk is an extra.

## Controls in the gallery

| | Desktop | Touch |
|---|---|---|
| Look | move the mouse (the gallery opens fullscreen and captures the pointer; `Esc` frees it, a click takes it back) | drag |
| Walk | `W A S D` / arrows, `Shift` to run, scroll wheel | left thumb |
| Inspect what the brackets are on | `E` or click (again to step back) | tap the prompt, or the print |
| Next / previous print while inspecting | `←` `→` | — |
| Go there | click the floor | tap the floor |
| Jump to a room | `M` for the menu, or `0`–`8` | Menu |

## Design direction

The look was reworked with [unslop](https://github.com/heydamir/unslop) by Damir
Sokolovsky ([@heydamir](https://x.com/heydamir), CC BY 4.0): quiet chrome, one
accent (the clay of a running track), sentence case, and the richness kept for
the photographs. Character: sun-struck, exact, a little cinematic. Signature:
viewfinder brackets. Captions show the real camera data stored in each file.
The one deliberate departure from unslop is depth and pointer-driven light on
the prints, which this site wants.

Cut-outs for the depth prints come from Apple's Vision framework
(`tools/cutout.swift`, macOS 14+ with Xcode): `node tools/build_assets.mjs cutouts`.
Camera data: `node tools/build_assets.mjs exif`.
