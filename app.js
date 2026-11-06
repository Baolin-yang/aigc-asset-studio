/* ─── constants ─────────────────────────────────────────────────────────────── */
const LS_KEY = 'aigc_studio_v2';
const HEALTH_INTERVAL = 30_000;

/* ─── state ─────────────────────────────────────────────────────────────────── */
const state = {
  view: 'library',
  upload: null,
  sample: false,
  activeShot: 0,
  previewPlaying: false,
  healthy: null,          // null = unknown, true/false = last check
  assets: [
    { name: 'Oak Lounge Chair',      desc: '橡木休闲椅 · 0.78 × 0.76 × 0.92 m', tag: 'PUBLISHED V1.2', score: '96%', uses: '2 次复用', selected: true  },
    { name: 'Cedar Bedside Table',   desc: '雪松床头柜 · 0.48 × 0.42 × 0.56 m', tag: 'PUBLISHED V1.0', score: '91%', uses: '1 次复用', selected: false },
    { name: 'Stoneware Coffee Set',  desc: '陶土咖啡器具 · 0.31 × 0.24 × 0.18 m', tag: 'REVIEWING V0.3', score: '—',   uses: '未使用',   selected: false },
  ],
  recentJobs: [],         // persisted
};

/* ─── persistence ───────────────────────────────────────────────────────────── */
function persist() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({
      view: state.view,
      recentJobs: state.recentJobs.slice(0, 10),
    }));
  } catch (_) { /* quota exceeded — ignore */ }
}

function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    if (saved.recentJobs) state.recentJobs = saved.recentJobs;
    if (saved.view && ['library', 'world'].includes(saved.view)) state.view = saved.view;
  } catch (_) {}
}

/* ─── utilities ─────────────────────────────────────────────────────────────── */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

let toastTimer;
function toast(message, type = 'success') {
  const box = $('#toast');
  if (!box) return;
  box.querySelector('p').textContent = message;
  box.dataset.type = type;
  box.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove('show'), type === 'error' ? 4000 : 2800);
}

function setStatusBar(text, mode = 'idle') {
  const bar = $('#statusBar');
  if (!bar) return;
  bar.querySelector('.status-text').textContent = text;
  bar.dataset.mode = mode;
}

/* ─── health check ───────────────────────────────────────────────────────────── */
async function checkHealth(silent = false) {
  const indicator = $('#healthIndicator');
  const label = $('#healthLabel');
  try {
    const res = await fetch('/api/health', { signal: AbortSignal.timeout(4000) });
    const data = await res.json();
    state.healthy = data.ok;
    if (indicator) indicator.className = 'pulse' + (data.ok ? '' : ' warn');
    if (label) label.textContent = data.ok ? 'LOCAL RUNTIME' : 'RUNTIME WARN';
    setStatusBar(data.ok ? '本地服务正常 · Demo Provider 已就绪' : '本地服务返回异常，部分功能可能不可用', data.ok ? 'ok' : 'warn');
    if (!silent) toast(data.ok ? '本地服务正常 · Demo Provider 已就绪' : '本地服务返回异常');
  } catch {
    state.healthy = false;
    if (indicator) indicator.className = 'pulse offline';
    if (label) label.textContent = 'OFFLINE MODE';
    setStatusBar('后端服务未启动 · 页面离线演示模式可用', 'offline');
    if (!silent) toast('页面可以离线展示，API 服务尚未启动', 'warn');
  }
}

