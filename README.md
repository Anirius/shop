# ANIRIUS® 2-in-1 – Unboxing

Scroll-driven 3D product page for the ANIRIUS® 2-in-1 Besteckmesser (6er-Set in Geschenkbox).

- **`index.html`** – the complete page in one file (CSS, script, 3D knife, lighting and marble embedded). Open it directly or via GitHub Pages.
- **`shop/box.html`** – the editable page; scripts in `shop/src/` (`box.js` scene and scroll story, `engrave.js` laser-engraving ad), styles in `shop/box.css`.
- **`assets/`** – knife model (`.glb`) and studio lighting (`.hdr`).

## Develop

```bash
npm install
npm run build        # bundles shop/src/box.js -> shop/box.js
npm run standalone   # rebuilds the single-file index.html
```

Serve the folder with any static server and open `shop/box.html` (the 3D files load relative to it).
