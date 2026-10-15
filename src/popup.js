import { loadSettings } from './settings.js';

const $ = (id) => document.getElementById(id);
const langName = new Intl.DisplayNames(['tr'], { type: 'language' });
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
      div.firstChild.textContent = `${langName.of(src)} konuşma algılandı. Türkçe çeviri için Chrome'un çeviri modeli gerekiyor.`;
      div.lastChild.textContent = `${langName.of(src)} → Türkçe modelini indir`;
      div.lastChild.onclick = () => ensurePair(src, div.lastChild);
      return div;
    }),
  );
}

// Translator.create needs a user click when the model is not on disk yet, and only the popup gets clicks.
async function ensurePair(src, button) {
  if (src === 'tr' || !('Translator' in self)) return;
  try {
    const avail = await Translator.availability({ sourceLanguage: src, targetLanguage: 'tr' });
    if (avail === 'available' || avail === 'unavailable') return;
    const t = await Translator.create({
      sourceLanguage: src,
      targetLanguage: 'tr',
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

$('toggle').onclick = async () => {
  if (state.running) return bg({ type: 'stop' });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const source = $('source').value;
  // Fire-and-forget: the click's activation is consumed by create(), the download continues on its own.
  ensurePair(source === 'auto' ? 'en' : source);
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

for (const id of ['source', 'model']) {
  $(id).onchange = () => {
    chrome.storage.local.set({ [id]: $(id).value });
    $('restartHint').hidden = !state.running;
  };
}
$('showOriginal').onchange = () => chrome.storage.local.set({ showOriginal: $('showOriginal').checked });

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.state) {
    state = changes.state.newValue ?? {};
    render();
  }
});

const s = await loadSettings();
$('source').value = s.source;
$('model').value = s.model;
$('showOriginal').checked = s.showOriginal;
state = (await chrome.storage.session.get('state')).state ?? {};
render();
