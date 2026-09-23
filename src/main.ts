import './style.css'
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'
import JSZip from 'jszip'

type Frame = { id: string; blob: Blob; url: string; name: string }

let frames: Frame[] = []
let stream: MediaStream | null = null
let facing: 'environment' | 'user' = 'environment'
let ffmpeg: FFmpeg | null = null
let ffmpegLoaded = false
let previewInterval: number | null = null
let isPreviewPlaying = false

const app = document.querySelector<HTMLDivElement>('#app')!

app.innerHTML = `
<header>
  <h1 style="display:flex; align-items:center; gap:8px"><svg class="icon icon-lg" viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="2" y="2" width="20" height="20" rx="2.18"/><path d="M7 2v20"/><path d="M17 2v20"/><path d="M2 12h20"/><path d="M2 7h5"/><path d="M2 17h5"/><path d="M17 17h5"/><path d="M17 7h5"/></svg> Stopmotion <span style="font-weight:400; font-size:12px; color:var(--muted)">100% local</span></h1>
  <span id="counterBadge">0 fotos</span>
</header>
<div class="container">
  <div>
    <div class="card">
      <div class="tabs">
        <button class="tab active" data-tab="camera"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg> Câmera</button>
        <button class="tab" data-tab="import"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-3.5-3.5a2 2 0 0 0-2.8 0L3 21"/></svg> Importar</button>
      </div>

      <div id="panel-camera">
        <div class="camera-wrap" id="cameraWrap">
          <video id="video" autoplay playsinline muted style="display:none"></video>
          <div id="placeholder" class="camera-placeholder">Câmera desligada<br><small>Toque em "Ligar câmera" (precisa HTTPS ou localhost)</small></div>
          <canvas id="captureCanvas" style="display:none"></canvas>
          <div id="gridOverlay" style="position:absolute; inset:0; pointer-events:none; display:none; border:1px solid rgba(255,255,255,.15)">
            <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style="position:absolute; inset:0">
              <line x1="33.3" y1="0" x2="33.3" y2="100" stroke="rgba(255,255,255,.4)" stroke-width="0.5"/>
              <line x1="66.6" y1="0" x2="66.6" y2="100" stroke="rgba(255,255,255,.4)" stroke-width="0.5"/>
              <line x1="0" y1="33.3" x2="100" y2="33.3" stroke="rgba(255,255,255,.4)" stroke-width="0.5"/>
              <line x1="0" y1="66.6" x2="100" y2="66.6" stroke="rgba(255,255,255,.4)" stroke-width="0.5"/>
            </svg>
          </div>
        </div>
        <div class="field" style="margin-top:12px">
          <label>Foto (captura)</label>
          <select id="photoRes">
            <option value="720x1280">720×1280 (HD Vertical)</option>
            <option value="1080x1920" selected>1080×1920 (FHD Vertical)</option>
            <option value="1280x720">1280×720 (HD Horizontal)</option>
            <option value="1920x1080">1920×1080 (FHD Horizontal)</option>
          </select>
        </div>
        <div class="camera-controls">
          <button id="btnStartCam" class="btn btn-ghost"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg> Ligar câmera</button>
          <button id="btnSwitch" class="btn btn-ghost" style="display:none"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg> Trocar</button>
          <button id="btnCapture" class="btn btn-primary" disabled><svg class="icon" viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="12" cy="12" r="8"/></svg> Capturar</button>
        </div>
        <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap">
          <label style="display:flex; align-items:center; gap:6px; font-size:12px; color:var(--muted); cursor:pointer"><input type="checkbox" id="chkGrid" /> Grade</label>
          <label style="display:flex; align-items:center; gap:6px; font-size:12px; color:var(--muted); cursor:pointer"><input type="checkbox" id="chkLockExp" /> Travar exposição</label>
        </div>
        <p style="font-size:11px; color:var(--muted); margin-top:6px">Toque no preview para capturar sem tremer.</p>
        <p id="cameraTip" style="font-size:12px; color:var(--muted); margin-top:8px">Dica: gire o celular na vertical. Fotos já saem em 1080×1920 (FHD vertical).</p>
      </div>

      <div id="panel-import" style="display:none">
        <label class="dropzone" id="dropzone" for="fileInput">
          <div style="line-height:1.4"><strong>Clique ou arraste 500 fotos aqui</strong></div>
          <div style="line-height:1.4; margin-top:6px; font-size:13px">JPG / PNG / HEIC (HEIC será convertido).</div>
          <div style="line-height:1.4; font-size:12px; opacity:.8">Ordenado por nome automaticamente.</div>
        </label>
        <input id="fileInput" type="file" accept="image/*,.heic,.heif" multiple style="display:none" />
        <p id="importTip" style="font-size:11px; color:var(--muted); margin-top:8px; line-height:1.4">Imagens serão redimensionadas para 1080×1920 (vertical) localmente antes de gerar o vídeo.</p>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div style="display:flex; justify-content:space-between; align-items:center">
        <h3 style="font-size:14px">Timeline — <span id="countText">0</span> frames</h3>
        <div style="display:flex; gap:6px">
          <button id="btnToggleTimeline" class="btn btn-ghost" style="padding:6px 10px; font-size:12px"><svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="6 9 12 15 18 9"/></svg> Ocultar</button>
          <button id="btnClear" class="btn btn-danger" style="padding:6px 10px; font-size:12px"><svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> Limpar</button>
        </div>
      </div>
      <div id="timelineCollapsible">
        <div id="timeline" class="timeline" style="margin-top:12px">
          <div style="grid-column:1/-1; text-align:center; color:var(--muted); padding:20px; font-size:13px">Nenhuma foto ainda. Capture ou importe.</div>
        </div>
        <div class="stats">
          <span class="badge" id="statRes">Saída: 1920×1080</span>
          <span class="badge" id="statSize">~0 MB</span>
        </div>
      </div>
    </div>
  </div>

  <div>
    <div class="card" id="previewCard" style="display:none">
      <div style="display:flex; justify-content:space-between; align-items:center">
        <h3 style="font-size:14px">Preview</h3>
        <div style="display:flex; gap:6px">
          <button id="btnPlayPause" class="btn btn-ghost" style="padding:6px 10px; font-size:12px"><svg class="icon icon-sm" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg> Play</button>
          <button id="btnFullscreen" class="btn btn-ghost" style="padding:6px 10px; font-size:12px" title="Tela cheia"><svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg></button>
        </div>
      </div>
      <div class="preview-wrap" id="previewWrap" style="margin-top:10px">
        <video id="outputVideo" controls playsinline style="display:none"></video>
        <canvas id="previewCanvas" style="display:none"></canvas>
        <div id="previewPlaceholder" style="display:flex; align-items:center; justify-content:center; height:100%; color:var(--muted); font-size:13px; position:absolute; inset:0">Preview aqui</div>
      </div>
      <div class="controls-grid" style="grid-template-columns: 1fr 1fr; margin-top:12px">
        <div class="field">
          <label>FPS</label>
          <select id="fps">
            <option value="1">1 fps</option>
            <option value="4">4 fps</option>
            <option value="8">8 fps</option>
            <option value="12">12 fps</option>
            <option value="15">15 fps</option>
            <option value="24" selected>24 fps</option>
            <option value="30">30 fps</option>
          </select>
        </div>
        <div class="field">
          <label>Vídeo (saída)</label>
          <select id="resolution">
            <option value="720x1280">720×1280 (Vertical)</option>
            <option value="1080x1920" selected>1080×1920 (Vertical)</option>
            <option value="1280x720">1280×720 (Horizontal)</option>
            <option value="1920x1080">1920×1080 (Horizontal)</option>
          </select>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <h3 style="font-size:14px">Exportar vídeo</h3>
      <div class="field" style="margin-top:8px">
        <label>Nome do arquivo</label>
        <input id="filename" value="stopmotion-3d.mp4" />
      </div>

      <button id="btnGenerate" class="btn btn-success" style="width:100%; margin-top:14px; padding:14px; font-size:16px" disabled><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 2v4"/><path d="M12 18v4"/><path d="M4.93 4.93l2.83 2.83"/><path d="M16.24 16.24l2.83 2.83"/><path d="M2 12h4"/><path d="M18 12h4"/><path d="M4.93 19.07l2.83-2.83"/><path d="M16.24 7.76l2.83-2.83"/></svg> Gerar vídeo local (.mp4)</button>
      <button id="btnExportZip" class="btn btn-ghost" style="width:100%; margin-top:8px; display:none"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/><path d="M16 8l-8 0"/><path d="M16 12l-8 0"/></svg> Baixar ZIP dos frames</button>
      <div class="progress" id="progressWrap" style="display:none"><i id="progressBar"></i></div>
      <div id="status" style="font-size:12px; color:var(--muted); margin-top:8px; text-align:center">Adicione pelo menos 2 fotos</div>
      <button id="btnDownload" class="btn btn-primary" style="width:100%; margin-top:10px; display:none"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Baixar vídeo</button>

      <div id="log" class="log" style="display:none"></div>
    </div>
  </div>
</div>
`

