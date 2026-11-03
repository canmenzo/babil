import { loadSettings, langName, isCached, deleteModel, modelDevice, autoModel, modelSize, i18n, localize, MODELS, SOURCE_LANGS, TARGET_LANGS } from './settings.js';
import { ICONS } from './icons.js';
import { PERSONAS, listVoices, resolveVoice, voiceStatus } from './speech.js';
import { resolveNeural, watchPacks } from './tts/catalog.js';

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

  renderModels();

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
for (const id of ['source', 'target']) {
  $(id).onchange = () => {
    chrome.storage.local.set({ [id]: $(id).value });
    if (id === 'target') ttsHint();
    autoPick = autoModel(device, $('source').value);
    renderModels();
    // This change event is a user click, so a missing translation model can start downloading now.
    if (state.running) ensurePair(likelySource(), $('target').value);
  };
}

// The model picker. A model that is on disk can be chosen, one that is not offers its download.
let chosenModel = 'auto';
let autoPick = 'base';
let device = 'wasm';
let listOpen = false;
let confirming = null; // the model whose delete question is showing
let rendered = '';
const cached = {};
const justDone = new Set();

const inUse = (k) => state.running && k === (chosenModel === 'auto' ? autoPick : chosenModel);

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

function iconButton(icon, label, onclick, className = '') {
  const b = el('button', `model-action ${className}`);
  b.type = 'button';
  b.innerHTML = icon;
  b.title = label;
  b.setAttribute('aria-label', label);
  b.onclick = onclick;
  return b;
}

function chooseModel(k) {
  chosenModel = k;
  listOpen = false;
  chrome.storage.local.set({ model: k });
  renderModels();
}

async function removeModel(k) {
  await deleteModel(k);
  cached[k] = false;
  confirming = null;
  if (chosenModel === k) chooseModel('auto');
  renderModels();
}

function confirmRow(k) {
  const row = el('div', 'model confirm');
  row.append(el('div', 'model-question', i18n('model_delete_confirm')));
  const buttons = el('div', 'model-buttons');
  const keep = el('button', '', i18n('model_keep'));
  keep.onclick = () => {
    confirming = null;
    renderModels();
  };
  const del = el('button', 'danger', i18n('model_delete'));
  del.onclick = () => removeModel(k);
  buttons.append(keep, del);
  row.append(buttons);
  return row;
}

function modelMeta(k, busy) {
  if (state.modelError?.model === k) return i18n('model_download_failed', state.modelError.message);
  if (k === 'auto') {
    const disk = cached[autoPick] ? i18n('model_cached') : i18n('model_download_once', modelSize(autoPick, device));
    return `${i18n('model_auto_pick', i18n(`model_${autoPick}`))} ${disk}`;
  }
  if (busy) return `${modelSize(k, device)} · ${i18n('downloading_pct', state.downloads[k])}`;
  return `${modelSize(k, device)}${cached[k] ? ` · ${i18n('model_downloaded')}` : ''}`;
}

function modelRow(k) {
  if (confirming === k) return confirmRow(k);
  const busy = state.downloads?.[k] != null;
  const ready = k === 'auto' || cached[k];
  const row = el('div', `model${k === chosenModel ? ' selected' : ''}`);
  const main = el('button', 'model-main');
  main.type = 'button';
  main.disabled = busy;
  main.onclick = () => (ready ? chooseModel(k) : bg({ type: 'model-download', model: k }));
  const text = el('span', 'model-text');
  text.append(el('span', 'model-name', i18n(k === 'auto' ? 'model_auto' : `model_${k}`)));
  text.append(el('span', `model-meta${state.modelError?.model === k ? ' failed' : ''}`, modelMeta(k, busy)));
  main.append(el('span', 'model-dot'), text);
  row.append(main);
  if (k === 'auto') return row;
  if (busy) {
    const b = iconButton(`<svg class="ring" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><circle class="fill" cx="12" cy="12" r="10" pathLength="100"/></svg>${ICONS.x}`, i18n('model_cancel_download'), () => bg({ type: 'model-cancel', model: k }), 'busy');
    b.dataset.model = k;
    row.append(b);
  } else if (cached[k]) {
    const label = inUse(k) ? i18n('model_in_use') : i18n('model_delete');
    const b = iconButton(`${ICONS.check}${ICONS.trash}`, label, () => {
      confirming = k;
      renderModels();
    }, `done${justDone.has(k) ? ' pop' : ''}`);
    b.disabled = inUse(k);
    row.append(b);
  } else {
    row.append(iconButton(ICONS.download, i18n('model_download'), () => bg({ type: 'model-download', model: k })));
  }
  return row;
}