/* ─── asset list ─────────────────────────────────────────────────────────────── */
function renderAssets(filter = '') {
  const list = $('#assetList');
  if (!list) return;
  const query = filter.trim().toLowerCase();
  const filtered = state.assets.filter((a) =>
    `${a.name} ${a.desc} ${a.tag}`.toLowerCase().includes(query));

  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state"><span class="empty-icon">◌</span><b>没有匹配的资产</b><small>尝试清空搜索词，或添加新资产</small></div>`;
    return;
  }

  list.innerHTML = filtered.map((asset, i) => {
    const realIndex = state.assets.indexOf(asset);
    const tagCls = asset.tag.startsWith('REVIEWING') ? 'tag tag-review' : 'tag';
    return `
    <div class="asset-card ${asset.selected ? 'selected' : ''}" data-asset-index="${realIndex}" role="button" tabindex="0" aria-selected="${asset.selected}">
      <div class="asset-thumb" aria-hidden="true"></div>
      <div class="asset-copy">
        <b>${asset.name}</b>
        <p>${asset.desc}</p>
        <span class="${tagCls}">${asset.tag}</span>
      </div>
      <div class="asset-stats">
        <b>${asset.score}</b>
        <p>${asset.uses}</p>
      </div>
      <span class="asset-arrow" aria-hidden="true">›</span>
    </div>`;
  }).join('');

  $$('.asset-card').forEach((card) => {
    const activate = () => {
      state.assets.forEach((a) => { a.selected = false; });
      const idx = Number(card.dataset.assetIndex);
      state.assets[idx].selected = true;
      renderAssets($('#assetSearch').value);
      updateSelectedAssetDisplay(idx);
      $('#previewStage')?.setAttribute('data-asset', String(idx));
      toast(`已选择 ${state.assets[idx].name}，镜头预览已切换`);
    };
    card.addEventListener('click', activate);
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } });
  });
}

function updateSelectedAssetDisplay(idx) {
  const asset = state.assets[idx];
  if (!asset) return;
  const sc = $('.selected-copy');
  if (!sc) return;
  sc.querySelector('.tag').textContent = `${asset.tag.replace('PUBLISHED', 'ASSET')} · VERIFIED`;
  sc.querySelector('h3').textContent = asset.name;
  sc.querySelector('p').textContent = asset.desc;
  sc.querySelector('.copy-meta').innerHTML =
    `<span>▧ 8 镜头范围</span><span>◷ ${asset.uses}</span><span>◈ ${asset.score} 质量分</span>`;
}

/* ─── film preview ───────────────────────────────────────────────────────────── */
function installFilmPreview() {
  const panel = $('.shot-panel');
  if (!panel || $('.film-preview')) return;
  const preview = document.createElement('div');
  preview.className = 'film-preview';
  preview.innerHTML = `
    <div class="preview-stage shot-01" id="previewStage" role="img" aria-label="镜头预览">
      <div class="preview-grid-lines" aria-hidden="true"></div>
      <div class="preview-window" aria-hidden="true"></div>
      <div class="preview-light" aria-hidden="true"></div>
      <div class="preview-plant" aria-hidden="true"><i></i><b></b><em></em></div>
      <div class="preview-chair" aria-hidden="true"><i></i><b></b><em></em></div>
      <div class="preview-floor" aria-hidden="true"></div>
      <div class="preview-topline">
        <span class="live-dot"></span>
        <span>LIVE 3D PREVIEW</span>
        <span class="preview-divider"></span>
        <span id="previewShotLabel">SHOT 01 / 03 · WIDE</span>
      </div>
      <div class="preview-caption">
        <span id="previewShotName">门口进入 · 建立空间</span>
        <small id="previewTimecode">00:00.00 — 00:04.00</small>
      </div>
      <button class="preview-play" id="previewPlay" aria-label="播放预览" title="播放 / 暂停 (Space)">▶</button>
      <div class="preview-safe">APPROVED CAMERA RANGE</div>
    </div>
    <div class="preview-controls">
      <div class="preview-timeline" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="6">
        <span class="timeline-current" id="timelineCurrent"></span>
        <i></i><i></i><i></i>
      </div>
      <div class="preview-control-row">
        <span id="previewTime">00:00.00</span>
        <div class="preview-control-actions">
          <button id="prevShot" aria-label="上一个镜头" title="上一个镜头 (←)">‹</button>
          <button id="nextShot" aria-label="下一个镜头" title="下一个镜头 (→)">›</button>
          <span class="preview-resolution">1080 × 1920 · 24fps</span>
          <button id="fullscreenPreview" aria-label="锁定输出比例" title="锁定输出比例">⛶</button>
        </div>
      </div>
    </div>`;
  const selected = panel.querySelector('.selected-asset');
  panel.insertBefore(preview, selected);
  selected.classList.add('compact-asset');
}

