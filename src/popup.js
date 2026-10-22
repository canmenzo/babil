import { loadSettings, langName, isCached, MODELS, SOURCE_LANGS, TARGET_LANGS } from './settings.js';

const $ = (id) => document.getElementById(id);
let state = {};
const firefox = FIREFOX_BUILD;
let translationEnabled = false;

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
    ...(firefox && state.running && !translationEnabled ? [(() => {
      const div = document.createElement('div');
      div.className = 'pair';
      const text = document.createElement('span');
      text.className = 'small';
      text.textContent = 'Firefox needs an additional offline translation model (about 1 GB). Video audio and captions stay on this device.';
      const button = document.createElement('button');
      button.textContent = 'Download translation model';
      button.onclick = async () => {
        translationEnabled = true;
        render();
        await bg({ type: 'translation-enable' });
      };
      div.append(text, button);
      return div;
    })()] : []),
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
    if (FIREFOX_BUILD) {
      await bg({ type: 'start', tabId: tab.id });
    } else {
      const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
      await bg({ type: 'start', tabId: tab.id, streamId });
    }
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
$('tts').onchange = () => chrome.storage.local.set({ tts: $('tts').checked });
$('cues').onchange = () => chrome.storage.local.set({ cues: Number($('cues').value) });

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.state) {
    const wasLoading = state.status?.state === 'loading';
    state = changes.state.newValue ?? {};
    if (wasLoading && state.status?.state !== 'loading') modelHint();
    render();
  }
});

// Unpacked installs never update on their own, so the popup checks GitHub releases.
const version = chrome.runtime.getManifest().version;
const newer = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number));
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};

async function checkUpdate(force) {
  let { update } = await chrome.storage.local.get('update');
  if (force || !update || Date.now() - update.checked > 6 * 3600e3) {
    const r = await fetch('https://api.github.com/repos/canmenzo/babil/releases/latest');
    if (!r.ok) throw new Error(`GitHub ${r.status}`);
    const rel = await r.json();
    update = {
      checked: Date.now(),
      version: rel.tag_name.replace(/^v/, ''),
      zip: rel.assets.find((a) => a.name.endsWith('.zip'))?.browser_download_url ?? rel.html_url,
      notes: rel.html_url,
    };
    await chrome.storage.local.set({ update });
  }
  const available = newer(update.version, version);
  $('update').hidden = !available;
  if (available) {
    $('updateTitle').textContent = `Yeni sürüm çıktı: v${update.version}`;
    const safe = (url) => (typeof url === 'string' && url.startsWith('https://github.com/') ? url : 'https://github.com/canmenzo/babil/releases');
    $('updateZip').href = safe(update.zip);
    $('updateNotes').href = safe(update.notes);
  }
  return available;
}

$('version').textContent = `v${version}`;
$('updateReload').onclick = () => chrome.runtime.reload();
$('checkUpdate').onclick = async (e) => {
  e.preventDefault();
  const link = e.target;
  link.textContent = 'Denetleniyor...';
  try {
    link.textContent = (await checkUpdate(true)) ? 'Güncelleme var' : 'Güncelsin';
  } catch {
    link.textContent = 'Denetlenemedi, tekrar dene';
  }
};
checkUpdate(false).catch(() => {});

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
$('tts').checked = s.tts;
$('cues').value = s.cues;
modelHint();
state = (await chrome.storage.session.get('state')).state ?? {};
translationEnabled = (await chrome.storage.local.get('firefoxTranslationEnabled')).firefoxTranslationEnabled ?? false;
render();
