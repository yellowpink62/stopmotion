# Stopmotion — Local

App web 100% local para criar stopmotion (até ~500 fotos). Gera vídeo `.mp4` no navegador via `ffmpeg.wasm`, sem servidor.

**Acesse:** https://yellowpink62.github.io/stopmotion/

## Funcionalidades
- Captura in-app (FHD Vertical 1080×1920 / Horizontal 1920×1080) + import de 500 fotos
- Timeline com colapso e preview em FPS (1, 4, 8, 12, 15, 24, 30)
- Geração local com `ffmpeg.wasm` (libx264, yuv420p) — `FHD/HD vertical/horizontal`
- PWA instalável (standalone) e 100% offline após primeiro acesso

## Rodar local
```bash
npm install
npm run dev        # https://localhost:5173 (câmera)
npm run dev:http   # http://localhost:5173 (só import)
npm run build && npx serve dist -l 5173
```

Câmera exige `https` (smartphones). Import funciona em `http`.