const shotData = [
  { name: '门口进入 · 建立空间', time: '00:00.00 — 00:04.00', end: '00:04.00', type: 'WIDE',   cls: 'shot-01' },
  { name: '移向窗边 · 展示细节', time: '00:04.00 — 00:08.00', end: '00:08.00', type: 'MEDIUM', cls: 'shot-02' },
  { name: '回看整体 · 落地关系', time: '00:08.00 — 00:12.00', end: '00:12.00', type: 'WIDE',   cls: 'shot-03' },
];

let playheadRaf;
function updateShot(index) {
  state.activeShot = (index + shotData.length) % shotData.length;
  const shot = shotData[state.activeShot];
  const stage = $('#previewStage');
  if (!stage) return;

  // smooth transition: add swap class, swap class name, remove
  stage.classList.add('shot-swap');
  requestAnimationFrame(() => {
    stage.className = `preview-stage ${shot.cls}`;
    setTimeout(() => stage.classList.remove('shot-swap'), 10);
  });

  $('#previewShotLabel').textContent = `SHOT ${String(state.activeShot + 1).padStart(2, '0')} / 03 · ${shot.type}`;
  $('#previewShotName').textContent = shot.name;
  $('#previewTimecode').textContent = shot.time;
  const pct = (state.activeShot / shotData.length) * 100 + 6;
  const tc = $('#timelineCurrent');
  if (tc) { tc.style.width = `${pct}%`; tc.closest('[role=progressbar]')?.setAttribute('aria-valuenow', Math.round(pct)); }
  if ($('#previewTime')) $('#previewTime').textContent = shot.time.split(' — ')[0];
  $$('.shot-row').forEach((row, i) => row.classList.toggle('active', i === state.activeShot));
}

function startPlayhead() {
  let t = 0;
  const tc = $('#timelineCurrent');
  const timeEl = $('#previewTime');
  const base = state.activeShot / shotData.length;
  const span = 1 / shotData.length;
  cancelAnimationFrame(playheadRaf);
  const tick = () => {
    if (!state.previewPlaying) return;
    t += 1 / 60;
    const pct = (base + (t / 4) * span) * 100;
    if (tc) tc.style.width = `${Math.min(pct + 6, (state.activeShot + 1) / shotData.length * 100)}%`;
    const secs = Math.min(t, 4);
    const baseTime = state.activeShot * 4;
    const display = `${String(Math.floor((baseTime + secs) / 60)).padStart(2, '0')}:${String(Math.floor((baseTime + secs) % 60)).padStart(2, '0')}.${String(Math.floor((secs % 1) * 100)).padStart(2, '0')}`;
    if (timeEl) timeEl.textContent = display;
    playheadRaf = requestAnimationFrame(tick);
  };
  playheadRaf = requestAnimationFrame(tick);
}

function togglePreview() {
  state.previewPlaying = !state.previewPlaying;
  const stage = $('#previewStage');
  const button = $('#previewPlay');
  if (!stage || !button) return;
  stage.classList.toggle('playing', state.previewPlaying);
  button.textContent = state.previewPlaying ? 'Ⅱ' : '▶';
  button.setAttribute('aria-label', state.previewPlaying ? '暂停预览' : '播放预览');
  if (state.previewPlaying) {
    startPlayhead();
    toast('正在播放镜头预览');
    setTimeout(() => {
      state.previewPlaying = false;
      cancelAnimationFrame(playheadRaf);
      stage.classList.remove('playing');
      button.textContent = '▶';
      button.setAttribute('aria-label', '播放预览');
      updateShot(state.activeShot);
    }, 4200);
  } else {
    cancelAnimationFrame(playheadRaf);
    toast('预览已暂停');
  }
}

function bindFilmPreview() {
  installFilmPreview();
  $$('.shot-row').forEach((row, i) => row.addEventListener('click', () => updateShot(i)));
  $('#previewPlay')?.addEventListener('click', togglePreview);
  $('#prevShot')?.addEventListener('click', () => updateShot(state.activeShot - 1));
  $('#nextShot')?.addEventListener('click', () => updateShot(state.activeShot + 1));
  $('#fullscreenPreview')?.addEventListener('click', () => toast('预览画布已锁定为 9:16 输出比例'));
  updateShot(0);
}

