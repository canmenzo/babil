import { loadSettings, langName, isCached, i18n, localize, MODELS, SOURCE_LANGS, TARGET_LANGS } from './settings.js';
import { PERSONAS } from './speech.js';

const $ = (id) => document.getElementById(id);
localize();
let state = {};
const firefox = FIREFOX_BUILD;
let translationEnabled = false;

function bg(msg) {
  return chrome.runtime.sendMessage({ target: 'bg', ...msg });
}

function render() {
  const st = state.status;
  $('status').textContent = st?.text ?? i18n('status_ready');
  $('status').className = `status ${st?.state ?? ''}`;
  const showBar = st?.state === 'loading' && st.progress != null;
  $('bar').hidden = !showBar;
  if (showBar) $('bar').firstElementChild.style.width = `${st.progress}%`;
  $('latency').textContent = state.running && state.asrMs ? i18n('latency', state.asrMs) : '';
  $('toggle').textContent = i18n(state.running ? 'stop' : 'start');
  $('toggle').classList.toggle('stop', !!state.running);

  $('pairs').replaceChildren(
    ...(firefox && state.running && !translationEnabled ? [(() => {
      const div = document.createElement('div');
      div.className = 'pair';
      const text = document.createElement('span');
      text.className = 'small';
      text.textContent = i18n('ff_translation_hint');
      const button = document.createElement('button');
      button.textContent = i18n('ff_translation_download');
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
      div.firstChild.textContent = i18n('pair_detected', langName(src));
      div.lastChild.textContent = i18n('pair_download', langName(src), langName(state.target));
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
          if (button) button.textContent = i18n('downloading_pct', Math.round(e.loaded * 100));
        });
      },
    });
    t.destroy();
    bg({ type: 'pair-ready', source: src });
  } catch (e) {
    if (button) button.textContent = i18n('error_detail', e.message);
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
    $('status').textContent = i18n('start_failed', e.message);
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
  const which = choice === 'auto' ? i18n('model_auto_pick', i18n(`model_${model}`)) : '';
  const disk = (await isCached(model)) ? i18n('model_cached') : i18n('model_download_once', MODELS[model].size);
  $('modelHint').textContent = [which, disk, i18n('model_speed_note')].filter(Boolean).join(' ');
}
$('showOriginal').onchange = () => chrome.storage.local.set({ showOriginal: $('showOriginal').checked });
$('tts').onchange = () => {
  $('personaField').hidden = !$('tts').checked;
  chrome.storage.local.set({ tts: $('tts').checked });
};
$('ttsPersona').onchange = () => chrome.storage.local.set({ ttsPersona: $('ttsPersona').value });
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
    $('updateTitle').textContent = i18n('update_title', update.version);
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
  link.textContent = i18n('checking');
  try {
    link.textContent = i18n((await checkUpdate(true)) ? 'update_available' : 'up_to_date');
  } catch {
    link.textContent = i18n('check_failed');
  }
};
checkUpdate(false).catch(() => {});

function fillLangs(select, codes) {
  select.append(...codes.map((c) => new Option(langName(c), c)));
}
$('source').append(new Option(i18n('auto_detect'), 'auto'));
fillLangs($('source'), SOURCE_LANGS);
fillLangs($('target'), TARGET_LANGS);
$('model').append(
  new Option(i18n('model_auto'), 'auto'),
  ...Object.entries(MODELS).map(([k, m]) => new Option(`${i18n(`model_${k}`)} (${m.size})`, k)),
);
$('ttsPersona').append(...Object.keys(PERSONAS).map((k) => new Option(`${i18n(`persona_${k}_name`)} · ${i18n(`persona_${k}_desc`)}`, k)));
$('cues').append(...[1, 2, 3, 4, 5, 6].map((n) => new Option(n === 1 ? i18n('cues_last') : i18n('cues_last_n', n), n)));

const s = await loadSettings();
$('source').value = s.source;
$('target').value = s.target;
$('model').value = s.model;
$('showOriginal').checked = s.showOriginal;
$('tts').checked = s.tts;
$('ttsPersona').value = s.ttsPersona;
$('personaField').hidden = !s.tts;
$('cues').value = s.cues;
modelHint();
state = (await chrome.storage.session.get('state')).state ?? {};
translationEnabled = (await chrome.storage.local.get('firefoxTranslationEnabled')).firefoxTranslationEnabled ?? false;
render();