// --- helpers ---
const video = document.getElementById('video') as HTMLVideoElement
const placeholder = document.getElementById('placeholder') as HTMLDivElement
const captureCanvas = document.getElementById('captureCanvas') as HTMLCanvasElement
const btnStartCam = document.getElementById('btnStartCam') as HTMLButtonElement
const btnSwitch = document.getElementById('btnSwitch') as HTMLButtonElement
const btnCapture = document.getElementById('btnCapture') as HTMLButtonElement
const fileInput = document.getElementById('fileInput') as HTMLInputElement
const dropzone = document.getElementById('dropzone') as HTMLLabelElement
const timeline = document.getElementById('timeline') as HTMLDivElement
const fpsSel = document.getElementById('fps') as HTMLSelectElement
const resSel = document.getElementById('resolution') as HTMLSelectElement
const photoResSel = document.getElementById('photoRes') as HTMLSelectElement
const btnGenerate = document.getElementById('btnGenerate') as HTMLButtonElement
const btnDownload = document.getElementById('btnDownload') as HTMLButtonElement
const btnExportZip = document.getElementById('btnExportZip') as HTMLButtonElement
const outputVideo = document.getElementById('outputVideo') as HTMLVideoElement
const previewCanvas = document.getElementById('previewCanvas') as HTMLCanvasElement
const previewWrap = document.getElementById('previewWrap') as HTMLDivElement
const counterBadge = document.getElementById('counterBadge') as HTMLSpanElement
const countText = document.getElementById('countText') as HTMLSpanElement
const statusEl = document.getElementById('status') as HTMLDivElement
const logEl = document.getElementById('log') as HTMLDivElement
const progressWrap = document.getElementById('progressWrap') as HTMLDivElement
const progressBar = document.getElementById('progressBar') as HTMLElement
const btnClear = document.getElementById('btnClear') as HTMLButtonElement
const btnToggleTimeline = document.getElementById('btnToggleTimeline') as HTMLButtonElement
const timelineCollapsible = document.getElementById('timelineCollapsible') as HTMLDivElement
const previewCard = document.getElementById('previewCard') as HTMLDivElement
const previewPlaceholder = document.getElementById('previewPlaceholder') as HTMLDivElement
const chkGrid = document.getElementById('chkGrid') as HTMLInputElement
const chkLockExp = document.getElementById('chkLockExp') as HTMLInputElement
const gridOverlay = document.getElementById('gridOverlay') as HTMLDivElement
const btnPlayPause = document.getElementById('btnPlayPause') as HTMLButtonElement
const btnFullscreen = document.getElementById('btnFullscreen') as HTMLButtonElement
const tabs = document.querySelectorAll('.tab')

