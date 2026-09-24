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
    <div class="card" id="projectsCard">
      <div style="display:flex; justify-content:space-between; align-items:center">
        <h3 style="font-size:14px">Projetos — <span id="projCount">0/3</span></h3>
        <button id="btnNewProject" class="btn btn-ghost" style="padding:6px 10px; font-size:12px"><svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Novo</button>
      </div>
      <div id="projectsList" style="margin-top:10px; display:flex; flex-direction:column; gap:6px; max-height:180px; overflow:auto"></div>
      <p style="font-size:11px; color:var(--muted); margin-top:8px">Limite 3 projetos. Apague um para criar outro. Salvo local no navegador.</p>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="tabs">
        <button class="tab active" data-tab="camera"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg> Câmera</button>
        <button class="tab" data-tab="import"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-3.5-3.5a2 2 0 0 0-2.8 0L3 21"/></svg> Importar</button>
      </div>

      <div class="field" style="margin:12px 0 16px 0">
        <label>Qualidade (captura e import)</label>
        <select id="quality">
          <option value="original">Original (sem recompressão)</option>
          <option value="0.95">0.95 (máxima)</option>
          <option value="0.90">0.90 (alta)</option>
          <option value="0.85" selected>0.85 (padrão)</option>
        </select>
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
          <label>Foto</label>
          <select id="photoRes">
            <option value="720x1280">720×1280 (HD Vertical)</option>
            <option value="1080x1920" selected>1080×1920 (FHD Vertical)</option>
            <option value="2160x3840">2160×3840 (4K Vertical)</option>
            <option value="1280x720">1280×720 (HD Horizontal)</option>
            <option value="1920x1080">1920×1080 (FHD Horizontal)</option>
            <option value="3840x2160">3840×2160 (4K Horizontal)</option>
          </select>
        </div>
        <div class="camera-controls">
          <button id="btnStartCam" class="btn btn-ghost"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg> Ligar câmera</button>
          <button id="btnSwitch" class="btn btn-ghost" style="display:none"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg> Trocar</button>
          <button id="btnCapture" class="btn btn-primary" disabled><svg class="icon" viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="12" cy="12" r="8"/></svg> Capturar</button>
        </div>
        <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap">
          <label style="display:flex; align-items:center; gap:6px; font-size:12px; color:var(--muted); cursor:pointer"><input type="checkbox" id="chkGrid" /> Grade</label>
        </div>
        <p style="font-size:11px; color:var(--muted); margin-top:6px">Toque no preview para capturar sem tremer.</p>
        <p id="cameraTip" style="font-size:12px; color:var(--muted); margin-top:8px">Dica: gire o celular na vertical. Fotos já saem em 1080×1920 (FHD vertical).</p>
      </div>

      <div id="panel-import" style="display:none">
        <label class="dropzone" id="dropzone" for="fileInput">
          <div style="line-height:1.4"><strong>Clique ou arraste 500 fotos aqui</strong></div>
          <div style="line-height:1.4; margin-top:6px; font-size:13px">JPG / PNG / HEIC (HEIC será convertido).</div>
          <div style="line-height:1.4; font-size:12px; opacity:.8">Ordenado automaticamente.</div>
        </label>
        <input id="fileInput" type="file" accept="image/*,.heic,.heif" multiple style="display:none" />
        <div style="display:flex; gap:8px; margin-top:10px; align-items:end">
          <div class="field" style="flex:1; margin:0">
            <label>Ordenar por</label>
            <select id="sortMode">
              <option value="name" selected>Nome (natural)</option>
              <option value="dateFile">Data do arquivo</option>
              <option value="exif">Data EXIF (criação original)</option>
            </select>
          </div>
          <button id="btnSortTimeline" class="btn btn-ghost" style="padding:8px 10px; font-size:12px" title="Reordenar timeline já importada"><svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="3 6 5 6 21 6"/><polyline points="3 12 5 12 21 12"/><polyline points="3 18 5 18 21 18"/></svg> Ordenar</button>
        </div>
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
            <option value="40">40 fps</option>
            <option value="50">50 fps</option>
            <option value="60">60 fps</option>
          </select>
        </div>
        <div class="field">
          <label>Vídeo (saída)</label>
          <select id="resolution">
            <option value="original">Original (mantém foto)</option>
            <option value="720x1280">720×1280 (HD Vertical)</option>
            <option value="1080x1920" selected>1080×1920 (FHD Vertical)</option>
            <option value="2160x3840">2160×3840 (4K Vertical)</option>
            <option value="1280x720">1280×720 (HD Horizontal)</option>
            <option value="1920x1080">1920×1080 (FHD Horizontal)</option>
            <option value="3840x2160">3840×2160 (4K Horizontal)</option>
          </select>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <h3 style="font-size:14px">Exportar vídeo</h3>
      <div class="field" style="margin-top:8px">
        <label>Nome do arquivo</label>
        <input id="filename" value="stopmotion.mp4" />
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
const qualitySel = document.getElementById('quality') as HTMLSelectElement
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
const sortModeSel = document.getElementById('sortMode') as HTMLSelectElement
const btnSortTimeline = document.getElementById('btnSortTimeline') as HTMLButtonElement
const timelineCollapsible = document.getElementById('timelineCollapsible') as HTMLDivElement
const previewCard = document.getElementById('previewCard') as HTMLDivElement
const previewPlaceholder = document.getElementById('previewPlaceholder') as HTMLDivElement
const chkGrid = document.getElementById('chkGrid') as HTMLInputElement
const gridOverlay = document.getElementById('gridOverlay') as HTMLDivElement
const btnPlayPause = document.getElementById('btnPlayPause') as HTMLButtonElement
const btnFullscreen = document.getElementById('btnFullscreen') as HTMLButtonElement
const btnNewProject = document.getElementById('btnNewProject') as HTMLButtonElement
const tabs = document.querySelectorAll('.tab')

