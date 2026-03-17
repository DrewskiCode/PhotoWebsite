# Style Guide: Action & Art (Sports Photography Gallery)

## 1. Core Concept & Aesthetic
The design objective is to fuse the **minimalist, sophisticated atmosphere of a contemporary art gallery** with the **dynamic, high-energy impact of sports photography**. 
- **The Art Gallery:** Extensive use of negative space (whitespace), minimalist UI elements, elegant typography, and zero clutter. The photographs are the undisputed heroes.
- **The Sports Element:** Bold, aggressive accent colors, high-impact headings, and sharp, snappy animations that evoke speed, tension, and athleticism.

---

## 2. Color Palette
To maintain the gallery feel, the core palette is strictly high-contrast monochrome, providing a completely neutral backdrop. The accent color injects the "sports" energy.

### Base Colors (The Gallery)
* **Gallery White:** `#FFFFFF`
  * *Usage:* Primary background. Provides a clean, sterile, high-end "gallery wall" effect.
* **Onyx Black:** `#121212` 
  * *Usage:* Primary text color, heavy borders, and footer background. Delivers maximum contrast.
* **Concrete Gray:** `#F4F4F5`
  * *Usage:* Secondary background for subtle section separation without breaking the clean aesthetic.

### Accent Colors (The Action)
* **Adrenaline Red:** `#E11D48` 
  * *Usage:* Primary accent. Used sparingly for Call-to-Action (CTA) buttons, hover states, and highlighting key active sports moments. Evokes passion, energy, and elevated heart rates.
* **Metallic Silver:** `#A1A1AA`
  * *Usage:* Secondary neutral for photograph metadata, dates, and non-critical UI icons.

---

## 3. Typography
The typography uses a distinct three-font system to balance premium elegance with athletic power.

### Primary Font (Headings/Titles): `Montserrat`
* **Style:** All caps, wide letter-spacing (e.g., `letter-spacing: 0.1em;`), bold weights.
* **Vibe:** Sophisticated, wide, and structurally modern. Perfect for an art gallery ambiance. Use for section titles and the main logo/brand name.

### Accent Font (Numbers/Highlights): `Bebas Neue` (or `Oswald`)
* **Style:** Tall, condensed, and heavy.
* **Vibe:** Athletic. Resembles sports jerseys, stopwatches, and scoreboard stats. Use exclusively for dates, staggering statistics, and short, high-impact words.

### Body Font: `Inter`
* **Style:** Regular/Light weights. Highly legible.
* **Vibe:** Neutral, utilitarian, and clean. Gets out of the way so the user focuses entirely on the photography.

---

## 4. UI Elements & Layout

### The Grid
* **Curated Asymmetry:** Avoid standard, perfectly symmetrical grids. Use masonry layouts or offset grids to make the layout feel curated, premium, and artistic rather than like an automated feed.
* **Massive Whitespace:** Use disproportionately large margins and padding around images to literally "frame" them, mimicking physical artwork hung alone on a massive gallery wall. Give the photos room to breathe.

### Buttons & Inputs
* **Ghost Buttons:** Minimalist buttons with a 1px solid black border and transparent background. On hover, the background fills with **Adrenaline Red** and the text turns bold white.
* **Sharp Corners:** `border-radius: 0px;`. Perfectly suits the modern, architectural gallery feel. Keep all edges unapologetically sharp.

---

## 5. Photography Treatment
* **The "Reveal" Effect (Optional):** Consider treating thumbnail images in a high-contrast Black & White filter via CSS. On hover, the image instantly snaps into full, vibrant color. This establishes the art gallery feel initially, then delivers the punchy sports energy upon user interaction.
* **Full-Bleed Heroes:** Use edge-to-edge, screen-filling background images for hero sections, overlaid with minimal, crisp typography. 

---

## 6. Motion & Animation
* **Gallery Elegance (Page Loads):** Page transitions and image load-ins should use a smooth, slow `fade-in` (duration: `800ms - 1.2s`) to feel premium and deliberate.
* **Athletic Snappiness (Interactions):** Hover effects, button transitions, and UI interactions should be extremely fast and sharp. Use `ease-out` timing functions with short durations (duration: `150ms`) to reflect athletic speed and responsiveness.
