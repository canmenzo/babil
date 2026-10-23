import { loadSettings, i18n } from './settings.js';
import { createSpeaker, resolveVoice, listVoices, neuralSpeaker } from './speech.js';
import { resolveNeural, packReady } from './tts/catalog.js';

let state = { running: false, tabId: null, status: null, asrMs: null, needPairs: [] };
const restored = browser.storage.session.get('state').then((r) => r.state && (state = r.state));

function save(patch) {
  state = { ...state, ...patch };
  return browser.storage.session.set({ state });
}

let speech = {};
let say, neural;
let neuralReady = false;
let neuralOff = false;
let ensured = null;
const speechLoaded = loadSpeech();
speechSynthesis.onvoiceschanged = loadSpeech;

async function loadSpeech() {
  speech = await loadSettings();
  say = resolveVoice(await listVoices(), speech.target, speech);
  neural = resolveNeural(speech.ttsPersona, speech.target);
  neuralReady = !!neural && (await packReady(neural.pack));
}
new BroadcastChannel('babil-tts').onmessage = ({ data }) => ['ready', 'deleted'].includes(data.type) && loadSpeech();

// No browser.tts in Firefox; the persistent background page can use speechSynthesis directly.
function systemSpeak(text, done) {
  const u = new SpeechSynthesisUtterance(text);
  u.lang = speech.target;
  u.rate = say.rate;
  u.pitch = say.pitch;
  u.voice = say.voice?.voice ?? null;
  u.onend = u.onerror = done;
  speechSynthesis.speak(u);
}

const neuralTts = neuralSpeaker(sendToEngine);
const useNeural = () => neural && neuralReady && !neuralOff;

// Downloaded voices play from offscreen.js, which runs in this same page.
const speaker = createSpeaker({
  speak(text, done) {
    if (!useNeural()) {
      if (neural && !neuralReady && ensured !== neural.pack) sendToEngine({ type: 'tts-ensure', pack: (ensured = neural.pack) });
      return systemSpeak(text, done);
    }
    neuralTts.speak(text, neural, (ok) => (ok ? done() : systemSpeak(text, done)));
  },
  prepare: (text) => useNeural() && sendToEngine({ type: 'tts-prepare', text, voice: neural }),
  cancel() {
    speechSynthesis.cancel();
    sendToEngine({ type: 'tts-stop' });
  },
});

async function sendToEngine(message) {
  return window.__babilEngineMessage({ target: 'offscreen', ...message });
}

async function inject(tabId, file) {
  return browser.tabs.executeScript(tabId, { file });
}

async function start(tabId) {
  await restored;
  if (state.running) await stop();
  const { model, source, target, instant } = await loadSettings();
  const { firefoxTranslationEnabled = false } = await browser.storage.local.get('firefoxTranslationEnabled');
  await inject(tabId, 'content.js');
  await inject(tabId, 'capture-firefox.js');
  await save({ running: true, tabId, target, status: { state: 'loading', text: i18n('status_starting') }, asrMs: null, needPairs: [] });
  neuralOff = false;
  ensured = null;
  await sendToEngine({ type: 'start-frames', settings: { model, source, target, instant, translationEnabled: firefoxTranslationEnabled } });
  await browser.tabs.sendMessage(tabId, { type: 'capture-start' });
}

async function stop(text = i18n('status_stopped')) {
  await restored;
  speaker.stop();
  if (state.tabId != null) browser.tabs.sendMessage(state.tabId, { type: 'capture-stop' }).catch(() => {});
  await sendToEngine({ type: 'stop' });
  await save({ running: false, status: { state: 'stopped', text } });
}

async function handleBgMessage(msg) {
  await restored;
  switch (msg.type) {
    case 'start':
      await start(msg.tabId);
      break;
    case 'stop':
      await stop();
      break;
    case 'translation-enable':
      await browser.storage.local.set({ firefoxTranslationEnabled: true });
      await sendToEngine({ type: 'translation-enable' });
      break;
    case 'caption':
      browser.tabs.sendMessage(state.tabId, msg).catch(() => {});
      await speechLoaded;
      if (speech.tts) speaker.caption(msg, speech.target);
      break;
    case 'status': {
      const text = i18n(msg.text);
      if (msg.state === 'stopped' || msg.state === 'error') {
        await stop(text);
        break;
      }
      await save({ status: { state: msg.state, text, progress: msg.progress } });
      browser.tabs.sendMessage(state.tabId, { type: 'status', state: msg.state, text }).catch(() => {});
      if (msg.device && speech.tts && useNeural()) sendToEngine({ type: 'tts-load', pack: neural.pack });
      break;
    }
    case 'stats':
      await save({ asrMs: msg.asrMs });
      break;
    case 'tts-ended':
      if (msg.fallback) neuralOff = true;
      neuralTts.ended(msg);
      break;
  }
}

window.__babilHandleBgMessage = handleBgMessage;
browser.runtime.onMessage.addListener((msg) => {
  if (msg.target === 'bg') return handleBgMessage(msg);
  if (msg.target === 'offscreen') return window.__babilEngineMessage(msg);
});

browser.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || !['model', 'source', 'target', 'instant'].some((k) => k in changes)) return;
  await restored;
  if (!state.running) return;
  const { model, source, target, instant } = await loadSettings();
  await save({ target });
  const { firefoxTranslationEnabled = false } = await browser.storage.local.get('firefoxTranslationEnabled');
  await sendToEngine({ type: 'settings', settings: { model, source, target, instant, translationEnabled: firefoxTranslationEnabled } });
});

browser.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || !['target', 'tts', 'ttsPersona', 'ttsVoice', 'ttsRate'].some((k) => k in changes)) return;
  await loadSpeech();
  if (!speech.tts) speaker.stop();
});

browser.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'toggle-captions') return;
  await restored;
  if (state.running) return stop();
  await start(tab.id);
});

browser.tabs.onRemoved.addListener(async (tabId) => {
  await restored;
  if (state.running && tabId === state.tabId) stop(i18n('status_tab_closed'));
});

browser.tabs.onUpdated.addListener(async (tabId, info) => {
  await restored;
  if (state.running && tabId === state.tabId && info.status === 'complete') {
    await inject(tabId, 'content.js');
    await inject(tabId, 'capture-firefox.js');
    browser.tabs.sendMessage(tabId, { type: 'capture-start' }).catch(() => {});
  }
});