tabs.forEach(t => t.addEventListener('click', () => {
  tabs.forEach(x => x.classList.remove('active'))
  t.classList.add('active')
  const tab = (t as HTMLElement).dataset.tab
  document.getElementById('panel-camera')!.style.display = tab === 'camera' ? 'block' : 'none'
  document.getElementById('panel-import')!.style.display = tab === 'import' ? 'block' : 'none'
}))
chkGrid.addEventListener('change', () => { gridOverlay.style.display = chkGrid.checked ? 'block' : 'none' })
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
type Project = { id: string; name: string; createdAt: number; updatedAt: number; order?: number; frames: { id: string; blob: Blob; name: string }[]; photoRes: string; videoRes: string; fps: string }
// --- IndexedDB persistência (múltiplos projetos, limite 3) ---
let db: IDBDatabase | null = null
let currentProjectId: string | null = localStorage.getItem('currentProjectId')
function openDB(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    if (db) return res(db)
    const req = indexedDB.open('stopmotion', 2)
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects', { keyPath: 'id' })
      if (!d.objectStoreNames.contains('frames')) d.createObjectStore('frames', { keyPath: 'id' })
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'k' })
    }
    req.onsuccess = () => { db = req.result; res(db) }
    req.onerror = () => rej(req.error)
  })
}
async function getAllProjects(): Promise<Project[]> {
  const d = await openDB()
  return new Promise((res)=>{ const tx=d.transaction('projects','readonly'); const req=tx.objectStore('projects').getAll(); req.onsuccess=()=>res(req.result as Project[]); req.onerror=()=>res([]) })
}
async function saveCurrentProject() {
  if (!currentProjectId) return
  try {
    const d = await openDB()
    const proj: Project = {
      id: currentProjectId,
      name: (document.getElementById('projName-' + currentProjectId) as any)?.textContent?.trim() || (await getProjectName(currentProjectId)) || 'Projeto',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      frames: frames.map(f=>({ id: f.id, blob: f.blob, name: f.name })),
      photoRes: photoResSel.value,
      videoRes: resSel.value,
      fps: fpsSel.value
    }
    // preserva createdAt se já existir
    const existing = await new Promise<Project|undefined>((res)=>{ const tx=d.transaction('projects','readonly'); const req=tx.objectStore('projects').get(currentProjectId!); req.onsuccess=()=>res(req.result); req.onerror=()=>res(undefined) })
    if (existing) proj.createdAt = existing.createdAt
    const tx2 = d.transaction('projects','readwrite')
    tx2.objectStore('projects').put(proj)
    // compat: também salva no stores antigos para fallback
    try { const txOld = d.transaction(['frames','meta'],'readwrite'); txOld.objectStore('frames').clear(); txOld.objectStore('meta').clear(); for(let i=0;i<frames.length;i++) txOld.objectStore('frames').put({ id: frames[i].id, blob: frames[i].blob, name: frames[i].name, idx:i }); txOld.objectStore('meta').put({k:'photoRes',v:photoResSel.value}); txOld.objectStore('meta').put({k:'videoRes',v:resSel.value}); txOld.objectStore('meta').put({k:'fps',v:fpsSel.value}) } catch {}
    renderProjectsList()
  } catch {}
}
async function getProjectName(id: string): Promise<string|undefined> {
  try { const d=await openDB(); return await new Promise((res)=>{ const tx=d.transaction('projects','readonly'); const req=tx.objectStore('projects').get(id); req.onsuccess=()=>res(req.result?.name); req.onerror=()=>res(undefined) }) } catch { return undefined }
}
async function saveDB() { await saveCurrentProject() }
async function loadDB() {
  try {
    const d = await openDB()
    let projects = await getAllProjects()
    // migração: se vazio mas tem frames antigos, cria projeto 1 a partir deles
    if (projects.length===0) {
      try {
        const txOld=d.transaction(['frames','meta'],'readonly')
        const reqFrames=txOld.objectStore('frames').getAll()
        const oldFrames:any[] = await new Promise((res)=>{ reqFrames.onsuccess=()=>res(reqFrames.result as any[]); reqFrames.onerror=()=>res([]) })
        if (oldFrames.length) {
          oldFrames.sort((a,b)=>a.idx-b.idx)
          const proj: Project = { id: 'p-'+Date.now().toString(36), name: 'Projeto 1', createdAt: Date.now(), updatedAt: Date.now(), frames: oldFrames.map(f=>({id:f.id, blob:f.blob, name:f.name})), photoRes: photoResSel.value, videoRes: resSel.value, fps: fpsSel.value }
          const metaReq=txOld.objectStore('meta').getAll()
          const meta:any[] = await new Promise((res)=>{ metaReq.onsuccess=()=>res(metaReq.result); metaReq.onerror=()=>res([]) })
          for(const m of meta){ if(m.k==='photoRes') proj.photoRes=m.v; if(m.k==='videoRes') proj.videoRes=m.v; if(m.k==='fps') proj.fps=m.v }
          const tx2=d.transaction('projects','readwrite'); tx2.objectStore('projects').put(proj)
          currentProjectId=proj.id; localStorage.setItem('currentProjectId', currentProjectId)
          projects=[proj]
        }
      } catch {}
    }
    if (projects.length===0) {
      // cria primeiro projeto vazio
      const id='p-'+Date.now().toString(36)
      const proj: Project={ id, name:'Projeto 1', createdAt: Date.now(), updatedAt: Date.now(), frames:[], photoRes: photoResSel.value, videoRes: resSel.value, fps: fpsSel.value }
      const tx=d.transaction('projects','readwrite'); tx.objectStore('projects').put(proj)
      currentProjectId=id; localStorage.setItem('currentProjectId', id)
      projects=[proj]
    }
    // escolhe projeto atual (salvo) ou o mais recente
    if (!currentProjectId || !projects.find(p=>p.id===currentProjectId)) {
      projects.sort((a,b)=>b.updatedAt-a.updatedAt)
      currentProjectId=projects[0].id; localStorage.setItem('currentProjectId', currentProjectId)
    }
    const current = projects.find(p=>p.id===currentProjectId)!
    frames = current.frames.map(f=>({ ...f, url: URL.createObjectURL(f.blob) }))
    photoResSel.value=current.photoRes || photoResSel.value
    resSel.value=current.videoRes || resSel.value
    fpsSel.value=current.fps || fpsSel.value
    applyOrientation()
    renderProjectsList()
    if (frames.length) log(`Projeto "${current.name}" restaurado: ${frames.length} fotos`)
  } catch(e:any){ log('Erro loadDB: '+e.message) }
}
async function renderProjectsList() {
  const list = document.getElementById('projectsList') as HTMLDivElement
  const countEl = document.getElementById('projCount') as HTMLSpanElement
  let projects = await getAllProjects()
  // atribui order se faltar
  let needOrderSave=false
  projects.forEach((p,i)=>{ if(p.order===undefined){ p.order=i; needOrderSave=true } })
  if(needOrderSave){ const d=await openDB(); const tx=d.transaction('projects','readwrite'); projects.forEach(p=>tx.objectStore('projects').put(p)) }
  projects.sort((a,b)=>(a.order??0)-(b.order??0))
  if (countEl) countEl.textContent = `${projects.length}/3`
  if (!list) return
  list.innerHTML = projects.map(p=>`
    <div draggable="true" data-proj="${p.id}" style="display:flex; align-items:center; gap:8px; padding:8px; border-radius:8px; border:1px solid ${p.id===currentProjectId?'var(--accent)':'var(--border)'}; background:${p.id===currentProjectId?'#1e293b':'var(--card2)'}; cursor:grab">
      <span style="color:var(--muted); cursor:grab; user-select:none" title="Arrastar para reordenar">⋮⋮</span>
      <div style="flex:1; min-width:0">
        <div style="font-size:13px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis" id="projName-${p.id}">${p.name}</div>
        <div style="font-size:11px; color:var(--muted)">${p.frames.length} fotos • ${p.videoRes} • ${p.fps}fps</div>
      </div>
      <button data-load="${p.id}" class="btn btn-ghost" style="padding:6px 8px; font-size:11px" title="Carregar">${p.id===currentProjectId?'Ativo':'Abrir'}</button>
      <button data-rename="${p.id}" class="btn btn-ghost" style="padding:6px 6px; font-size:11px" title="Renomear"><svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
      <button data-delproj="${p.id}" class="btn btn-danger" style="padding:6px 6px; font-size:11px" title="Apagar"><svg class="icon icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
    </div>
  `).join('') || `<div style="text-align:center; color:var(--muted); font-size:12px; padding:10px">Nenhum projeto</div>`
  list.querySelectorAll('[data-load]').forEach(b=>b.addEventListener('click', async ()=>{
    const id=(b as HTMLElement).dataset.load!
    if(id===currentProjectId) return
    // salva atual antes de trocar
    await saveCurrentProject()
    currentProjectId=id; localStorage.setItem('currentProjectId', id)
    const d=await openDB(); const proj:Project = await new Promise((res)=>{ const tx=d.transaction('projects','readonly'); const req=tx.objectStore('projects').get(id); req.onsuccess=()=>res(req.result); req.onerror=()=>res(undefined as any) }) as any
    if(proj){
      frames.forEach(f=>URL.revokeObjectURL(f.url))
      frames=proj.frames.map(f=>({ ...f, url: URL.createObjectURL(f.blob) }))
      photoResSel.value=proj.photoRes; resSel.value=proj.videoRes; fpsSel.value=proj.fps
      applyOrientation(); updateStats()
    }
  }))
  // drag para reordenar projetos
  let dragProjId: string | null = null
  list.querySelectorAll('[data-proj]').forEach(el=>{
    el.addEventListener('dragstart', ()=>{ dragProjId=(el as HTMLElement).dataset.proj!; (el as HTMLElement).style.opacity='0.5' })
    el.addEventListener('dragend', ()=>{ (el as HTMLElement).style.opacity='1'; dragProjId=null })
    el.addEventListener('dragover', (e)=>e.preventDefault())
    el.addEventListener('drop', async (e)=>{
      e.preventDefault()
      const targetId=(el as HTMLElement).dataset.proj!
      if(!dragProjId || dragProjId===targetId) return
      const ids=projects.map(p=>p.id)
      const from=ids.indexOf(dragProjId), to=ids.indexOf(targetId)
      const [moved]=projects.splice(from,1)
      projects.splice(to,0,moved)
      projects.forEach((p,i)=>p.order=i)
      const d=await openDB(); const tx=d.transaction('projects','readwrite'); projects.forEach(p=>tx.objectStore('projects').put(p))
      renderProjectsList()
    })
  })
  list.querySelectorAll('[data-rename]').forEach(b=>b.addEventListener('click', async ()=>{
    const id=(b as HTMLElement).dataset.rename!
    const d=await openDB(); const proj:Project = await new Promise((res)=>{ const tx=d.transaction('projects','readonly'); const req=tx.objectStore('projects').get(id); req.onsuccess=()=>res(req.result); req.onerror=()=>res(undefined as any) }) as any
    if(!proj) return
    const name=prompt('Novo nome:', proj.name)
    if(!name || !name.trim()) return
    proj.name=name.trim(); proj.updatedAt=Date.now()
    const tx=d.transaction('projects','readwrite'); tx.objectStore('projects').put(proj)
    renderProjectsList()
  }))
  list.querySelectorAll('[data-delproj]').forEach(b=>b.addEventListener('click', async ()=>{
    const id=(b as HTMLElement).dataset.delproj!
    if(!confirm('Apagar projeto? Fotos serão perdidas.')) return
    const d=await openDB(); const tx=d.transaction('projects','readwrite'); tx.objectStore('projects').delete(id)
    await new Promise<void>((res)=>{ tx.oncomplete=()=>res(); tx.onerror=()=>res() })
    if(id===currentProjectId){
      const remaining=await getAllProjects()
      if(remaining.length===0){
        const newId='p-'+Date.now().toString(36)
        const proj:Project={ id:newId, name:'Projeto 1', createdAt: Date.now(), updatedAt: Date.now(), frames:[], photoRes: photoResSel.value, videoRes: resSel.value, fps: fpsSel.value }
        const tx2=d.transaction('projects','readwrite'); tx2.objectStore('projects').put(proj)
        currentProjectId=newId; localStorage.setItem('currentProjectId', newId)
        frames=[]; frames.forEach(f=>URL.revokeObjectURL(f.url)); updateStats()
      } else {
        remaining.sort((a,b)=>b.updatedAt-a.updatedAt)
        currentProjectId=remaining[0].id; localStorage.setItem('currentProjectId', currentProjectId)
        const proj=remaining[0]
        frames.forEach(f=>URL.revokeObjectURL(f.url))
        frames=proj.frames.map(f=>({ ...f, url: URL.createObjectURL(f.blob) }))
        photoResSel.value=proj.photoRes; resSel.value=proj.videoRes; fpsSel.value=proj.fps
        applyOrientation(); updateStats()
      }
    }
    renderProjectsList()
  }))
}
btnNewProject.addEventListener('click', async () => {
  const projects = await getAllProjects()
  if (projects.length >= 3) { alert('Limite de 3 projetos. Apague um para criar outro.'); return }
  const name = prompt('Nome do novo projeto:', `Projeto ${projects.length + 1}`)
  if (!name || !name.trim()) return
  await saveCurrentProject()
  const id = 'p-' + Date.now().toString(36)
  const proj: Project = { id, name: name.trim(), createdAt: Date.now(), updatedAt: Date.now(), frames: [], photoRes: photoResSel.value, videoRes: resSel.value, fps: fpsSel.value }
  const d = await openDB(); const tx=d.transaction('projects','readwrite'); tx.objectStore('projects').put(proj)
  await new Promise<void>((res)=>{ tx.oncomplete=()=>res(); tx.onerror=()=>res() })
  currentProjectId=id; localStorage.setItem('currentProjectId', id)
  frames.forEach(f=>URL.revokeObjectURL(f.url)); frames=[]
  applyOrientation(); updateStats()
  renderProjectsList()
})
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