/* ─── world journey ─────────────────────────────────────────────────────────── */
const worldStages = [
  { id: 'photo', label: '照片输入',   meta: '1 reference',          icon: '▧', tone: 'photo' },
  { id: 'mesh',  label: '图生 3D',    meta: 'GLB candidate',        icon: '◈', tone: 'mesh'  },
  { id: 'world', label: '世界场景',   meta: 'scale · light · floor', icon: '✦', tone: 'world' },
  { id: 'shot',  label: '镜头计划',   meta: '3 shots · 12 sec',     icon: '◌', tone: 'shot'  },
  { id: 'film',  label: '广告成片',   meta: '1080 × 1920',          icon: '▶', tone: 'film'  },
];

const stageDetails = [
  '等待一张真实物品照片；上传后会生成输入 hash 和质量检查报告。',
  'Hunyuan3D / Object Capture 输出候选网格，保留 provider 与参数版本。',
  '将网格放入有尺度、灯光、地面和接触阴影的世界场景。',
  '把场景拆成可复用镜头，记录景别、时长、相机范围和输出规格。',
  '渲染镜头，合成字幕与配音，得到可交付的竖屏广告片。',
];

function installWorldJourney() {
  const intro = $('.world-intro');
  if (!intro || $('.world-journey')) return;
  const journey = document.createElement('section');
  journey.className = 'world-journey';
  journey.setAttribute('aria-label', '生产链路');
  journey.innerHTML = `
    <div class="journey-head">
      <div><span class="panel-kicker">PRODUCTION GRAPH</span><h3>一条链路，五个可复用产物</h3></div>
      <div class="journey-head-actions">
        <kbd class="shortcut-badge" aria-hidden="true">⌘ ↵</kbd>
        <button class="journey-run" id="runJourney">运行完整链路</button>
      </div>
    </div>
    <div class="journey-track" role="list">
      ${worldStages.map((s, i) => `
        ${i ? '<span class="journey-connector" aria-hidden="true"></span>' : ''}
        <button class="journey-node ${i === 0 ? 'active' : ''}" data-world-stage="${i}" role="listitem" aria-current="${i === 0}">
          <span class="journey-icon ${s.tone}" aria-hidden="true">${s.icon}</span>
          <span class="journey-node-copy"><b>${s.label}</b><small>${s.meta}</small></span>
          <em aria-hidden="true">${String(i + 1).padStart(2, '0')}</em>
        </button>`).join('')}
    </div>
    <div class="journey-detail" id="journeyDetail">
      <span class="journey-detail-icon" aria-hidden="true">▧</span>
      <div>
        <b id="journeyDetailTitle">照片输入</b>
        <small id="journeyDetailText">${stageDetails[0]}</small>
      </div>
      <span class="journey-detail-status" id="journeyDetailStatus">WAITING INPUT</span>
    </div>`;
  intro.insertAdjacentElement('afterend', journey);
  $$('.journey-node').forEach((node) =>
    node.addEventListener('click', () => setWorldStage(Number(node.dataset.worldStage))));
  $('#runJourney')?.addEventListener('click', () => {
    if (!state.upload) { toast('先上传或使用示例照片，再运行完整链路', 'warn'); return; }
    startWorld();
  });
}

function setWorldStage(index, completed = false) {
  const s = worldStages[index] || worldStages[0];
  $$('.journey-node').forEach((node, i) => {
    node.classList.toggle('active', i === index);
    node.classList.toggle('complete', completed || i < index);
    node.setAttribute('aria-current', i === index ? 'true' : 'false');
  });
  // animate connector fill
  $$('.journey-connector').forEach((conn, i) => conn.classList.toggle('filled', i < index));
  const detail = $('#journeyDetail');
  if (detail) {
    detail.querySelector('.journey-detail-icon').textContent = s.icon;
    $('#journeyDetailTitle').textContent = s.label;
    $('#journeyDetailText').textContent = stageDetails[index];
    const statusEl = $('#journeyDetailStatus');
    statusEl.textContent = completed ? 'COMPLETED' : index === 0 ? 'WAITING INPUT' : 'READY';
    statusEl.className = `journey-detail-status ${completed ? 'completed' : ''}`;
  }
}