tabs.forEach(t => t.addEventListener('click', () => {
  tabs.forEach(x => x.classList.remove('active'))
  t.classList.add('active')
  const tab = (t as HTMLElement).dataset.tab
  document.getElementById('panel-camera')!.style.display = tab === 'camera' ? 'block' : 'none'
  document.getElementById('panel-import')!.style.display = tab === 'import' ? 'block' : 'none'
}))
chkGrid.addEventListener('change', () => { gridOverlay.style.display = chkGrid.checked ? 'block' : 'none' })
chkLockExp.addEventListener('change', async () => {
  if (!stream) return
  const track = stream.getVideoTracks()[0] as any
  try {
    if (chkLockExp.checked) {
      await track.applyConstraints({ advanced: [{ exposureMode: 'manual', focusMode: 'manual', whiteBalanceMode: 'manual' } as any] } as any)
      log('Exposição travada (manual)')
    } else {
      await track.applyConstraints({ advanced: [{ exposureMode: 'continuous', focusMode: 'continuous', whiteBalanceMode: 'continuous' } as any] } as any)
      log('Exposição auto')
    }
  } catch (e: any) {
    log('Travar exposição não suportado neste device: ' + e.message)
    try { if (chkLockExp.checked) await track.applyConstraints({ advanced: [{ exposureMode: 'manual' } as any] } as any) } catch {}
  }
})
btnFullscreen.addEventListener('click', async () => {
  const el = previewWrap as any
  if (document.fullscreenElement) await document.exitFullscreen().catch(()=>{})
  else await el.requestFullscreen().catch(()=> log('Fullscreen não suportado'))
})
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLSelectElement)) {
    if (frames.length >= 2) {
      e.preventDefault()
      if (isPreviewPlaying) stopPreview()
      else startPreview()
    }
  }
})

// collapse fotos
let timelineCollapsed = false
btnToggleTimeline.addEventListener('click', () => {
  timelineCollapsed = !timelineCollapsed
  timelineCollapsible.style.display = timelineCollapsed ? 'none' : 'block'
  btnToggleTimeline.innerHTML = timelineCollapsed
    ? `<svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="18 15 12 9 6 15"/></svg> Mostrar`
    : `<svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="6 9 12 15 18 9"/></svg> Ocultar`
})

function log(msg: string) {
  logEl.style.display = 'block'
  logEl.textContent += msg + '\n'
  logEl.scrollTop = logEl.scrollHeight
}

