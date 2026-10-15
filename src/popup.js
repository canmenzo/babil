import { loadSettings, langName, isCached, MODELS, SOURCE_LANGS, TARGET_LANGS } from './settings.js';

const $ = (id) => document.getElementById(id);
let state = {};

function bg(msg) {
  return chrome.runtime.sendMessage({ target: 'bg', ...msg });
}

function render() {
  const st = state.status;
  $('status').textContent = st?.text ?? 'Hazır';
  $('status').className = `status ${st?.state ?? ''}`;
  const showBar = st?.state === 'loading' && st.progress != null;
  $('bar').hidden = !showBar;
  if (showBar) $('bar').firstElementChild.style.width = `${st.progress}%`;
  $('latency').textContent = state.running && state.asrMs ? `Tanıma süresi: ${state.asrMs} ms` : '';
  $('toggle').textContent = state.running ? 'Durdur' : 'Altyazıyı başlat';
  $('toggle').classList.toggle('stop', !!state.running);

  $('pairs').replaceChildren(
    ...(state.needPairs ?? []).map((src) => {
      const div = document.createElement('div');
      div.className = 'pair';
      div.innerHTML = `<span class="small"></span><button></button>`;
      div.firstChild.textContent = `${langName(src)} konuşma algılandı. Çeviri için Chrome'un çeviri modeli gerekiyor.`;
      div.lastChild.textContent = `${langName(src)} → ${langName(state.target)} modelini indir`;
      div.lastChild.onclick = () => ensurePair(src, state.target, div.lastChild);
      return div;
    }),
  );
}

// Translator.create needs a user click when the model is not on disk yet, and only the popup gets clicks.
async function ensurePair(src, target, button) {
  if (src === target || !('Translator' in self)) return;
  try {
    const avail = await Translator.availability({ sourceLanguage: src, targetLanguage: target });
    if (avail === 'available' || avail === 'unavailable') return;
    const t = await Translator.create({
      sourceLanguage: src,
      targetLanguage: target,
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
          if (button) button.textContent = `İndiriliyor %${Math.round(e.loaded * 100)}`;
        });
      },
    });
    t.destroy();
    bg({ type: 'pair-ready', source: src });
  } catch (e) {
    if (button) button.textContent = `Hata: ${e.message}`;
  }
}

// With auto-detect, English is the best guess (Spanish when translating into English).
function likelySource() {
  const source = $('source').value;
  return source === 'auto' ? ($('target').value === 'en' ? 'es' : 'en') : source;
}

$('toggle').onclick = async () => {
  if (state.running) return bg({ type: 'stop' });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  // Fire-and-forget: the click's activation is consumed by create(), the download continues on its own.
  ensurePair(likelySource(), $('target').value);
  try {
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
    await bg({ type: 'start', tabId: tab.id, streamId });
  } catch (e) {
    $('status').textContent = `Başlatılamadı: ${e.message}`;
    $('status').className = 'status error';
  }
};

$('openOptions').onclick = (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
};

// Changes apply to running captions right away (background.js forwards them).
for (const id of ['source', 'target', 'model']) {
  $(id).onchange = () => {
    chrome.storage.local.set({ [id]: $(id).value });
    if (id === 'model') modelHint();
    // This change event is a user click, so a missing translation model can start downloading now.
    else if (state.running) ensurePair(likelySource(), $('target').value);
  };
}

const autoModel = navigator.gpu?.requestAdapter().then((a) => (a ? 'small' : 'base')) ?? Promise.resolve('base');
async function modelHint() {
  const choice = $('model').value;
  const model = choice === 'auto' ? await autoModel : choice;
  const which = choice === 'auto' ? `Bu bilgisayar için: ${MODELS[model].name}. ` : '';
  const disk = (await isCached(model)) ? 'İndirildi, diskten açılır.' : `İlk başlatmada bir kez indirilir (${MODELS[model].size}).`;
  $('modelHint').textContent = `${which}${disk} Altyazı hızı hepsinde aynı; büyük model daha az hata yapar ama bilgisayarı daha çok yorar.`;
}
$('showOriginal').onchange = () => chrome.storage.local.set({ showOriginal: $('showOriginal').checked });
$('cues').onchange = () => chrome.storage.local.set({ cues: Number($('cues').value) });

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.state) {
    const wasLoading = state.status?.state === 'loading';
    state = changes.state.newValue ?? {};
    if (wasLoading && state.status?.state !== 'loading') modelHint();
    render();
  }
});

function fillLangs(select, codes) {
  select.append(...codes.map((c) => new Option(langName(c), c)));
}
$('source').append(new Option('Otomatik algıla', 'auto'));
fillLangs($('source'), SOURCE_LANGS);
fillLangs($('target'), TARGET_LANGS);
$('model').append(
  new Option('Otomatik (önerilen)', 'auto'),
  ...Object.entries(MODELS).map(([k, m]) => new Option(`${m.name} (${m.size})`, k)),
);

const s = await loadSettings();
$('source').value = s.source;
$('target').value = s.target;
$('model').value = s.model;
$('showOriginal').checked = s.showOriginal;
$('cues').value = s.cues;
modelHint();
state = (await chrome.storage.session.get('state')).state ?? {};
render();
