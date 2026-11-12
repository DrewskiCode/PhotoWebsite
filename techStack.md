# Technology Stack

- **Build:** Vite + vanilla JavaScript. No framework and no 3D library.
- **Rendering:** a small hand-written WebGL2 renderer (`src/gallery/`), about
  25 KB of JavaScript gzipped.
- **Lighting:** baked. `tools/build_gallery.py` builds the architecture in
  Blender, path-traces sun, sky and gallery spotlights into a single lightmap,
  and exports geometry + layout. Nothing is lit in real time; the polished
  floors use one mirrored render pass for reflections.
- **Images:** `tools/build_assets.mjs` (sharp) writes WebP at 640 / 1024 / 2048
  plus one thumbnail atlas. Prints stream in by distance.
- **Fonts:** Montserrat, Bebas Neue and Inter, self-hosted (latin subsets).
- **Fallback:** the same content as static HTML inside `index.html` (`/#plain`).

See `README.md` for the commands.
