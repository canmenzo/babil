// Subset of Chrome Translator API targets, most spoken first.
export const TARGET_LANGS = [
  'tr', 'en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ar', 'hi', 'bn', 'zh', 'zh-Hant', 'ja', 'ko',
  'id', 'vi', 'th', 'nl', 'pl', 'uk', 'el', 'sv', 'ro', 'cs', 'hu',
];

// Captions are translated into the browser's language by default, when it is a target.
const browserLang = /^zh-(TW|HK|MO|Hant)/i.test(navigator.language) ? 'zh-Hant' : navigator.language.split('-')[0];

export const DEFAULTS = {
  model: 'auto',
  source: 'auto',
  target: TARGET_LANGS.includes(browserLang) ? browserLang : 'en',
  instant: false, // translate the sentence while it is still being spoken
  showOriginal: true,
  originalFirst: false,
  position: 8, // % of the video height, measured from its bottom
  edge: 'shadow',
  cues: 2, // finished sentences kept on screen, besides the one being spoken
  hold: 4, // seconds a final caption stays
  scaleWithVideo: true,
  tts: false, // read final captions aloud in the target language
  ttsPersona: 'lale', // see PERSONAS in speech.js; 'custom' uses ttsVoice and ttsRate
  ttsVoice: '', // empty: the best local voice for the target language
  ttsRate: 1,
  ttsDuck: true, // lower the video while speaking (Chrome only)
  trans: { font: 'sans', size: 30, color: '#ffffff', bg: '#000000', bgOpacity: 0.75, bold: true },
  orig: { font: 'sans', size: 20, color: '#ffe066', bg: '#000000', bgOpacity: 0.6, bold: false },
};

// Whisper can transcribe all of these.
export const SOURCE_LANGS = [
  'en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'pl', 'ru', 'uk', 'tr', 'ar', 'fa', 'hi', 'bn', 'ur',
  'id', 'vi', 'th', 'ja', 'ko', 'zh', 'el', 'sv', 'ro', 'cs', 'hu', 'he',
];

// Sizes are the downloads on a GPU and, smaller because quantized, on the CPU. Bigger models make fewer mistakes; captions come just as fast with
// any of them, since they wait for the sentence to end, so the choice is about the computer.
// Names, font and edge labels are the messages model_<key>, font_<key> and edge_<key>.
export const MODELS = {
  tiny: { id: 'onnx-community/whisper-tiny', size: '120 MB', cpuSize: '41 MB' },
  base: { id: 'onnx-community/whisper-base', size: '200 MB', cpuSize: '77 MB' },
  // English only. Unlike Whisper, its cost grows with the audio, so short segments stay cheap on a CPU.
  moonshine: { id: 'onnx-community/moonshine-base-ONNX', size: '154 MB', cpuSize: '63 MB', arch: 'moonshine' },
  small: { id: 'onnx-community/whisper-small', size: '600 MB', cpuSize: '249 MB' },
  turbo: { id: 'onnx-community/whisper-large-v3-turbo', size: '1.6 GB', cpuSize: '1.1 GB' },
};

let gpu;
export function modelDevice() {
  gpu ??= Promise.resolve(navigator.gpu?.requestAdapter()).catch(() => null).then((adapter) => ({
    device: adapter ? 'webgpu' : 'wasm',
    f16: adapter?.features.has('shader-f16') ?? false,
  }));
  return gpu;
}

// small costs ~50 ms more than base on a GPU and fixes most short-phrase mistakes; on CPU it is too slow.
// Moonshine beat whisper-base on English on the CPU in both accuracy and speed, but hears nothing else.
export const autoModel = (device, source) => (device === 'webgpu' ? 'small' : source === 'en' ? 'moonshine' : 'base');

export const modelSize = (name, device) => (device === 'webgpu' ? MODELS[name].size : MODELS[name].cpuSize);

export function modelDtype(name, device, f16) {
  if (device === 'wasm') return 'q8';
  if (name === 'turbo') return { encoder_model: f16 ? 'fp16' : 'q4', decoder_model_merged: 'q4' };
  return { encoder_model: 'fp32', decoder_model_merged: 'q4' };
}

const DTYPE_SUFFIX = { fp32: '', fp16: '_fp16', q8: '_quantized', q4: '_q4' };

