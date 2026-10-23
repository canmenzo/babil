import { loadSettings, i18n } from './settings.js';
import { createSpeaker, resolveVoice, listVoices, neuralSpeaker } from './speech.js';
import { resolveNeural, packReady } from './tts/catalog.js';

let state = { running: false, tabId: null, status: null, asrMs: null, needPairs: [] };
const restored = chrome.storage.session.get('state').then((r) => r.state && (state = r.state));

let speech = {};
let say, neural;
let neuralReady = false;
let neuralOff = false; // too slow on this computer, or the engine page may not play audio
let ensured = null;
const speechLoaded = loadSpeech();

async function loadSpeech() {
  speech = await loadSettings();
  say = resolveVoice(await listVoices(), speech.target, speech);
  neural = resolveNeural(speech.ttsPersona, speech.target);
  neuralReady = !!neural && (await packReady(neural.pack));
}
// A voice finished downloading or was deleted, here or in the options page.
new BroadcastChannel('babil-tts').onmessage = ({ data }) => ['ready', 'deleted'].includes(data.type) && loadSpeech();

const toEngine = (msg) => chrome.runtime.sendMessage({ target: 'offscreen', ...msg }).catch(() => {});
const neuralTts = neuralSpeaker(toEngine);

// chrome.tts works from the service worker without a user gesture, unlike speechSynthesis in a page.
function systemSpeak(text, done) {
  const onEvent = (e) => ['end', 'interrupted', 'cancelled', 'error'].includes(e.type) && done();
  chrome.tts.speak(text, { lang: speech.target, voiceName: say.voice?.name, rate: say.rate, pitch: say.pitch, onEvent }).catch(done);
}

const useNeural = () => neural && neuralReady && !neuralOff;

// Until the persona's voice is downloaded, which starts with the first sentence, a system voice reads.
const speaker = createSpeaker({
  speak(text, done) {
    if (!useNeural()) {
      if (neural && !neuralReady && ensured !== neural.pack) toEngine({ type: 'tts-ensure', pack: (ensured = neural.pack) });
      return systemSpeak(text, done);
    }
    neuralTts.speak(text, neural, (ok) => (ok ? done() : systemSpeak(text, done)));
  },
  prepare: (text) => useNeural() && toEngine({ type: 'tts-prepare', text, voice: neural }),
  cancel() {
    chrome.tts.stop();
    toEngine({ type: 'tts-stop' });
  },
  // Lower the replayed tab audio while a translation is read out.
  onSpeaking(on) {
    const gain = on && speech.ttsDuck ? 0.3 : 1;
    toEngine({ type: 'duck', gain });
  },
});

function save(patch) {
  state = { ...state, ...patch };
  return chrome.storage.session.set({ state });
}

async function hasOffscreen() {
  const ctx = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  return ctx.length > 0;
}

function inject(tabId) {
  return chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }).catch(() => {});
}

async function start(tabId, streamId) {
  await restored;
  if (state.running) await stop();
  const { model, source, target, instant } = await loadSettings();
  await inject(tabId);
  if (!(await hasOffscreen())) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: i18n('offscreen_justification'),
    });
  }
  await save({ running: true, tabId, target, status: { state: 'loading', text: i18n('status_starting') }, asrMs: null, needPairs: [] });
  neuralOff = false;
  ensured = null;
  chrome.runtime.sendMessage({ target: 'offscreen', type: 'start', streamId, settings: { model, source, target, instant } });
}

async function stop(text = i18n('status_stopped')) {
  await restored;
  speaker.stop();
  if (await hasOffscreen()) await chrome.offscreen.closeDocument();
  if (state.tabId != null) chrome.tabs.sendMessage(state.tabId, { type: 'clear' }).catch(() => {});
  await save({ running: false, status: { state: 'stopped', text } });
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.target !== 'bg') return;
  (async () => {
    await restored;
    switch (msg.type) {
      case 'start':
        await start(msg.tabId, msg.streamId);
        break;
      case 'stop':
        await stop();
        break;
      case 'caption':
        chrome.tabs.sendMessage(state.tabId, msg).catch(() => {});
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
        chrome.tabs.sendMessage(state.tabId, { type: 'status', state: msg.state, text }).catch(() => {});
        // Whisper is loaded; load the voice too so the first sentence does not wait for it.
        if (msg.device && speech.tts && useNeural()) toEngine({ type: 'tts-load', pack: neural.pack });
        break;
      }
      case 'stats':
        await save({ asrMs: msg.asrMs });
        break;
      case 'need-pair':
        if (!state.needPairs.includes(msg.source)) await save({ needPairs: [...state.needPairs, msg.source] });
        break;
      case 'pair-ready':
        await save({ needPairs: state.needPairs.filter((s) => s !== msg.source) });
        break;
      case 'tts-ended':
        if (msg.fallback) neuralOff = true;
        neuralTts.ended(msg);
        break;
    }
    reply?.(true);
  })();
  return true;
});

// Language and model changes reach the running session without a restart.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || !['model', 'source', 'target', 'instant'].some((k) => k in changes)) return;
  await restored;
  if (!state.running) return;
  const { model, source, target, instant } = await loadSettings();
  await save({ target, needPairs: [] });
  chrome.runtime.sendMessage({ target: 'offscreen', type: 'settings', settings: { model, source, target, instant } }).catch(() => {});
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || !['target', 'tts', 'ttsPersona', 'ttsVoice', 'ttsRate', 'ttsDuck'].some((k) => k in changes)) return;
  await loadSpeech();
  if (!speech.tts) speaker.stop();
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'toggle-captions') return;
  await restored;
  if (state.running) return stop();
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
  await start(tab.id, streamId);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await restored;
  if (state.running && tabId === state.tabId) stop(i18n('status_tab_closed'));
});

// Full page loads wipe the overlay; the capture itself survives, so put the overlay back.
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  await restored;
  if (state.running && tabId === state.tabId && info.status === 'complete') inject(tabId);
});