let historyStack: { blob: Blob; name: string; id: string }[][] = []
function pushHistory() {
  if (frames.length === 0) return
  historyStack.push(frames.map(f => ({ blob: f.blob, name: f.name, id: f.id })))
  if (historyStack.length > 20) historyStack.shift()
}
function undo() {
  const prev = historyStack.pop()
  if (!prev) return
  frames.forEach(f => URL.revokeObjectURL(f.url))
  frames = prev.map(p => ({ ...p, url: URL.createObjectURL(p.blob) }))
  updateStats()
  log('Desfeito (Ctrl+Z)')
}
// --- IndexedDB persistência ---
let db: IDBDatabase | null = null
function openDB(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    if (db) return res(db)
    const req = indexedDB.open('stopmotion', 1)
    req.onupgradeneeded = () => { const d = req.result; if (!d.objectStoreNames.contains('frames')) d.createObjectStore('frames', { keyPath: 'id' }); if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'k' }) }
    req.onsuccess = () => { db = req.result; res(db) }
    req.onerror = () => rej(req.error)
  })
}
async function saveDB() {
  try {
    const d = await openDB()
    const tx = d.transaction(['frames','meta'], 'readwrite')
    tx.objectStore('frames').clear()
    tx.objectStore('meta').clear()
    for (let i=0;i<frames.length;i++) tx.objectStore('frames').put({ id: frames[i].id, blob: frames[i].blob, name: frames[i].name, idx: i })
    tx.objectStore('meta').put({ k: 'photoRes', v: photoResSel.value })
    tx.objectStore('meta').put({ k: 'videoRes', v: resSel.value })
    tx.objectStore('meta').put({ k: 'fps', v: fpsSel.value })
  } catch {}
}
async function loadDB() {
  try {
    const d = await openDB()
    const tx = d.transaction(['frames','meta'], 'readonly')
    const reqFrames = tx.objectStore('frames').getAll()
    const framesData: any[] = await new Promise((res,rej)=>{ reqFrames.onsuccess=()=>res(reqFrames.result); reqFrames.onerror=()=>rej(reqFrames.error)})
    const metaReq = tx.objectStore('meta').getAll()
    const meta: any[] = await new Promise((res)=>{ metaReq.onsuccess=()=>res(metaReq.result); metaReq.onerror=()=>res([])})
    if (framesData.length) {
      framesData.sort((a,b)=>a.idx-b.idx)
      frames = framesData.map(f=>({ id: f.id, blob: f.blob, name: f.name, url: URL.createObjectURL(f.blob)}))
      for (const m of meta) {
        if (m.k==='photoRes' && m.v) photoResSel.value=m.v
        if (m.k==='videoRes' && m.v) resSel.value=m.v
        if (m.k==='fps' && m.v) fpsSel.value=m.v
      }
      applyOrientation()
      updateStats()
      log(`Projeto restaurado: ${frames.length} fotos`)
    }
  } catch{}
}
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault()
    undo()
  }
})

function updateStats() {
  const n = frames.length
  counterBadge.textContent = `${n} foto${n !== 1 ? 's' : ''}`
  countText.textContent = String(n)
  const res = resSel.value
  const pres = photoResSel.value
  document.getElementById('statRes')!.textContent = `Foto: ${pres} • Vídeo: ${res}`
  if (n >= 2 && previewCard.style.display === 'none') {
    previewCard.style.display = 'block'
    previewWrap.style.display = 'block'
    previewCanvas.style.display = 'none'
    previewPlaceholder.style.display = 'flex'
    outputVideo.style.display = 'none'
  } else if (n < 2) {
    stopPreview()
    previewCard.style.display = 'none'
  }
  const totalBytes = frames.reduce((a, f) => a + f.blob.size, 0)
  saveDB()
  const mb = (totalBytes / 1024 / 1024).toFixed(1)
  document.getElementById('statSize')!.textContent = `~${mb} MB`
  btnGenerate.disabled = n < 2
  btnCapture.disabled = !stream
  ;(btnExportZip as any).style.display = n >= 1 ? 'flex' : 'none'
  statusEl.textContent = n < 2 ? 'Adicione pelo menos 2 fotos' : `${n} frames prontos • FPS ${fpsSel.value} = ~${(n / parseInt(fpsSel.value)).toFixed(1)}s de vídeo`
  renderTimeline()
}