/* ─── view switching ─────────────────────────────────────────────────────────── */
function switchView(view) {
  state.view = view;
  $$('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === view));
  $$('.view').forEach((item) => item.classList.toggle('active', item.id === `${view}View`));
  $('#crumbTitle').textContent = view === 'library' ? 'Asset to Film' : 'Image to World';
  $('#pageTitle').textContent = view === 'library'
    ? '从一件物品，生成一支可复用的广告'
    : '从一张照片，构建一个可拍摄的世界';
  $('#pageSubtitle').textContent = view === 'library'
    ? '管理真实物品的 3D 版本、世界场景与镜头，让每一次成片都可追溯、可复用。'
    : '让图生 3D 不止停在模型预览：它要进入一个有尺度、有灯光、有镜头的广告世界。';
  window.scrollTo({ top: 0, behavior: 'smooth' });
  persist();
}

/* ─── API ────────────────────────────────────────────────────────────────────── */
async function createJob(workflow, payload) {
  try {
    const res = await fetch('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workflow, ...payload }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch {
    return {
      jobId: `local_${Date.now()}`,
      status: 'completed',
      provider: payload.provider || 'demo',
      message: '本地离线演示已完成。',
    };
  }
}

/* ─── world pipeline stages ──────────────────────────────────────────────────── */
function markStages(onComplete) {
  const stages = $$('.stage');
  stages.forEach((stage, index) => {
    setTimeout(() => {
      stage.classList.add('done');
      stage.querySelector('.stage-index').textContent = '✓';
      stage.querySelector('.stage-state').textContent = index === stages.length - 1 ? '已完成' : '完成';
      stage.querySelector('.stage-state').style.color = '#3caf8c';
      if (index < stages.length - 1) {
        stages[index + 1].classList.add('active');
      } else {
        onComplete?.();
      }
    }, index * 480);
  });
}

function celebrateComplete() {
  // flash the output card green for a moment
  const card = $('.output-card');
  if (card) {
    card.classList.add('celebrate');
    setTimeout(() => card.classList.remove('celebrate'), 1800);
  }
  // update status bar
  setStatusBar('世界场景与广告镜头已生成 · 可继续导出作品包', 'ok');
}

/* ─── upload / sample ────────────────────────────────────────────────────────── */
function setUpload(file, dataUrl = '') {
  state.upload = { name: file?.name || 'sample-chair-reference.jpg', dataUrl };
  const zone = $('#dropzone');
  const fileEl = $('#uploadFile');
  if (fileEl) fileEl.textContent = `✓ ${state.upload.name}`;
  const btn = $('#startWorldButton');
  if (btn) btn.disabled = false;
  if (zone && dataUrl) {
    zone.style.backgroundImage = `linear-gradient(180deg,rgba(251,250,255,.88),rgba(251,250,255,.96)),url(${dataUrl})`;
    zone.style.backgroundSize = 'cover';
    zone.style.backgroundPosition = 'center';
  }
  zone?.classList.add('has-file');
  toast(`已载入 ${state.upload.name}，可以开始生成`);
  setWorldStage(0, true);
}

/* ─── startWorld ─────────────────────────────────────────────────────────────── */
async function startWorld() {
  if (!state.upload) return;
  const button = $('#startWorldButton');
  const originalHTML = button.innerHTML;
  button.disabled = true;
  button.innerHTML = '<span class="spinner"></span>生成中…';
  setStatusBar('图生 3D 链路运行中，请稍候…', 'running');

  const runIdEl = $('#runId');
  const runBarEl = $('#runBar');
  const providerEl = $('#runProvider');
  if (runIdEl) runIdEl.textContent = 'creating job…';
  if (providerEl) providerEl.textContent = $('#providerSelect').selectedOptions[0].textContent.split(' · ')[0];
  if (runBarEl) runBarEl.style.width = '8%';

  const response = await createJob('image-to-world-film', {
    filename: state.upload.name,
    imageData: state.upload.dataUrl || '',
    provider: $('#providerSelect').value,
    scene: 'autumn-apartment',
  });

  if (runIdEl) runIdEl.textContent = response.jobId;

  // persist to recent jobs
  state.recentJobs.unshift({ id: response.jobId, name: state.upload.name, ts: Date.now() });
  persist();

  markStages(celebrateComplete);
  worldStages.forEach((_, i) => setTimeout(() => setWorldStage(i, true), i * 480));
  [22, 45, 68, 86, 100].forEach((pct, i) =>
    setTimeout(() => { if (runBarEl) runBarEl.style.width = `${pct}%`; }, i * 480));

  setTimeout(() => {
    button.disabled = false;
    button.innerHTML = '↻ 重新生成';
    toast(response.status === 'error' ? response.message : '世界场景与广告镜头已生成，可继续导出作品包');
  }, 2600);
}

/* ─── renderAsset ─────────────────────────────────────────────────────────────── */
async function renderAsset() {
  const button = $('#renderAssetButton');
  const original = button.innerHTML;
  button.disabled = true;
  button.innerHTML = '<span class="spinner"></span>排队中…';
  setStatusBar('广告片渲染中…', 'running');

  const selected = state.assets.find((a) => a.selected) || state.assets[0];
  const stage = $('#previewStage');
  if (stage) { stage.classList.add('rendering'); $('#previewShotName').textContent = '正在渲染 3 个镜头…'; }

  const response = await createJob('asset-to-film', {
    filename: selected.name,
    provider: 'blender',
    scene: 'autumn-apartment',
  });

  setTimeout(() => {
    button.disabled = false;
    button.innerHTML = original;
    stage?.classList.remove('rendering');
    updateShot(0);
    setStatusBar(`${selected.name} · 渲染完成`, 'ok');
    toast(`${selected.name} 的 3 个镜头已完成，任务 ${response.jobId}`);
    // update activity panel
    addActivity({ icon: 'green', symbol: '✓', title: `${selected.name} 渲染完成`, time: '刚刚' });
  }, 1400);
}

/* ─── activity panel live update ────────────────────────────────────────────── */
function addActivity({ icon, symbol, title, time }) {
  const list = $('.activity-list');
  if (!list) return;
  const item = document.createElement('div');
  item.innerHTML = `<span class="activity-icon ${icon}">${symbol}</span><p><b>${title}</b><small>${time}</small></p>`;
  item.style.opacity = '0';
  item.style.transform = 'translateY(-6px)';
  list.prepend(item);
  requestAnimationFrame(() => {
    item.style.transition = 'opacity .25s, transform .25s';
    item.style.opacity = '1';
    item.style.transform = 'translateY(0)';
  });
  // keep max 5 items
  while (list.children.length > 5) list.removeChild(list.lastChild);
}

/* ─── export ─────────────────────────────────────────────────────────────────── */
function exportPackage() {
  const manifest = {
    name: 'aigc-asset-studio-demo-package',
    version: '0.1.0',
    generatedAt: new Date().toISOString(),
    workflows: ['asset-to-film', 'image-to-world-film'],
    providerMode: $('#providerSelect')?.value || 'demo',
    recentJobs: state.recentJobs,
    note: 'Local demo manifest. Replace provider output with real model artifacts before production use.',
  };
  const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'asset-studio-manifest.json'; a.click();
  URL.revokeObjectURL(url);
  toast('manifest 已导出，可随作品一起提交');
}

/* ─── keyboard shortcuts ─────────────────────────────────────────────────────── */
function bindKeyboard() {
  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

    // ⌘K / Ctrl+K — toggle view
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      switchView(state.view === 'library' ? 'world' : 'library');
      toast(`已切换到 ${state.view === 'library' ? '资产成片' : '图生世界'} 视图`);
    }
    // ⌘Enter — primary action
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (state.view === 'library') {
        $('#renderAssetButton')?.click();
      } else {
        $('#runJourney')?.click();
      }
    }
    // Arrow keys in film preview
    if (state.view === 'library') {
      if (e.key === 'ArrowLeft')  updateShot(state.activeShot - 1);
      if (e.key === 'ArrowRight') updateShot(state.activeShot + 1);
      if (e.key === ' ') { e.preventDefault(); togglePreview(); }
    }
  });
}

