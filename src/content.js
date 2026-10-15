import { loadSettings, captionCss } from './settings.js';

// Re-injection on every start is expected; the first instance keeps listening.
if (!window.__canliAltyazi) {
  window.__canliAltyazi = true;
  init();
}

async function init() {
  let s = await loadSettings();

  const host = document.createElement('div');
  // A manual popover lives in the top layer, so it stays visible over fullscreen players too.
  host.popover = 'manual';
  for (const [k, v] of Object.entries({
    position: 'fixed',
    inset: 'auto',
    margin: '0',
    padding: '0',
    border: 'none',
    background: 'transparent',
    overflow: 'visible',
    width: 'auto',
    height: 'auto',
    'pointer-events': 'none',
    'z-index': '2147483647',
  })) {
    host.style.setProperty(k, v, 'important');
  }
  const root = host.attachShadow({ mode: 'closed' });
  const theme = document.createElement('style');
  const base = document.createElement('style');
  base.textContent = `
    .box { display: flex; flex-direction: column; align-items: center; pointer-events: auto; cursor: grab; user-select: none; }
    .box.dragging { cursor: grabbing; }
    .status { font: 13px/1.4 system-ui, sans-serif; color: #fff; background: rgba(20,20,20,.85); padding: 4px 10px; border-radius: 999px; margin-bottom: 6px; }
    .status:empty { display: none; }
    .cue.leaving { opacity: 0; transition: opacity .25s; }`;
  const box = document.createElement('div');
  box.className = 'box';
  const statusEl = document.createElement('div');
  statusEl.className = 'status';
  box.append(statusEl);
  root.append(base, theme, box);
  document.documentElement.append(host);

  const cues = new Map(); // caption id -> { el, tr, orig, timer }
  let statusTimer;

  function applyTheme() {
    theme.textContent = captionCss(s);
  }
  applyTheme();

  function show() {
    if (!host.isConnected) document.documentElement.append(host);
    if (!host.matches(':popover-open')) host.showPopover();
  }

  function setStatus(text, ttl) {
    statusEl.textContent = text || '';
    clearTimeout(statusTimer);
    if (ttl) statusTimer = setTimeout(() => (statusEl.textContent = ''), ttl);
  }

  function removeCue(id) {
    const c = cues.get(id);
    if (!c) return;
    cues.delete(id);
    clearTimeout(c.timer);
    c.el.classList.add('leaving');
    setTimeout(() => c.el.remove(), 250);
  }

  function onCaption(m) {
    if (m.remove) return removeCue(m.id);
    let c = cues.get(m.id);
    if (!c) {
      const el = document.createElement('div');
      el.className = 'cue';
      const tr = document.createElement('div');
      tr.className = 'tr';
      const orig = document.createElement('div');
      orig.className = 'orig';
      tr.append(document.createElement('span'));
      orig.append(document.createElement('span'));
      el.append(tr, orig);
      box.append(el);
      c = { el, tr, orig, final: false };
      cues.set(m.id, c);
      // Oldest captions go first once the limit is reached.
      for (const id of [...cues.keys()].slice(0, Math.max(0, cues.size - s.cues))) removeCue(id);
    }
    if (c.final && !m.final) return;
    c.orig.firstChild.textContent = m.original;
    // Keep the previous translation until the new one arrives so the line does not flicker.
    if (m.translated) c.tr.firstChild.textContent = m.translated;
    c.tr.style.display = c.tr.firstChild.textContent ? '' : 'none';
    // Turkish source: the two lines would be identical.
    c.orig.style.visibility = m.language === 'tr' ? 'hidden' : '';
    c.orig.style.height = m.language === 'tr' ? '0' : '';
    if (m.final) {
      c.final = true;
      clearTimeout(c.timer);
      c.timer = setTimeout(() => removeCue(m.id), s.hold * 1000);
    }
    show();
    place();
  }

  // --- Placement over the largest visible video ---

  function targetRect() {
    const fs = document.fullscreenElement;
    if (fs) return fs.getBoundingClientRect();
    let best = null;
    let bestArea = 200 * 120;
    for (const v of document.querySelectorAll('video')) {
      const r = v.getBoundingClientRect();
      const w = Math.min(r.right, innerWidth) - Math.max(r.left, 0);
      const h = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
      if (w > 0 && h > 0 && w * h > bestArea) {
        best = r;
        bestArea = w * h;
      }
    }
    return best ?? new DOMRect(0, 0, innerWidth, innerHeight);
  }

  let dragOffset = null;
  function place() {
    const r = targetRect();
    const pos = dragOffset ?? s.position;
    const scale = s.scaleWithVideo ? Math.min(2, Math.max(0.5, r.height / 640)) : 1;
    const bottom = Math.max(0, innerHeight - Math.min(r.bottom, innerHeight)) + (r.height * pos) / 100;
    host.style.setProperty('left', `${r.left + r.width / 2}px`, 'important');
    host.style.setProperty('bottom', `${bottom}px`, 'important');
    host.style.setProperty('transform', 'translateX(-50%)', 'important');
    host.style.setProperty('width', `${Math.round(r.width * 0.9)}px`, 'important');
    box.style.setProperty('--scale', scale);
  }

  setInterval(() => cues.size && place(), 300);
  addEventListener('resize', place);
  document.addEventListener('fullscreenchange', () => {
    // Re-open so the popover is stacked above the element that just entered the top layer.
    if (host.matches(':popover-open')) {
      host.hidePopover();
      host.showPopover();
    }
    place();
  });

  // Vertical drag moves the captions; the new position is saved for every site.
  box.addEventListener('pointerdown', (e) => {
    const r = targetRect();
    const startY = e.clientY;
    const startPos = s.position;
    box.setPointerCapture(e.pointerId);
    box.classList.add('dragging');
    const move = (ev) => {
      dragOffset = Math.min(85, Math.max(0, startPos + ((startY - ev.clientY) / r.height) * 100));
      place();
    };
    const up = () => {
      box.removeEventListener('pointermove', move);
      box.classList.remove('dragging');
      if (dragOffset != null) chrome.storage.local.set({ position: Math.round(dragOffset * 10) / 10 });
    };
    box.addEventListener('pointermove', move);
    box.addEventListener('pointerup', up, { once: true });
  });

  chrome.storage.onChanged.addListener(async (_changes, area) => {
    if (area !== 'local') return;
    s = await loadSettings();
    dragOffset = null;
    applyTheme();
    place();
  });

  chrome.runtime.onMessage.addListener((m) => {
    if (m.type === 'caption') onCaption(m);
    else if (m.type === 'status') {
      show();
      place();
      if (m.state === 'loading') setStatus(m.text);
      else if (m.state === 'running') setStatus(m.text, 2500);
      else setStatus(m.text, 5000);
    } else if (m.type === 'clear') {
      for (const id of [...cues.keys()]) removeCue(id);
      setStatus('');
      if (host.matches(':popover-open')) host.hidePopover();
    }
  });
}