function renderTimeline() {
  if (frames.length === 0) {
    timeline.innerHTML = `<div style="grid-column:1/-1; text-align:center; color:var(--muted); padding:20px; font-size:13px">Nenhuma foto ainda. Capture ou importe.</div>`
    return
  }
  timeline.innerHTML = frames.map((f, i) => `
    <div class="thumb" draggable="true" data-idx="${i}" style="cursor:grab">
      <img src="${f.url}" loading="lazy" draggable="false" />
      <span>${String(i + 1).padStart(3, '0')}</span>
      <button data-dup="${f.id}" title="Duplicar" style="right:28px; background:rgba(59,130,246,.8)"><svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v3"/></svg></button>
      <button data-del="${f.id}" title="Remover"><svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>
  `).join('')
  let dragIdx: number | null = null
  timeline.querySelectorAll('.thumb').forEach(el => {
    el.addEventListener('dragstart', () => { dragIdx = parseInt((el as HTMLElement).dataset.idx!); (el as HTMLElement).style.opacity = '0.4' })
    el.addEventListener('dragend', () => { (el as HTMLElement).style.opacity = '1'; dragIdx = null })
    el.addEventListener('dragover', (e) => e.preventDefault())
    el.addEventListener('drop', (e) => {
      e.preventDefault()
      const targetIdx = parseInt((el as HTMLElement).dataset.idx!)
      if (dragIdx === null || dragIdx === targetIdx) return
      pushHistory()
      const [moved] = frames.splice(dragIdx, 1)
      frames.splice(targetIdx, 0, moved)
      updateStats()
    })
  })
  timeline.querySelectorAll('[data-del]').forEach(b => {
    b.addEventListener('click', () => {
      const id = (b as HTMLElement).dataset.del!
      const idx = frames.findIndex(f => f.id === id)
      if (idx >= 0) {
        pushHistory()
        URL.revokeObjectURL(frames[idx].url)
        frames.splice(idx, 1)
        updateStats()
      }
    })
  })
  timeline.querySelectorAll('[data-dup]').forEach(b => {
    b.addEventListener('click', () => {
      const id = (b as HTMLElement).dataset.dup!
      const idx = frames.findIndex(f => f.id === id)
      if (idx >= 0) {
        pushHistory()
        const orig = frames[idx]
        const dup: Frame = { id: Math.random().toString(36).slice(2), blob: orig.blob, url: URL.createObjectURL(orig.blob), name: orig.name }
        frames.splice(idx + 1, 0, dup)
        updateStats()
      }
    })
  })
}

async function resizeBlobToFHD(blob: Blob, target: string): Promise<Blob> {
  const [tw, th] = target.split('x').map(Number)
  const img = await createImageBitmap(blob).catch(async () => {
    // fallback for HEIC or createImageBitmap fail: use <img>
    const url = URL.createObjectURL(blob)
    const el = new Image()
    el.src = url
    await new Promise((res, rej) => { el.onload = () => res(null); el.onerror = rej })
    const bmp = await createImageBitmap(el)
    URL.revokeObjectURL(url)
    return bmp
  })
  // calculate cover resize preserving aspect, centered crop to exact target
  const canvas = document.createElement('canvas')
  canvas.width = tw
  canvas.height = th
  const ctx = canvas.getContext('2d')!
  const scale = Math.max(tw / img.width, th / img.height)
  const w = img.width * scale
  const h = img.height * scale
  const x = (tw - w) / 2
  const y = (th - h) / 2
  ctx.drawImage(img, x, y, w, h)
  img.close?.()
  const out: Blob = await new Promise(res => canvas.toBlob(b => res(b!), 'image/jpeg', 0.85)!)
  return out
}

// --- camera ---
async function startCamera() {
  // getUserMedia só funciona em contexto seguro (HTTPS)
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    const isSecure = window.isSecureContext
     const msg = `Navegador bloqueou a câmera.\n\nMotivo: você está acessando via HTTP (http://${location.hostname}).\nSmartphones exigem HTTPS para getUserMedia.\n\nSoluções:\n1) Acesse via HTTPS: https://${location.hostname}:5173 (aceite o aviso de certificado auto-assinado)\n2) Ou use: chrome://flags -> "Insecure origins treated as secure" -> adicione http://${location.hostname}:5173\n3) Importar fotos continua funcionando sem câmera.`
    placeholder.innerHTML = `<div style="color:#fca5a5; font-size:13px; line-height:1.4; padding:10px">${msg.replace(/\n/g,'<br>')}</div>`
    log(`SecureContext: ${isSecure}, protocol: ${location.protocol}, mediaDevices: ${!!navigator.mediaDevices}`)
    alert(msg)
    return
  }
  try {
    if (stream) stream.getTracks().forEach(t => t.stop())
    const [rw, rh] = photoResSel.value.split('x').map(Number)
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing, width: { ideal: rw }, height: { ideal: rh } },
      audio: false
    })
    video.srcObject = stream
    video.style.display = 'block'
    placeholder.style.display = 'none'
    btnStartCam.innerHTML = `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M18 6L6 18"/><path d="M6 6l12 12"/><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg> Desligar câmera`
    btnSwitch.style.display = 'inline-flex'
    btnCapture.disabled = false
    await video.play()
  } catch (e: any) {
    const msg = e.name === 'NotAllowedError' ? 'Permissão negada. Libere a câmera nas configurações do navegador.' : e.message
    alert('Erro ao abrir câmera: ' + msg)
    placeholder.innerHTML = `<div style="color:#fca5a5; font-size:13px; padding:10px">Erro: ${msg}<br><small>Verifique permissão de câmera e use HTTPS</small></div>`
    log('Camera error: ' + e.name + ' - ' + e.message)
  }
}
function stopCamera() {
  stream?.getTracks().forEach(t => t.stop())
  stream = null
  video.srcObject = null
  video.style.display = 'none'
  placeholder.style.display = 'block'
  btnStartCam.innerHTML = `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg> Ligar câmera`
  btnSwitch.style.display = 'none'
  btnCapture.disabled = true
}
btnStartCam.addEventListener('click', () => {
  if (stream) stopCamera()
  else startCamera()
})
btnSwitch.addEventListener('click', async () => {
  facing = facing === 'environment' ? 'user' : 'environment'
  await startCamera()
})
// toque no preview também captura (útil se volume não funcionar)
document.getElementById('cameraWrap')!.addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest('button')) return
  if (stream) doCapture()
})



