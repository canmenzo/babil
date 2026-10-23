// Downloadable voices, stored by tts-worker.js in OPFS under tts/<pack>/<file>. Every download is
// pinned to a revision and checked against its SHA-256.
const ST = 'https://huggingface.co/supertone-oss-archive/supertonic-3/resolve/aafc6e32416a594460b32413efc49d7fe4ce6d46/';
// The official files with only the vector estimator quantized to int8: a quarter of the size, same
// speech. The official full-size one is the fallback if this repo goes away.
const Q8 = 'https://huggingface.co/payam1394/traxlate-supertonic-3-q8ve/resolve/83bd582620fcb82dac18b39d21febf706638cf31/';
const PIPER = 'https://huggingface.co/rhasspy/piper-voices/resolve/5041a7a49ae5b3a0f30e6837769eb03fdbb231bd/zh/zh_CN/';

const file = (name, url, bytes, sha256) => ({ name, sources: [{ url, bytes, sha256 }] });
const STYLES = {
  F1: [292046, 'bbdec6ee00231c2c742ad05483df5334cab3b52fda3ba38e6a07059c4563dbc2'],
  F2: [292423, '7c722c6a72707b1a77f035d67f0d1351ba187738e06f7683e8c72b1df3477fc6'],
  F3: [290794, '12f6ef2573baa2defa1128069cb59f203e3ab67c92af77b42df8a0e3a2f7c6ab'],
  F4: [291808, 'c2fa764c1225a76dfc3e2c73e8aa4f70d9ee48793860eb34c295fff01c2e032b'],
  F5: [291479, '45966e73316415626cf41a7d1c6f3b4c70dbc1ba2bee5c1978ef0ce33244fc8d'],
  M1: [291748, 'e35604687f5d23694b8e91593a93eec0e4eca6c0b02bb8ed69139ab2ea6b0a5b'],
  M2: [292055, 'b76cbf62bac707c710cf0ae5aba5e31eea1a6339a9734bfae33ab98499534a50'],
  M3: [290198, 'ea1ac35ccb91b0d7ecad533a2fbd0eec10c91513d8951e3b25fbba99954e159b'],
  M4: [291522, 'ca8eefad4fcd989c9379032ff3e50738adc547eeb5e221b82593a6d7b3bac303'],
  M5: [291469, 'dd22b92740314321f8ae11c5e87f8dd60d060f15dd3a632b5adf77f471f77af2'],
};

export const PACKS = {
  supertonic3: {
    name: 'Supertonic 3',
    license: 'https://huggingface.co/supertone-oss-archive/supertonic-3/blob/main/LICENSE',
    files: [
      file('tts.json', `${ST}onnx/tts.json`, 8253, '42078d3aef1cd43ab43021f3c54f47d2d75ceb4e75f627f118890128b06a0d09'),
      file('unicode_indexer.json', `${ST}onnx/unicode_indexer.json`, 277676, '9bf7346e43883a81f8645c81224f786d43c5b57f3641f6e7671a7d6c493cb24f'),
      file('duration_predictor.onnx', `${ST}onnx/duration_predictor.onnx`, 3700147, 'c3eb91414d5ff8a7a239b7fe9e34e7e2bf8a8140d8375ffb14718b1c639325db'),
      file('text_encoder.onnx', `${ST}onnx/text_encoder.onnx`, 36416150, 'c7befd5ea8c3119769e8a6c1486c4edc6a3bc8365c67621c881bbb774b9902ff'),
      {
        name: 'vector_estimator.onnx',
        sources: [
          { url: `${Q8}onnx/vector_estimator.onnx`, bytes: 65447164, sha256: '073575704bf0b6ca0714eb6509029f324b794d5bd6dbdb27dccbbc5939abc167' },
          { url: `${ST}onnx/vector_estimator.onnx`, bytes: 256534781, sha256: '883ac868ea0275ef0e991524dc64f16b3c0376efd7c320af6b53f5b780d7c61c' },
        ],
      },
      file('vocoder.onnx', `${ST}onnx/vocoder.onnx`, 101424195, '085de76dd8e8d5836d6ca66826601f615939218f90e519f70ee8a36ed2a4c4ba'),
      ...Object.entries(STYLES).map(([s, [bytes, sha]]) => file(`${s}.json`, `${ST}voice_styles/${s}.json`, bytes, sha)),
    ],
  },
  'piper-zh-xiaoya': {
    name: 'Xiao Ya',
    license: 'https://huggingface.co/rhasspy/piper-voices/blob/main/zh/zh_CN/xiao_ya/medium/MODEL_CARD',
    files: [
      file('voice.onnx', `${PIPER}xiao_ya/medium/zh_CN-xiao_ya-medium.onnx`, 63221984, 'cb2ce4ca1f5a36a7b23ae48f0651ce2c854c331ef7a804e5c5dc643d0f74f0e2'),
      file('voice.onnx.json', `${PIPER}xiao_ya/medium/zh_CN-xiao_ya-medium.onnx.json`, 2927, 'e1ec027b7065959643c1463705398d413ed4fdaa626d7d8ef1d12ab87e9a0320'),
    ],
  },
  'piper-zh-chaowen': {
    name: 'Chaowen',
    license: 'https://huggingface.co/rhasspy/piper-voices/blob/main/zh/zh_CN/chaowen/medium/MODEL_CARD',
    files: [
      file('voice.onnx', `${PIPER}chaowen/medium/zh_CN-chaowen-medium.onnx`, 63221984, '820d64ac16048fbcf38dd0823d37fab5f5e0c2bd71b01ca5a50f553fac19e746'),
      file('voice.onnx.json', `${PIPER}chaowen/medium/zh_CN-chaowen-medium.onnx.json`, 2927, 'a6bb2caafa0645642f13cbf7e2f6fbbb16fded66e51109fc26d622f6472fa16f'),
    ],
  },
};

