import { loadSettings } from './settings.js';

let state = { running: false, tabId: null, status: null, asrMs: null, needPairs: [] };
const restored = chrome.storage.session.get('state').then((r) => r.state && (state = r.state));

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
  const { model, source, target } = await loadSettings();
  await inject(tabId);
  if (!(await hasOffscreen())) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Sekme sesini yakalayıp lokal olarak yazıya dökmek için',
    });
  }
  await save({ running: true, tabId, target, status: { state: 'loading', text: 'Başlatılıyor...' }, asrMs: null, needPairs: [] });
  chrome.runtime.sendMessage({ target: 'offscreen', type: 'start', streamId, settings: { model, source, target } });
}

async function stop(text = 'Durduruldu') {
  await restored;
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
        break;
      case 'status':
        if (msg.state === 'stopped' || msg.state === 'error') {
          await stop(msg.text);
          break;
        }
        await save({ status: { state: msg.state, text: msg.text, progress: msg.progress } });
        chrome.tabs.sendMessage(state.tabId, { type: 'status', state: msg.state, text: msg.text }).catch(() => {});
        break;
      case 'stats':
        await save({ asrMs: msg.asrMs });
        break;
      case 'need-pair':
        if (!state.needPairs.includes(msg.source)) await save({ needPairs: [...state.needPairs, msg.source] });
        break;
      case 'pair-ready':
        await save({ needPairs: state.needPairs.filter((s) => s !== msg.source) });
        break;
    }
    reply?.(true);
  })();
  return true;
});

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') chrome.tabs.create({ url: 'options.html#setup' });
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
  if (state.running && tabId === state.tabId) stop('Sekme kapatıldı');
});

// Full page loads wipe the overlay; the capture itself survives, so put the overlay back.
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  await restored;
  if (state.running && tabId === state.tabId && info.status === 'complete') inject(tabId);
});