// Rows are rebuilt only when something other than a percentage changed, so hover and animation survive.
function renderModels() {
  const downloads = state.downloads ?? {};
  const key = JSON.stringify([chosenModel, autoPick, listOpen, confirming, cached, Object.keys(downloads), state.modelError, !!state.running]);
  if (key !== rendered) {
    rendered = key;
    const shown = chosenModel === 'auto' ? autoPick : chosenModel;
    $('modelName').textContent = i18n(chosenModel === 'auto' ? 'model_auto' : `model_${chosenModel}`);
    $('modelState').innerHTML = cached[shown] ? ICONS.check : '';
    $('modelState').title = cached[shown] ? i18n('model_downloaded') : '';
    $('modelToggle').setAttribute('aria-expanded', listOpen);
    $('modelList').hidden = !listOpen;
    $('modelRows').replaceChildren(...['auto', ...Object.keys(MODELS)].map(modelRow));
    justDone.clear();
  }
  for (const b of $('modelRows').querySelectorAll('[data-model]')) {
    const pct = downloads[b.dataset.model] ?? 0;
    b.querySelector('.fill').style.strokeDasharray = `${pct} 100`;
    b.previousElementSibling.querySelector('.model-meta').textContent = modelMeta(b.dataset.model, true);
  }
}

async function refreshCached() {
  for (const k of Object.keys(MODELS)) cached[k] = await isCached(k);
  renderModels();
}

$('modelToggle').onclick = () => {
  listOpen = !listOpen;
  confirming = null;
  renderModels();
};

$('showOriginal').onchange = () => chrome.storage.local.set({ showOriginal: $('showOriginal').checked });
$('tts').onchange = () => {
  $('personaField').hidden = $('ttsHint').hidden = !$('tts').checked;
  chrome.storage.local.set({ tts: $('tts').checked });
};
$('ttsPersona').onchange = () => {
  chrome.storage.local.set({ ttsPersona: $('ttsPersona').value });
  ttsHint();
};

// Whether the chosen persona's voice is downloaded, downloading or a system voice.
let packs, voices, settings;
function ttsHint() {
  const persona = $('ttsPersona').value;
  const target = $('target').value;
  const system = resolveVoice(voices, target, { ...settings, ttsPersona: persona }).voice;
  const st = voiceStatus(persona, target, packs, system);
  const needs = st.voice && !st.ready && st.progress == null;
  $('ttsHintText').textContent = `${st.label} · ${st.state}${needs ? ` ${i18n('tts_until_ready')}` : ''}`;
  $('ttsBar').hidden = st.progress == null;
  $('ttsBar').firstElementChild.style.width = `${st.progress ?? 0}%`;
  $('ttsDownload').hidden = !needs;
}

// The popup closes on the first click elsewhere, so it never downloads itself: running captions
// download in their own page, otherwise the settings page does.
$('ttsDownload').onclick = () => {
  const { pack } = resolveNeural($('ttsPersona').value, $('target').value);
  if (!state.running) return chrome.tabs.create({ url: chrome.runtime.getURL('options.html?download=1') });
  chrome.runtime.sendMessage({ target: 'offscreen', type: 'tts-ensure', pack }).catch(() => {});
  packs[pack].progress = 0;
  ttsHint();
};
$('cues').onchange = () => chrome.storage.local.set({ cues: Number($('cues').value) });

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.state) {
    const wasLoading = state.status?.state === 'loading';
    const before = Object.keys(state.downloads ?? {});
    state = changes.state.newValue ?? {};
    const finished = before.filter((k) => state.downloads?.[k] == null);
    if (finished.length) {
      for (const k of finished) if (state.modelError?.model !== k) justDone.add(k);
      refreshCached();
    } else if (wasLoading && state.status?.state !== 'loading') refreshCached();
    render();
  }
});

function fillLangs(select, codes) {
  select.append(...codes.map((c) => new Option(langName(c), c)));
}
$('source').append(new Option(i18n('auto_detect'), 'auto'));
fillLangs($('source'), SOURCE_LANGS);
fillLangs($('target'), TARGET_LANGS);
$('modelCaret').innerHTML = ICONS.caret;
$('ttsPersona').append(...Object.keys(PERSONAS).map((k) => new Option(`${i18n(`persona_${k}_name`)} · ${i18n(`persona_${k}_desc`)}`, k)));
$('cues').append(...[1, 2, 3, 4, 5, 6].map((n) => new Option(n === 1 ? i18n('cues_last') : i18n('cues_last_n', n), n)));

const s = await loadSettings();
$('source').value = s.source;
$('target').value = s.target;
chosenModel = s.model;
({ device } = await modelDevice());
autoPick = autoModel(device, s.source);
// Every Whisper call costs the same on a CPU, so bigger models are slower there too.
document.querySelector('.model-note').hidden = device !== 'webgpu';
$('showOriginal').checked = s.showOriginal;
$('tts').checked = s.tts;
$('ttsPersona').value = s.ttsPersona;
$('personaField').hidden = $('ttsHint').hidden = !s.tts;
$('cues').value = s.cues;
refreshCached();
settings = s;
voices = await listVoices();
packs = watchPacks(ttsHint);
ttsHint();
state = (await chrome.storage.session.get('state')).state ?? {};
translationEnabled = (await chrome.storage.local.get('firefoxTranslationEnabled')).firefoxTranslationEnabled ?? false;
render();