async function convertHeicIfNeeded(blob: Blob, name: string): Promise<Blob> {
  const isHeic = blob.type === 'image/heic' || blob.type === 'image/heif' || /\.heic$/i.test(name) || /\.heif$/i.test(name)
  if (!isHeic) return blob
  try {
    const { default: heic2any } = await import('heic2any')
    const out = await heic2any({ blob, toType: 'image/jpeg', quality: 0.85 }) as Blob
    const jpeg = Array.isArray(out) ? out[0] : out
    log(`HEIC convertido: ${name}`)
    return jpeg
  } catch (e: any) {
    log(`Falha HEIC ${name}: ${e.message} - tentando direto`)
    return blob
  }
}
async function resizeBlobToFHD(blob: Blob, target: string): Promise<Blob> {
  if (qualitySel?.value === 'original') return blob
  const [tw, th] = target.split('x').map(Number)
  // não faz upscale de imagens pequenas para não borrar (ex: 500x500 -> 4K)
  // se já for menor que target, mantém tamanho original com letterbox
  const img = await createImageBitmap(blob).catch(async () => {
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
  // evita upscale borrado: se imagem menor que target, não amplia além de 1x
  const scale = Math.min(1, Math.max(tw / img.width, th / img.height))
  const w = img.width * scale
  const h = img.height * scale
  const x = (tw - w) / 2
  const y = (th - h) / 2
  // fundo preto para letterbox quando não preenche
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, tw, th)
  ctx.drawImage(img, x, y, w, h)
  img.close?.()
  const qRaw = qualitySel?.value || '0.85'
  const q = qRaw === 'original' ? 0.92 : parseFloat(qRaw)
  const out: Blob = await new Promise(res => canvas.toBlob(b => res(b!), 'image/jpeg', q)!)
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
  const qRaw2 = qualitySel?.value || '0.85'
  const q2 = qRaw2 === 'original' ? 0.92 : parseFloat(qRaw2)
  const blob: Blob = await new Promise(res => captureCanvas.toBlob(b => res(b!), 'image/jpeg', q2)!)
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
function naturalSort(a: string, b: string) {
  const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  return coll.compare(a, b)
}
async function getExifDate(file: File): Promise<number | null> {
  try {
    const { default: exifr } = await import('exifr')
    const data: any = await exifr.parse(file, ['DateTimeOriginal','CreateDate','ModifyDate','CreationDate'])
    const d = data?.DateTimeOriginal || data?.CreateDate || data?.ModifyDate || data?.CreationDate
    if (d instanceof Date && !isNaN(d.getTime())) return d.getTime()
    if (typeof d === 'string') { const t=Date.parse(d); if(!isNaN(t)) return t }
  } catch {}
  return null
}
async function handleFiles(files: FileList | File[]) {
  const sortMode = (document.getElementById('sortMode') as HTMLSelectElement)?.value || 'name'
  let arr = Array.from(files as File[])
  if (sortMode === 'exif') {
    statusEl.textContent = `Lendo EXIF de ${arr.length} imagens...`
    const withDate = await Promise.all(arr.map(async f=>{
      const d = await getExifDate(f)
      return { f, d: d ?? f.lastModified ?? 0 }
    }))
    withDate.sort((a,b)=>a.d - b.d)
    arr = withDate.map(x=>x.f)
  } else if (sortMode === 'dateFile') {
    arr.sort((a,b)=>(a.lastModified||0)-(b.lastModified||0))
  } else {
    arr.sort((a,b)=>{ const r=naturalSort(a.name,b.name); if(r!==0) return r; return (a.lastModified||0)-(b.lastModified||0) })
  }
  const target = photoResSel.value
  // pushHistory para permitir undo do import em lote
  if (arr.length) pushHistory()
  statusEl.textContent = `Processando ${arr.length} imagens...`
  // processa sequencialmente para manter ordem, mas coleta resultados ordenados
  const newFrames: Frame[] = []
  for (let i = 0; i < arr.length; i++) {
    const f = arr[i] as File
    try {
      if (!f.type.startsWith('image/') && !f.name.match(/\.(heic|heif)$/i)) continue
      let blob: Blob = f
      blob = await convertHeicIfNeeded(blob, f.name)
      blob = await resizeBlobToFHD(blob, target)
      const url = URL.createObjectURL(blob)
      newFrames.push({ id: Math.random().toString(36).slice(2), blob, url, name: f.name })
    } catch (e: any) {
      log(`Falha em ${f.name}: ${e.message}`)
    }
    if (i % 20 === 0) {
      statusEl.textContent = `Processando ${i + 1}/${arr.length}...`
    }
  }
  // append em ordem garantida
  frames.push(...newFrames)
  updateStats()
  log(`Importadas ${newFrames.length}/${arr.length} arquivos em ordem. Total: ${frames.length}`)
  // se ainda fora de ordem, usuário pode arrastar na timeline ou usar botão ordenar
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
btnSortTimeline.addEventListener('click', async () => {
  if (frames.length < 2) return
  const mode = sortModeSel.value
  pushHistory()
  if (mode === 'name') {
    frames.sort((a,b)=> naturalSort(a.name,b.name))
  } else if (mode === 'dateFile') {
    // para frames já importados não temos lastModified, usa nome como fallback
    frames.sort((a,b)=> naturalSort(a.name,b.name))
    log('Ordenar por data do arquivo só vale no import; reordenando por nome.')
  } else if (mode === 'exif') {
    statusEl.textContent = 'Lendo EXIF da timeline...'
    const withDate = await Promise.all(frames.map(async f=>{
      try{
        const { default: exifr } = await import('exifr')
        const d:any = await exifr.parse(f.blob, ['DateTimeOriginal','CreateDate'])
        const t = d?.DateTimeOriginal instanceof Date ? d.DateTimeOriginal.getTime() : (d?.CreateDate instanceof Date ? d.CreateDate.getTime() : null)
        return { f, t: t ?? 0 }
      } catch { return { f, t: 0 } }
    }))
    // se nenhum tem EXIF, fallback para nome
    const hasExif = withDate.some(x=>x.t!==0)
    if (!hasExif) {
      frames.sort((a,b)=> naturalSort(a.name,b.name))
      log('Sem EXIF nos frames, ordenado por nome.')
    } else {
      withDate.sort((a,b)=>a.t-b.t)
      frames = withDate.map(x=>x.f)
    }
  }
  updateStats()
  log(`Timeline ordenada por ${mode}`)
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
  const [tw, th] = getVideoSize()
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

function getVideoSize(): [number, number] {
  if (resSel.value === 'original') return photoResSel.value.split('x').map(Number) as [number, number]
  return resSel.value.split('x').map(Number) as [number, number]
}
fpsSel.addEventListener('change', () => {
  updateStats()
  if (isPreviewPlaying) {
    stopPreview()
    startPreview()
  }
})
function applyOrientation() {
  const [pw, ph] = photoResSel.value.split('x').map(Number)
  const [vw, vh] = getVideoSize()
  const cameraWrap = document.getElementById('cameraWrap') as HTMLDivElement
  const previewWrapEl = document.getElementById('previewWrap') as HTMLDivElement
  if (cameraWrap) cameraWrap.style.aspectRatio = `${pw} / ${ph}`
  if (previewWrapEl) previewWrapEl.style.aspectRatio = `${vw} / ${vh}`
  document.querySelectorAll<HTMLDivElement>('.thumb').forEach(el => el.style.aspectRatio = `${pw} / ${ph}`)
  const tip1 = document.getElementById('cameraTip') as HTMLParagraphElement | null
  const tip2 = document.getElementById('importTip') as HTMLParagraphElement | null
  const vLabel = resSel.value === 'original' ? `Original (${vw}×${vh})` : `${vw}×${vh}`
  if (tip1) tip1.textContent = `Foto: ${pw}×${ph} • Vídeo: ${vLabel}`
  if (tip2) tip2.textContent = `Import: fotos serão convertidas para ${pw}×${ph}, vídeo exportado em ${vLabel}.`
}
resSel.addEventListener('change', () => {
  applyOrientation()
  updateStats()
  log(`Resolução de vídeo alterada para ${resSel.value}.`)
  if (isPreviewPlaying) { stopPreview(); startPreview() }
})
photoResSel.addEventListener('change', async () => {
  applyOrientation()
  updateStats()
  log(`Resolução de foto alterada para ${photoResSel.value}. Novas capturas usarão essa resolução.`)
  if (isPreviewPlaying) { stopPreview(); startPreview() }
  if (stream) {
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
    const filenameAtGen = (document.getElementById('filename') as HTMLInputElement).value || 'stopmotion.mp4'

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
    const vfArgs: string[] = resSel.value === 'original' ? [] : ['-vf', `scale=${resSel.value.split('x').join(':')}:flags=lanczos`]
    await ff.exec([
      '-framerate', fps,
      '-i', 'img%03d.jpg',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      ...vfArgs,
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
      const fname = (document.getElementById('filename') as HTMLInputElement).value || filenameAtGen
      const finalName = fname.endsWith('.mp4') ? fname : fname + '.mp4'
      const a = document.createElement('a')
      a.href = videoUrl
      a.download = finalName
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
// updateStats() inicial já é chamado pelo loadDB, evita limpar DB antes do load