/* ─── shortcut badge: Mac vs Win ─────────────────────────────────────────────── */
function applyPlatformShortcuts() {
  const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
  $$('.shortcut-badge').forEach((el) => {
    el.textContent = isMac ? el.textContent : el.textContent.replace('⌘', 'Ctrl+');
  });
  $$('[data-shortcut]').forEach((el) => {
    el.title = isMac ? el.dataset.shortcut : el.dataset.shortcut.replace('⌘', 'Ctrl+');
  });
}

/* ─── status bar inject ──────────────────────────────────────────────────────── */
function installStatusBar() {
  if ($('#statusBar')) return;
  const bar = document.createElement('div');
  bar.id = 'statusBar';
  bar.setAttribute('role', 'status');
  bar.setAttribute('aria-live', 'polite');
  bar.innerHTML = `
    <div class="status-bar-inner wrap">
      <span class="status-text">初始化中…</span>
      <div class="status-right">
        <span class="status-shortcut" aria-hidden="true">⌘K 切换视图</span>
        <span class="status-shortcut" aria-hidden="true">⌘↵ 执行操作</span>
        <a href="https://github.com/Baolin-yang" target="_blank" rel="noopener" class="status-link">GitHub ↗</a>
      </div>
    </div>`;
  document.querySelector('.app-shell')?.appendChild(bar);
}

