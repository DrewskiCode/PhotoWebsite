# Technology Stack

## Core Technologies
*   **Logic & Bundling:** `Vite` + Vanilla JavaScript. (Incredibly fast, minimal overhead, perfect for pure frontend sites).
*   **Structure:** Semantic HTML5.
*   **Styling:** Vanilla CSS (`index.css` and scoped files) leveraging modern features (CSS Grid, Flexbox, Custom Properties for the Style Guide variables). No bloated CSS frameworks to ensure maximum performance.

## Image Loading Strategy (Performance Priority)
As requested, ensuring sports images load blazingly fast while looking like a high-end gallery is the top priority.
1.  **Format:** We will deliver images in `.webp` format for a massive file size reduction without quality loss.
2.  **Lazy Loading:** Every gallery image will use the native `loading="lazy"` attribute so the browser only loads images as the user scrolls to them.
3.  **Responsive Images:** Using `<picture>` and `srcset` attributes to deliver smaller images to mobile devices and massive 4K images only to large gallery displays.
4.  **Async Decoding:** Using `decoding="async"` on images to prevent large image decodes from blocking the main thread (keeps scrolling snappy).
5.  **Preload Critical Assets:** The massive Hero image on the home page will be preloaded `<link rel="preload" as="image">` to ensure near-instant first paint.

## UI/UX Animation
*   No heavy JavaScript animation libraries (like GSAP or Framer Motion).
*   All animations (gallery fade-ins, B&W to color snaps, ghost button hovers) will be handled entirely via **Hardware-Accelerated CSS Transitions** (`transform` and `opacity`) to maintain the "athletic snappiness" outined in the Style Guide.