async function doCapture() {
  if (!stream) return
  const target = photoResSel.value
  const [tw, th] = target.split('x').map(Number)
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (!vw || !vh) return
  captureCanvas.width = tw
  captureCanvas.height = th
  const ctx = captureCanvas.getContext('2d')!
  const scale = Math.max(tw / vw, th / vh)
  const w = vw * scale
  const h = vh * scale
  ctx.drawImage(video, (tw - w) / 2, (th - h) / 2, w, h)
  const blob: Blob = await new Promise(res => captureCanvas.toBlob(b => res(b!), 'image/jpeg', 0.85)!)
  const url = URL.createObjectURL(blob)
  frames.push({ id: Math.random().toString(36).slice(2), blob, url, name: `cap_${String(frames.length + 1).padStart(4, '0')}.jpg` })
  video.style.filter = 'brightness(1.8)'
  setTimeout(() => video.style.filter = '', 120)
  ;(navigator as any).vibrate?.(30)
  updateStats()
}
btnCapture.addEventListener('click', doCapture)

// debug removido - não usa mais alert

// remote shutter via botão de volume / bluetooth (envia VolumeUp/Enter)
let lastVolumeCapture = 0
function isVolumeShutterEvent(e: KeyboardEvent) {
  const k = e.key
  const code = e.code
  // keys que shutters BT enviam: VolumeUp/Down, AudioVolumeUp/Down, Enter, Space, ArrowUp
  return (
    k === 'AudioVolumeUp' || k === 'AudioVolumeDown' ||
    k === 'VolumeUp' || k === 'VolumeDown' ||
    code === 'VolumeUp' || code === 'VolumeDown' ||
    k === 'Enter' || k === ' ' ||
    e.keyCode === 25 || e.keyCode === 24 || e.keyCode === 13 || e.keyCode === 32
  )
}
for (const ev of ['keydown', 'keyup'] as const) {
  window.addEventListener(ev, (e: KeyboardEvent) => {
    if (!isVolumeShutterEvent(e)) return
    const now = Date.now()
    if (now - lastVolumeCapture < 400) {
      e.preventDefault()
      return
    }
    if (!stream) return
    e.preventDefault()
    e.stopPropagation()
    lastVolumeCapture = now
    doCapture()
    btnCapture.focus()
  }, { passive: false } as any)
}
try {
  if ('mediaSession' in navigator) {
    // @ts-ignore
    navigator.mediaSession.setActionHandler('nexttrack', () => doCapture())
    // @ts-ignore
    navigator.mediaSession.setActionHandler('previoustrack', () => doCapture())
    // @ts-ignore
    navigator.mediaSession.setActionHandler('play', () => doCapture())
  }
} catch {}
// alguns shutters Bluetooth aparecem como Gamepad (ex: AB Shutter3)
let lastGamepadCapture = 0
setInterval(() => {
  const pads = navigator.getGamepads ? navigator.getGamepads() : []
  for (const pad of pads) {
    if (!pad) continue
    const pressed = pad.buttons.some(b => b.pressed)
    if (pressed && Date.now() - lastGamepadCapture > 500 && stream) {
      lastGamepadCapture = Date.now()
      doCapture()
    }
  }
}, 200)