/* ─── dragover highlight ─────────────────────────────────────────────────────── */
function bindDropzone() {
  const zone = $('#dropzone');
  if (!zone) return;
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file?.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => setUpload(file, reader.result);
      reader.readAsDataURL(file);
    } else {
      toast('请上传 PNG 或 JPG 格式的图片', 'warn');
    }
  });
}

/* ─── init ───────────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  restore();
  installStatusBar();
  renderAssets();
  bindFilmPreview();
  installWorldJourney();
  applyPlatformShortcuts();
  bindKeyboard();
  bindDropzone();

  // nav
  $$('.nav-item').forEach((item) => item.addEventListener('click', () => switchView(item.dataset.view)));
  if (state.view !== 'library') switchView(state.view);

  // search
  $('#assetSearch')?.addEventListener('input', (e) => renderAssets(e.target.value));

  // topbar actions
  $('#renderAssetButton')?.addEventListener('click', renderAsset);
  $('#exportButton')?.addEventListener('click', exportPackage);
  $('#newProjectButton')?.addEventListener('click', () => { switchView('world'); toast('已创建新的图生 3D 项目'); });
  $('#addAssetButton')?.addEventListener('click', () => { switchView('world'); toast('上传一张照片即可创建新资产候选'); });
  $('#addShotButton')?.addEventListener('click', () => toast('镜头模板已打开：可添加 Wide、Medium 或 Detail 镜头'));

  // file input
  $('#fileInput')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setUpload(file, reader.result);
    reader.readAsDataURL(file);
  });

  // sample / world
  $('#sampleButton')?.addEventListener('click', () => setUpload(null));
  $('#startWorldButton')?.addEventListener('click', startWorld);

  // provider select
  $('#providerSelect')?.addEventListener('change', () => {
    const val = $('#providerSelect').value;
    const label = $('#providerSelect').selectedOptions[0]?.textContent.split(' · ')[0];
    if (val !== 'demo') toast(`已切换到 ${label}，确保本地服务已启动`);
  });

  // health check
  $('#healthCheck')?.addEventListener('click', () => checkHealth(false));
  checkHealth(true);
  setInterval(() => checkHealth(true), HEALTH_INTERVAL);

  // initial status
  setStatusBar('工作台已就绪 · 选择资产或上传照片开始');
});
