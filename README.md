# Stopmotion — Local

100% local web app to create stopmotion. Generates `.mp4` video in the browser via `ffmpeg.wasm`, no server.

**Live:** https://yellowpink62.github.io/stopmotion/

## Features
- In-app capture (FHD Vertical 1080×1920 / Horizontal 1920×1080) + import
- Timeline with collapse and FPS preview (1, 4, 8, 12, 15, 24, 30, 40, 50, 60)
- Local generation with `ffmpeg.wasm` (libx264, yuv420p) — `FHD/HD vertical/horizontal, 4K, Original`
- Installable PWA (standalone) and 100% offline after first load
- Projects (up to 3) saved locally in browser, drag to reorder, duplicate, undo

## Run locally
```bash
npm install
npm run dev        # https://localhost:5173 (camera)
npm run dev:http   # http://localhost:5173 (import only)
npm run build && npx serve dist -l 5173
```

Camera requires `https` (smartphones). Import works on `http`.