export const SUPERTONIC_LANGS = ['tr', 'en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ar', 'hi', 'ja', 'ko', 'id', 'vi', 'nl', 'pl', 'uk', 'el', 'sv', 'ro', 'cs', 'hu'];

// Supertonic speed is 1.05 (its normal) times the persona's rate. Chinese has one female and one male
// voice, so personas share them and differ in speed and pitch; pitch plays the audio faster or
// slower, and length makes up for it so the speed stays.
const VOICES = {
  lale: { style: 'F3', speed: 1.05, zh: { pack: 'piper-zh-xiaoya', rate: 1 } },
  ayla: { style: 'F2', speed: 1.1, zh: { pack: 'piper-zh-xiaoya', rate: 1.05, pitch: 1.1, noise: 0.8, like: 'lale', tweak: 'higher' } },
  deniz: { style: 'M4', speed: 1, zh: { pack: 'piper-zh-chaowen', rate: 0.95 } },
  ates: { style: 'M2', speed: 1.05, zh: { pack: 'piper-zh-chaowen', rate: 1, pitch: 0.9, like: 'deniz', tweak: 'deeper' } },
  bilge: { style: 'F5', speed: 0.84, zh: { pack: 'piper-zh-xiaoya', rate: 0.8, like: 'lale', tweak: 'slower' } },
  ruzgar: { style: 'M1', speed: 1.42, zh: { pack: 'piper-zh-chaowen', rate: 1.35, like: 'deniz', tweak: 'faster' } },
};

// The downloadable voice for a persona and language, or null where only system voices exist.
export function resolveNeural(persona, lang) {
  const v = VOICES[persona];
  const base = lang.split('-')[0];
  if (!v) return null;
  if (SUPERTONIC_LANGS.includes(base)) return { engine: 'supertonic', pack: 'supertonic3', style: v.style, lang: base, speed: v.speed };
  if (base !== 'zh') return null;
  const { pack, rate, pitch = 1, noise = 1, like, tweak } = v.zh;
  return { engine: 'piper', pack, playbackRate: pitch, lengthScale: pitch / rate, noiseScale: noise, like, tweak };
}

export const packBytes = (pack) => PACKS[pack].files.reduce((n, f) => n + f.sources[0].bytes, 0);
export const packSize = (pack) => `${Math.round(packBytes(pack) / 1e6)} MB`;

// Files are moved into place only after their hash checks out, so being there means complete.
export async function packReady(pack) {
  try {
    const dir = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('tts')).getDirectoryHandle(pack);
    const names = new Set();
    for await (const name of dir.keys()) names.add(name);
    return PACKS[pack].files.every((f) => names.has(f.name));
  } catch {
    return false;
  }
}

// Pack states for the settings page and popup: { ready, progress, error } per pack, from OPFS and
// the 'babil-tts' messages of whichever page is downloading.
export function watchPacks(onChange) {
  const packs = Object.fromEntries(Object.keys(PACKS).map((p) => [p, {}]));
  new BroadcastChannel('babil-tts').onmessage = ({ data }) => {
    const p = packs[data.pack];
    if (data.type === 'progress') Object.assign(p, { progress: Math.min(99, Math.floor((100 * data.loaded) / data.total)), error: null });
    else if (data.type === 'error') Object.assign(p, { progress: null, error: data.message });
    else Object.assign(p, { ready: data.type === 'ready', progress: null, error: null });
    onChange(data);
  };
  Promise.all(Object.keys(PACKS).map(async (p) => (packs[p].ready = await packReady(p)))).then(() => onChange({}));
  return packs;
}
