import { DEFAULTS, FONTS, EDGES, SOURCE_LANGS, TARGET_LANGS, langName, loadSettings, captionCss } from './settings.js';

let s = await loadSettings();

const SAMPLE = [
  { trans: 'Bunu gerçekten yapacağımı düşünmedin, değil mi?', orig: "You didn't really think I'd do that, did you?" },
  { trans: 'Tamam, bir sonraki tura geçiyoruz.', orig: "Alright, we're moving on to the next round." },
];

function options(select, map) {
  select.replaceChildren(
    ...Object.entries(map).map(([value, { label }]) => Object.assign(document.createElement('option'), { value, textContent: label })),
  );
}

function trackControls(track) {
  const card = document.querySelector(`[data-track="${track}"]`);
  card.insertAdjacentHTML(
    'beforeend',
    `<label class="field">Font <select data-key="${track}.font"></select></label>
     <label class="field">Yazı boyutu (px) <span class="range"><input type="range" min="12" max="64" step="1" data-key="${track}.size"><output></output></span></label>
     <label class="check"><input type="checkbox" data-key="${track}.bold"> Kalın</label>
     <div class="colors">
       <label class="field">Yazı rengi <input type="color" data-key="${track}.color"></label>
       <label class="field">Arka plan rengi <input type="color" data-key="${track}.bg"></label>
     </div>
     <label class="field">Arka plan opaklığı <span class="range"><input type="range" min="0" max="1" step="0.05" data-key="${track}.bgOpacity"><output></output></span></label>`,
  );
  options(card.querySelector('select'), FONTS);
}

trackControls('trans');
trackControls('orig');
options(document.querySelector('[data-key="edge"]'), EDGES);
const sourceSelect = document.querySelector('[data-key="source"]');
sourceSelect.append(new Option('Otomatik algıla', 'auto'), ...SOURCE_LANGS.map((c) => new Option(langName(c), c)));
document.querySelector('[data-key="target"]').append(...TARGET_LANGS.map((c) => new Option(langName(c), c)));

const inputs = [...document.querySelectorAll('[data-key]')];

function get(key) {
  return key.split('.').reduce((o, k) => o[k], s);
}

function fill() {
  for (const el of inputs) {
    const v = get(el.dataset.key);
    if (el.type === 'checkbox') el.checked = v;
    else el.value = v;
    const out = el.parentElement.querySelector('output');
    if (out) out.textContent = el.dataset.key.endsWith('bgOpacity') ? `%${Math.round(v * 100)}` : v;
  }
}

function preview() {
  const box = document.getElementById('previewBox');
  const height = document.getElementById('preview').clientHeight;
  const scale = s.scaleWithVideo ? Math.min(2, Math.max(0.5, height / 640)) : 1;
  box.style.setProperty('--scale', scale);
  box.style.bottom = `${(height * s.position) / 100}px`;
  let style = document.getElementById('captionStyle');
  if (!style) {
    style = document.createElement('style');
    style.id = 'captionStyle';
    document.head.append(style);
  }
  style.textContent = captionCss(s);
  box.replaceChildren(
    ...SAMPLE.slice(-s.cues).map(({ trans, orig }) => {
      const cue = document.createElement('div');
      cue.className = 'cue';
      for (const [cls, text] of [['trans', trans], ['orig', orig]]) {
        const line = document.createElement('div');
        line.className = cls;
        line.append(Object.assign(document.createElement('span'), { textContent: text }));
        cue.append(line);
      }
      return cue;
    }),
  );
}

for (const el of inputs) {
  el.addEventListener('input', () => {
    const path = el.dataset.key.split('.');
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (el.type === 'range') v = Number(v);
    if (path.length === 2) s[path[0]] = { ...s[path[0]], [path[1]]: v };
    else s[path[0]] = v;
    fill();
    preview();
    chrome.storage.local.set({ [path[0]]: s[path[0]] });
  });
}

function progress(which, pct, text) {
  document.getElementById(`${which}Bar`).style.width = `${pct}%`;
  document.getElementById(`${which}Text`).textContent = text;
}

// Same downloads the first caption run would do, so they land in this origin's cache ahead of time.
document.getElementById('prepare').onclick = async (e) => {
  const button = e.currentTarget;
  button.disabled = true;
  const src = s.source === 'auto' ? (s.target === 'en' ? 'es' : 'en') : s.source;

  // Translator first: create() must run while this click still counts as user activation.
  const translation = (async () => {
    if (src === s.target) return progress('tr', 100, 'Gerekmiyor');
    if (!('Translator' in self)) return progress('tr', 0, 'Chrome 138+ gerekli');
    try {
      const t = await Translator.create({
        sourceLanguage: src,
        targetLanguage: s.target,
        monitor(m) {
          m.addEventListener('downloadprogress', (ev) => progress('tr', ev.loaded * 100, `%${Math.round(ev.loaded * 100)}`));
        },
      });
      t.destroy();
      progress('tr', 100, `${langName(src)} → ${langName(s.target)} hazır`);
    } catch (err) {
      progress('tr', 0, `Hata: ${err.message}`);
    }
  })();

  const recognition = new Promise((resolve) => {
    const w = new Worker('asr-worker.js', { type: 'module' });
    w.onmessage = ({ data }) => {
      if (data.type === 'progress') progress('asr', data.progress, `%${Math.round(data.progress)}`);
      if (data.type === 'ready') progress('asr', 100, `Whisper ${data.model} hazır (${data.device === 'webgpu' ? 'GPU' : 'CPU'})`);
      if (data.type === 'error') progress('asr', 0, `Hata: ${data.message}`);
      if (data.type === 'ready' || data.type === 'error') {
        w.terminate();
        resolve();
      }
    };
    w.postMessage({ type: 'load', model: s.model });
  });

  await Promise.all([translation, recognition]);
  button.disabled = false;
};

document.getElementById('reset').onclick = async () => {
  const { model, source, target, ...look } = DEFAULTS;
  await chrome.storage.local.set(look);
  s = await loadSettings();
  fill();
  preview();
};

// Dragging the captions on a video changes the position from another context.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === 'local' && changes.position) {
    s = await loadSettings();
    fill();
    preview();
  }
});

addEventListener('resize', preview);
fill();
preview();