// --- import ---
async function handleFiles(files: FileList | File[]) {
  const arr = Array.from(files).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  const target = photoResSel.value
  statusEl.textContent = `Processando ${arr.length} imagens...`
  for (let i = 0; i < arr.length; i++) {
    const f = arr[i]
    try {
      // skip non-image
      if (!f.type.startsWith('image/') && !f.name.match(/\.(heic|heif)$/i)) continue
      let blob: Blob = f
      // resize if needed (also converts HEIC -> JPEG via canvas)
      // Always resize to target to keep FHD and small size
      blob = await resizeBlobToFHD(blob, target)
      const url = URL.createObjectURL(blob)
      frames.push({ id: Math.random().toString(36).slice(2), blob, url, name: f.name })
    } catch (e: any) {
      log(`Falha em ${f.name}: ${e.message}`)
    }
    if (i % 20 === 0) updateStats()
  }
  updateStats()
  log(`Importadas ${arr.length} arquivos. Total: ${frames.length}`)
}
fileInput.addEventListener('change', () => {
  if (fileInput.files) handleFiles(fileInput.files)
  fileInput.value = ''
})
dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag') })
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag'))
dropzone.addEventListener('drop', e => {
  e.preventDefault()
  dropzone.classList.remove('drag')
  if (e.dataTransfer?.files) handleFiles(e.dataTransfer.files)
})
btnExportZip.addEventListener('click', async () => {
  if (frames.length === 0) return
  btnExportZip.textContent = 'Gerando ZIP...'
  const zip = new JSZip()
  for (let i=0;i<frames.length;i++) {
    const name = `frame_${String(i+1).padStart(4,'0')}.jpg`
    zip.file(name, frames[i].blob)
  }
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'stopmotion-frames.zip'
  a.click()
  setTimeout(()=>URL.revokeObjectURL(url), 5000)
  btnExportZip.innerHTML = `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/><path d="M16 8l-8 0"/><path d="M16 12l-8 0"/></svg> Baixar ZIP dos frames`
  log(`ZIP gerado: ${(blob.size/1024/1024).toFixed(1)} MB`)
})

// --- preview (canvas loop) ---
function updatePlayButtons(isPlaying: boolean) {
  const playIcon = `<svg class="icon icon-sm" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg> Play`
  const pauseIcon = `<svg class="icon icon-sm" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Pause`
  btnPlayPause.innerHTML = isPlaying ? pauseIcon : playIcon
}
function stopPreview() {
  if (previewInterval) window.clearInterval(previewInterval)
  previewInterval = null
  isPreviewPlaying = false
  updatePlayButtons(false)
}
function startPreview() {
  if (frames.length === 0) return
  const fps = parseInt(fpsSel.value)
  const [tw, th] = resSel.value.split('x').map(Number)
  previewCard.style.display = 'block'
  previewWrap.style.display = 'block'
  previewCanvas.style.display = 'block'
  previewPlaceholder.style.display = 'none'
  outputVideo.style.display = 'none'
  outputVideo.pause()
  previewCanvas.width = tw
  previewCanvas.height = th
  const ctx = previewCanvas.getContext('2d')!
  let idx = 0
  isPreviewPlaying = true
  updatePlayButtons(true)
  previewCard.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const imgs: HTMLImageElement[] = frames.map(f => {
    const im = new Image()
    im.src = f.url
    return im
  })
  previewInterval = window.setInterval(() => {
    const im = imgs[idx]
    if (im.complete) {
      const scale = Math.max(tw / im.naturalWidth, th / im.naturalHeight)
      const w = im.naturalWidth * scale
      const h = im.naturalHeight * scale
      ctx.clearRect(0, 0, tw, th)
      ctx.drawImage(im, (tw - w) / 2, (th - h) / 2, w, h)
    }
    idx = (idx + 1) % frames.length
  }, 1000 / fps)
}
btnPlayPause.addEventListener('click', () => {
  if (isPreviewPlaying) stopPreview()
  else {
    if (previewCard.style.display === 'none' || previewCanvas.style.display === 'none') startPreview()
    else {
      // se já está no preview de vídeo gerado, volta pro preview de frames
      outputVideo.pause()
      outputVideo.style.display = 'none'
      previewCanvas.style.display = 'block'
      previewPlaceholder.style.display = 'none'
      startPreview()
    }
  }
})

btnClear.addEventListener('click', () => {
  if (!frames.length) return
  if (!confirm(`Remover ${frames.length} fotos?`)) return
  frames.forEach(f => URL.revokeObjectURL(f.url))
  frames = []
  stopPreview()
  previewCard.style.display = 'none'
  previewWrap.style.display = 'none'
  previewPlaceholder.style.display = 'flex'
  btnDownload.style.display = 'none'
  outputVideo.src = ''
  updateStats()
  log('Timeline limpa.')
})