// Models are stored in OPFS by asr-worker.js, one file per download URL. Which weights a model
// needs depends on the device, so another device's weights do not count as downloaded.
export async function isCached(model) {
  const { device, f16 } = await modelDevice();
  const dtype = modelDtype(model, device, f16);
  const root = await navigator.storage.getDirectory();
  const names = new Set();
  for await (const name of root.keys()) names.add(name);
  return ['encoder_model', 'decoder_model_merged'].every((part) => {
    const suffix = DTYPE_SUFFIX[typeof dtype === 'string' ? dtype : dtype[part]];
    return names.has(encodeURIComponent(`https://huggingface.co/${MODELS[model].id}/resolve/main/onnx/${part}${suffix}.onnx`));
  });
}

export async function deleteModel(model) {
  const root = await navigator.storage.getDirectory();
  const prefix = encodeURIComponent(`/${MODELS[model].id}/`);
  const names = [];
  for await (const name of root.keys()) if (name.includes(prefix)) names.push(name);
  await Promise.all(names.map((name) => root.removeEntry(name).catch(() => {})));
}

// [key, ...subs] works as a key too, so the offscreen document, which has no chrome.i18n, can
// send messages for the background to put into words. Subs may be such messages themselves.
export function i18n(key, ...subs) {
  if (Array.isArray(key)) return i18n(...key);
  return chrome.i18n.getMessage(key, subs.map((s) => (Array.isArray(s) ? i18n(...s) : String(s))));
}

export function localize() {
  document.documentElement.lang = chrome.i18n.getUILanguage();
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = i18n(el.dataset.i18n);
}

export function langName(code) {
  const ui = chrome.i18n.getUILanguage();
  const name = new Intl.DisplayNames([ui], { type: 'language' }).of(code);
  return name.charAt(0).toLocaleUpperCase(ui) + name.slice(1);
}

export const FONTS = {
  sans: { css: 'Roboto, Arial, Helvetica, sans-serif' },
  system: { css: 'system-ui, "Segoe UI", sans-serif' },
  serif: { css: 'Georgia, "Times New Roman", serif' },
  mono: { css: 'Consolas, "Courier New", monospace' },
  casual: { css: '"Comic Sans MS", "Comic Neue", cursive' },
  condensed: { css: '"Arial Narrow", "Roboto Condensed", sans-serif-condensed, sans-serif' },
  smallcaps: { css: 'Roboto, Arial, sans-serif', smallCaps: true },
};

export const EDGES = {
  none: { css: 'none' },
  shadow: { css: '2px 2px 4px rgba(0,0,0,.95)' },
  outline: {
    css: '-1.5px -1.5px 0 #000, 1.5px -1.5px 0 #000, -1.5px 1.5px 0 #000, 1.5px 1.5px 0 #000, 0 0 3px #000',
  },
  raised: { css: '1px 1px 0 #000, 2px 2px 0 #000' },
  depressed: { css: '-1px -1px 0 #000, 1px 1px 0 rgba(255,255,255,.4)' },
};

export async function loadSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return {
    ...DEFAULTS,
    ...stored,
    // Users who picked a voice or speed before personas existed keep it.
    ttsPersona: stored.ttsPersona ?? (stored.ttsVoice || (stored.ttsRate ?? 1) !== 1 ? 'custom' : DEFAULTS.ttsPersona),
    trans: { ...DEFAULTS.trans, ...stored.trans },
    orig: { ...DEFAULTS.orig, ...stored.orig },
  };
}

function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// Shared by the overlay and the settings preview. Sizes scale with the --scale custom property.
export function captionCss(s) {
  const line = (cls, t) => `
    .${cls} {
      font-family: ${FONTS[t.font]?.css ?? FONTS.sans.css};
      font-variant: ${FONTS[t.font]?.smallCaps ? 'small-caps' : 'normal'};
      font-size: calc(${t.size}px * var(--scale, 1));
      font-weight: ${t.bold ? 700 : 400};
      color: ${t.color};
    }
    .${cls} span { background: ${rgba(t.bg, t.bgOpacity)}; }`;
  return `
    .cue { display: flex; flex-direction: ${s.originalFirst ? 'column-reverse' : 'column'}; align-items: center; gap: .15em; margin-top: .3em; }
    .trans, .orig { line-height: 1.35; text-align: center; text-shadow: ${EDGES[s.edge]?.css ?? 'none'}; }
    .trans span, .orig span { padding: .08em .35em; border-radius: .18em; box-decoration-break: clone; -webkit-box-decoration-break: clone; white-space: pre-wrap; }
    .orig { display: ${s.showOriginal ? 'block' : 'none'}; }
    ${line('trans', s.trans)}
    ${line('orig', s.orig)}`;
}