fpsSel.addEventListener('change', () => {
  updateStats()
  if (isPreviewPlaying) {
    stopPreview()
    startPreview()
  }
})
function applyOrientation() {
  const [pw, ph] = photoResSel.value.split('x').map(Number)
  const [vw, vh] = resSel.value.split('x').map(Number)
  const cameraWrap = document.getElementById('cameraWrap') as HTMLDivElement
  const previewWrapEl = document.getElementById('previewWrap') as HTMLDivElement
  if (cameraWrap) cameraWrap.style.aspectRatio = `${pw} / ${ph}`
  if (previewWrapEl) previewWrapEl.style.aspectRatio = `${vw} / ${vh}`
  document.querySelectorAll<HTMLDivElement>('.thumb').forEach(el => el.style.aspectRatio = `${pw} / ${ph}`)
  const tip1 = document.getElementById('cameraTip') as HTMLParagraphElement | null
  const tip2 = document.getElementById('importTip') as HTMLParagraphElement | null
  if (tip1) tip1.textContent = `Foto: ${pw}×${ph} • Vídeo: ${vw}×${vh}`
  if (tip2) tip2.textContent = `Import: fotos serão convertidas para ${pw}×${ph}, vídeo exportado em ${vw}×${vh}.`
}
resSel.addEventListener('change', () => {
  applyOrientation()
  updateStats()
  log(`Resolução de vídeo alterada para ${resSel.value}.`)
})
photoResSel.addEventListener('change', async () => {
  applyOrientation()
  updateStats()
  log(`Resolução de foto alterada para ${photoResSel.value}. Novas capturas usarão essa resolução.`)
  if (stream) {
    // reinicia câmera com nova resolução ideal
    await startCamera()
  }
})
applyOrientation()

// --- ffmpeg ---
async function ensureFFmpeg() {
  if (ffmpegLoaded && ffmpeg) return ffmpeg
  statusEl.textContent = 'Baixando ffmpeg.wasm (~30MB, só na primeira vez)...'
  progressWrap.style.display = 'block'
  progressBar.style.width = '20%'
  ffmpeg = new FFmpeg()
  ffmpeg.on('log', ({ message }) => log(message))
  ffmpeg.on('progress', ({ progress }) => {
    progressBar.style.width = `${Math.round(progress * 100)}%`
  })
  const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm'
  // toBlobURL needs COOP/COEP headers (vite.config does it)
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
  })
  ffmpegLoaded = true
  progressBar.style.width = '100%'
  setTimeout(() => progressWrap.style.display = 'none', 500)
  return ffmpeg
}

btnGenerate.addEventListener('click', async () => {
  if (frames.length < 2) return
  try {
    stopPreview()
    btnGenerate.disabled = true
    btnDownload.style.display = 'none'
    progressWrap.style.display = 'block'
    progressBar.style.width = '5%'
    logEl.textContent = ''
    log(`Iniciando geração: ${frames.length} frames, ${fpsSel.value} fps, ${resSel.value}`)

    const ff = await ensureFFmpeg()
    const fps = fpsSel.value
    const filename = (document.getElementById('filename') as HTMLInputElement).value || 'stopmotion.mp4'

    // clean previous files in MEMFS
    // write frames as img001.jpg etc
    for (let i = 0; i < frames.length; i++) {
      const name = `img${String(i + 1).padStart(3, '0')}.jpg`
      // ensure file is exactly at target resolution (already is)
      await ff.writeFile(name, await fetchFile(frames[i].blob))
      if (i % 50 === 0) {
        progressBar.style.width = `${5 + (i / frames.length) * 20}%`
        statusEl.textContent = `Preparando ${i + 1}/${frames.length}...`
      }
    }
    statusEl.textContent = 'Codificando vídeo (libx264)...'
    // -framerate defines input fps, -r defines output fps
    await ff.exec([
      '-framerate', fps,
      '-i', 'img%03d.jpg',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-vf', `scale=${resSel.value.split('x').join(':')}:flags=lanczos`,
      '-r', fps,
      'out.mp4'
    ])

    const data = await ff.readFile('out.mp4') as any
    const videoBlob = new Blob([new Uint8Array(data)], { type: 'video/mp4' })
    const videoUrl = URL.createObjectURL(videoBlob)

    previewCard.style.display = 'block'
    previewWrap.style.display = 'block'
    previewCanvas.style.display = 'none'
    previewPlaceholder.style.display = 'none'
    outputVideo.style.display = 'block'
    outputVideo.src = videoUrl
    await outputVideo.play().catch(() => {})
    previewCard.scrollIntoView({ behavior: 'smooth', block: 'start' })

    btnDownload.style.display = 'block'
    btnDownload.onclick = () => {
      const a = document.createElement('a')
      a.href = videoUrl
      a.download = filename.endsWith('.mp4') ? filename : filename + '.mp4'
      a.click()
    }
    progressBar.style.width = '100%'
    statusEl.textContent = `Pronto! ${(videoBlob.size / 1024 / 1024).toFixed(1)} MB • ${frames.length} frames @ ${fps}fps`
    log(`Vídeo gerado: ${videoBlob.size} bytes`)

    // cleanup MEMFS images (keep out.mp4 for re-download)
    for (let i = 0; i < frames.length; i++) {
      try { await ff.deleteFile(`img${String(i + 1).padStart(3, '0')}.jpg`) } catch {}
    }
  } catch (e: any) {
    log('ERRO: ' + e.message)
    statusEl.textContent = 'Erro: ' + e.message
    console.error(e)
  } finally {
    btnGenerate.disabled = false
    setTimeout(() => progressWrap.style.display = 'none', 800)
  }
})

loadDB().then(()=>updateStats())
updateStats()
