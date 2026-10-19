// Audio capture, segmentation, ASR scheduling and translation. One instance per extension.
import { MODELS } from './settings.js';

const FRAME = 1600; // 100 ms at 16 kHz, matches worklet.js

// Latency tuning, all in 100 ms frames.
const MIN_FINAL = 8; // a segment needs at least 0.8 s before a pause can close it
const PAUSE = 3; // 0.3 s of quiet closes the segment
const MAX_SEG = 50; // hard cut at 5 s so continuous talk (streams) still finalizes
const CUT_SEARCH = 15; // on a hard cut, split at the quietest frame within the last 1.5 s
const PARTIAL_EVERY = 6; // re-run the open segment every 0.6 s of new audio
const MIN_SPEECH = 3; // segments with fewer loud frames are dropped (Whisper hallucinates on silence)
const MAX_BACKLOG = 2; // finals waiting beyond this are skipped, keeping their last partial text
const PREROLL = 3; // quiet frames kept before speech onset so the first syllable is not clipped

const HALLUCINATIONS = [
  /altyaz[ıi].*m\.?\s?k\.?/i,
  /amara\.org/i,
  /^(thanks|thank you) for watching[.!]?$/i,
  /^abone ol/i,
];

// Whisper's own "no speech" probability: real speech scores <0.01, fillers ~0.2,
// silence/noise/music >0.8 (where it would otherwise hallucinate "you").
const NO_SPEECH = 0.5;
const UNSURE = 0.12; // above this, one- or two-word results are treated as noise
// large-v3-turbo has no working no-speech score; its language confidence (top two languages)
// is ~1 on speech, 0.5-0.6 on noise and music, ~0.75 on "hmm".
const LANG_MIN = 0.7;
const LANG_UNSURE = 0.85;

// Hesitations dropped from the text, keeping any sentence-ending punctuation they carried.
const FILLERS = {
  en: /(^|\s)(?:u+m+|u+h+m*|e+r+m+|h+m+|hu+m+|m{2,}|mhm|mm-hmm|uh-huh|a+h+|e+h+|hu+h)([,.!?…]*)(?=\s|$)/gi,
  tr: /(^|\s)(?:ı{2,}|e{2,}|a{2,}|hı+m*|h+m+|m{2,})([,.!?…]*)(?=\s|$)/gi,
  other: /(^|\s)(?:h+m+|m{2,})([,.!?…]*)(?=\s|$)/gi,
};
// Whole utterances that are only an interjection are not worth a caption.
const INTERJECTIONS = {
  en: /^(oh|ah|yeah|yep|yup|okay|ok|right|so|well|huh|mhm)[.!?,…]*$/i,
  tr: /^(hı+|şey|yani)[.!?,…]*$/i,
};

const TERMINATOR = /[.!?…。！？]["'”’)\]]*$/;
const FLUSH_MS = 1500; // an unfinished sentence is shown anyway after this much silence
const MAX_CARRY = 30; // words; very long unpunctuated speech is shown in chunks

// Chrome's translator sees one sentence without context, so English streaming slang gets literal
// translations ("stream" -> "akış", "corriente"). Rewrite it into words that translate right.
const EN_GLOSSARY = [
  [/\bstreamers\b/gi, 'broadcasters'],
  [/\bstreamer\b/gi, 'broadcaster'],
  [/\bstreaming\b/gi, 'broadcasting'],
  [/\bstreams\b/gi, 'broadcasts'],
  [/\bstream(ed)?\b/gi, 'broadcast'],
  [/\bsubs\b/gi, 'subscribers'],
  [/\bsubbed\b/gi, 'subscribed'],
  [/\bguys\b/gi, 'friends'],
];

let stream, playCtx, asrCtx, worker;
let settings = {};
let running = false;
let ready = false;
let frameMode = false;
let lagReported = 0;
let translationSeq = 0;
const translations = new Map();

let seg = null; // { id, frames, rms, speech, quiet, sinceProbe, words, language, emitted, lastEmitted }
let preroll = []; // [frame, rms] while no segment is open
let nextId = 1;
let noise = 0.005;
let langScore = {}; // language -> recent share of sentences, steers auto-detect
let lastSentence = { text: '', t: 0 };

const finals = []; // closed segments waiting for ASR
let busy = false;
const jobs = new Map(); // worker job id -> { segId, final, seg }
let jobSeq = 0;

// Captions are built per sentence, not per audio segment: a sentence is translated once,
// when it is complete, so the translated line never rewrites itself.
let carry = { words: [], language: null }; // finished audio whose sentence has not ended yet
let prevPartial = null; // { segId, words } for agreement between consecutive partials
let flushTimer = null;
let sentenceSeq = 0;
let liveVersion = 0;

function send(msg) {
  if (FIREFOX_BUILD) window.__babilHandleBgMessage(msg);
  else chrome.runtime.sendMessage({ target: 'bg', ...msg }).catch(() => {});
}

function status(state, text, extra = {}) {
  send({ type: 'status', state, text, ...extra });
}

function receiveEngineMessage(msg) {
  if (msg.target !== 'offscreen') return;
  if (msg.type === 'start') start(msg.streamId, msg.settings);
  else if (msg.type === 'start-frames') startFrames(msg.settings);
  else if (msg.type === 'frame' && frameMode && running) onFrame(new Float32Array(msg.audio));
  else if (msg.type === 'translation-enable') {
    settings.translationEnabled = true;
    worker?.postMessage({ type: 'translation-load' });
  }
  else if (msg.type === 'settings') reconfigure(msg.settings);
  else if (msg.type === 'stop') stop('Durduruldu');
}

if (FIREFOX_BUILD) window.__babilEngineMessage = receiveEngineMessage;
else chrome.runtime.onMessage.addListener(receiveEngineMessage);

// Changes made while running apply right away; the tab capture keeps going.
function reconfigure(s) {
  if (!running) return;
  const prev = settings;
  settings = s;
  if (s.source !== prev.source) langScore = {};
  if (s.target !== prev.target || s.source !== prev.source) {
    translators.forEach((p) => p.then((t) => t?.destroy()).catch(() => {}));
    translators.clear();
    reported.clear();
    if (s.source !== 'auto' && s.source !== s.target) getTranslator(s.source);
  }
  if (s.model !== prev.model) {
    worker.terminate();
    jobs.clear();
    finals.length = 0;
    loadModel();
  }
}

function loadModel() {
  ready = false;
  busy = true; // released on 'ready'
  worker = new Worker('asr-worker.js', { type: 'module' });
  worker.onmessage = ({ data }) => onWorker(data);
  status('loading', 'Model yükleniyor...', { progress: 0 });
  worker.postMessage({ type: 'load', model: settings.model });
}

async function start(streamId, s) {
  settings = s;
  frameMode = false;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
      video: false,
    });
  } catch (e) {
    status('error', `Ses yakalanamadı: ${e.message}`);
    return;
  }
  running = true;
  stream.getAudioTracks()[0].addEventListener('ended', () => stop('Sekme sesi kesildi'));

  // Capturing mutes the tab, so play it back untouched at the native rate.
  playCtx = new AudioContext();
  playCtx.createMediaStreamSource(stream).connect(playCtx.destination);

  // Separate 16 kHz context: the browser resamples for us.
  asrCtx = new AudioContext({ sampleRate: 16000 });
  await asrCtx.audioWorklet.addModule('worklet.js');
  const node = new AudioWorkletNode(asrCtx, 'capture-processor');
  const mute = asrCtx.createGain();
  mute.gain.value = 0;
  asrCtx.createMediaStreamSource(stream).connect(node).connect(mute).connect(asrCtx.destination);
  node.port.onmessage = ({ data }) => onFrame(data);

  loadModel();

  if (settings.source !== 'auto' && settings.source !== settings.target) getTranslator(settings.source);
}

function startFrames(s) {
  settings = s;
  frameMode = true;
  running = true;
  loadModel();
}

function stop(text) {
  if (!running) return;
  running = false;
  ready = false;
  clearTimeout(flushTimer);
  stream?.getTracks().forEach((t) => t.stop());
  playCtx?.close();
  asrCtx?.close();
  worker?.terminate();
  translators.forEach((p) => p.then((t) => t?.destroy()).catch(() => {}));
  translators.clear();
  translations.forEach((resolve) => resolve(null));
  translations.clear();
  status('stopped', text);
}

function rmsOf(f) {
  let s = 0;
  for (let i = 0; i < f.length; i++) s += f[i] * f[i];
  return Math.sqrt(s / f.length);
}

function onFrame(f) {
  if (!running) return;
  const r = rmsOf(f);
  // Slow-rising, fast-falling noise floor so background music raises the bar but speech does not.
  noise = r < noise ? noise * 0.9 + r * 0.1 : noise * 1.002;
  const loud = r > Math.max(0.004, noise * 2.5);

  if (!seg) {
    if (!loud) {
      preroll.push([f, r]);
      if (preroll.length > PREROLL) preroll.shift();
      return;
    }
    seg = newSegment(
      preroll.map(([pf]) => pf),
      preroll.map(([, pr]) => pr),
      0,
    );
    preroll = [];
  }
  seg.frames.push(f);
  seg.rms.push(r);
  seg.sinceProbe++;
  if (loud) {
    seg.speech++;
    seg.quiet = 0;
  } else {
    seg.quiet++;
  }

  const n = seg.frames.length;
  if (seg.quiet >= PAUSE && n >= MIN_FINAL) {
    closeSegment(n - seg.quiet + 1);
  } else if (seg.quiet >= PAUSE * 4) {
    // never got long enough to matter; a short blip followed by silence
    closeSegment(n - seg.quiet + 1);
  } else if (n >= MAX_SEG) {
    let cut = n - 1;
    for (let i = n - CUT_SEARCH; i < n; i++) if (seg.rms[i] < seg.rms[cut]) cut = i;
    closeSegment(cut + 1);
  }
  pump();
}

function newSegment(frames, rms, speech) {
  return { id: nextId++, frames, rms, speech, quiet: 0, sinceProbe: frames.length, words: null, emitted: 0 };
}

// Close the open segment at frame `end`; frames after it start the next segment.
function closeSegment(end) {
  // Same object, not a copy: a partial still in flight must not emit into a stale copy and then
  // have the final emit the same sentence again.
  const closed = seg;
  const rest = seg.frames.slice(end);
  const restRms = seg.rms.slice(end);
  closed.frames = closed.frames.slice(0, end);
  closed.rms = closed.rms.slice(0, end);
  seg = null;
  const threshold = Math.max(0.004, noise * 2.5);
  if (restRms.some((r) => r > threshold)) {
    seg = newSegment(rest, restRms, restRms.filter((r) => r > threshold).length);
  }

  if (closed.speech < MIN_SPEECH) {
    if (closed.words) finishSegment(closed, closed.words, closed.language);
    return;
  }
  finals.push(closed);
  while (finals.length > MAX_BACKLOG) {
    const dropped = finals.shift();
    if (dropped.words) finishSegment(dropped, dropped.words, dropped.language);
    if (ready && Date.now() - lagReported > 10000) {
      lagReported = Date.now();
      status('lagging', 'Cihaz yetişemiyor, daha küçük model seçin');
    }
  }
}

function concat(frames) {
  const out = new Float32Array(frames.length * FRAME);
  frames.forEach((f, i) => out.set(f, i * FRAME));
  return out;
}

function pump() {
  if (busy || !running) return;
  let job;
  if (finals.length) {
    const s = finals.shift();
    job = { segId: s.id, final: true, seg: s, audio: concat(s.frames) };
  } else if (seg && seg.speech >= MIN_SPEECH && seg.sinceProbe >= PARTIAL_EVERY) {
    seg.sinceProbe = 0;
    job = { segId: seg.id, final: false, seg, audio: concat(seg.frames) };
  } else {
    return;
  }
  busy = true;
  const id = ++jobSeq;
  jobs.set(id, job);
  const language = settings.source === 'auto' ? null : settings.source;
  worker.postMessage({ type: 'transcribe', id, audio: job.audio, language, prior: langScore }, [job.audio.buffer]);
}

function onWorker(m) {
  if (m.type === 'translated') {
    translations.get(m.id)?.(m.text);
    translations.delete(m.id);
  } else if (m.type === 'translation-progress') {
    status('loading', `Translation model downloading ${Math.round(m.progress)}%`, { progress: m.progress });
  } else if (m.type === 'translation-ready') {
    status('running', 'Offline translation ready');
  } else if (m.type === 'translation-error') {
    status('warning', `Offline translation unavailable: ${m.message}`);
  } else if (m.type === 'progress') {
    const verb = m.fromDisk ? 'yükleniyor' : 'indiriliyor';
    status('loading', `Model ${verb} %${Math.round(m.progress)}`, { progress: m.progress });
  } else if (m.type === 'ready') {
    busy = false;
    ready = true;
    const where = m.device === 'webgpu' ? 'ekran kartı' : 'işlemci, yavaş olabilir';
    status('running', `Çalışıyor: ${MODELS[m.model].name} (${where})`, { device: m.device });
    pump();
  } else if (m.type === 'error') {
    status('error', `Model yüklenemedi: ${m.message}`);
    stop('Hata');
  } else if (m.type === 'result') {
    busy = false;
    const job = jobs.get(m.id);
    jobs.delete(m.id);
    if (job && !m.error) handleResult(job, m);
    send({ type: 'stats', asrMs: m.ms });
    pump();
  }
}

function clean(text, language, noSpeech, langConf) {
  if (noSpeech > NO_SPEECH || langConf < LANG_MIN) return '';
  const t = text
    .replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*|[♪♫]/g, ' ')
    .replace(/(\S+)(?:\s+\1){3,}/gi, '$1 $1 $1')
    .replace(FILLERS[language] ?? FILLERS.other, (_, pre, punct) => (/[.!?…]/.test(punct) ? punct.replace(/,/g, '') : ' '))
    .replace(/,+([.!?…])/g, '$1')
    .replace(/\s+([,.!?…])/g, '$1')
    .replace(/^[\s,.!?…]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!/\p{L}/u.test(t)) return '';
  if (HALLUCINATIONS.some((re) => re.test(t)) || INTERJECTIONS[language]?.test(t)) return '';
  if ((noSpeech > UNSURE || langConf < LANG_UNSURE) && t.split(' ').length <= 2) return '';
  return t;
}

function handleResult(job, m) {
  const text = clean(m.text, m.language, m.noSpeech, m.langConf);
  const words = text ? text.split(' ') : [];
  if (job.final) {
    if (words.length >= 3) {
      for (const l in langScore) langScore[l] *= 0.7;
      langScore[m.language] = (langScore[m.language] ?? 0) + 0.3;
    }
    finishSegment(job.seg, words, m.language);
  } else if (words.length && job.seg === seg) {
    // A partial that finishes after its segment closed may contain audio of the next segment.
    partial(job.seg, words, m.language);
  }
}

// A word cut in half at a segment boundary is heard by both segments ("input the" + "The whole").
function joinCarry(words) {
  const norm = (w) => w?.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
  const dup = carry.words.length && norm(carry.words.at(-1)) === norm(words[0]);
  return [...carry.words, ...words.slice(dup ? 1 : 0)];
}

// Words both of the last two partials agree on are stable; complete sentences inside them
// are shown right away instead of waiting for the pause that closes the segment.
function partial(s, words, language) {
  const prev = prevPartial?.segId === s.id ? prevPartial.words : [];
  prevPartial = { segId: s.id, words };
  s.words = words;
  s.language = language;
  let stable = 0;
  while (stable < words.length && stable < prev.length && words[stable] === prev[stable]) stable++;
  let end = -1;
  for (let i = s.emitted; i < stable; i++) if (TERMINATOR.test(words[i])) end = i;
  if (end >= 0) {
    emit(joinCarry(words.slice(s.emitted, end + 1)), language);
    carry.words = [];
    s.lastEmitted = words[end];
    s.emitted = end + 1;
  }
  clearTimeout(flushTimer);
  live(joinCarry(words.slice(s.emitted)), language);
}

function finishSegment(s, words, language) {
  if (prevPartial?.segId === s.id) prevPartial = null;
  // Skip what partials already emitted; the final may word it slightly differently, so look
  // for the last emitted word near where it should be.
  let skip = s.emitted;
  if (s.emitted) {
    for (let j = Math.max(0, s.emitted - 3); j < Math.min(words.length, s.emitted + 3); j++) {
      if (words[j] === s.lastEmitted) skip = j + 1;
    }
  }
  const all = joinCarry(words.slice(skip));
  let start = 0;
  all.forEach((w, i) => {
    if (TERMINATOR.test(w)) {
      emit(all.slice(start, i + 1), language);
      start = i + 1;
    }
  });
  carry = { words: all.slice(start), language: language ?? carry.language };
  if (carry.words.length > MAX_CARRY) return flush();
  live(carry.words, carry.language);
  clearTimeout(flushTimer);
  if (carry.words.length) flushTimer = setTimeout(flush, FLUSH_MS);
}

function flush() {
  clearTimeout(flushTimer);
  if (carry.words.length) emit(carry.words, carry.language);
  carry = { words: [], language: null };
  live([], null);
}

async function emit(words, language) {
  const original = words.join(' ').trim();
  if (!original) return;
  // "Please. Please." or a sentence the final repeats: one caption is enough.
  if (original.toLowerCase() === lastSentence.text && Date.now() - lastSentence.t < 5000) return;
  lastSentence = { text: original.toLowerCase(), t: Date.now() };
  const id = ++sentenceSeq;
  send({ type: 'caption', id, original, translated: null, language, final: true });
  const translated = await translate(original, language);
  if (translated) send({ type: 'caption', id, original, translated, language, final: true });
}

// The sentence still being spoken. Translated only in instant mode, since translating a half
// sentence reorders words on every update (worst for verb-final languages like Turkish).
async function live(words, language) {
  const original = words.join(' ').trim();
  const version = ++liveVersion;
  send({ type: 'caption', id: 'live', live: true, original, translated: null, language });
  if (!settings.instant || !original) return;
  const translated = await translate(original, language);
  if (translated && version === liveVersion) {
    send({ type: 'caption', id: 'live', live: true, original, translated, language });
  }
}

// --- Translation (Chrome built-in, on-device) ---

const translators = new Map();
const reported = new Set();

function getTranslator(src) {
  if (!translators.has(src)) {
    translators.set(
      src,
      (async () => {
        if (!('Translator' in self)) {
          if (!reported.has('none')) status('warning', 'Chrome Translator API yok (Chrome 138+ gerekli)');
          reported.add('none');
          return null;
        }
        const pair = { sourceLanguage: src, targetLanguage: settings.target };
        const avail = await Translator.availability(pair);
        if (avail === 'unavailable') return null;
        if (avail === 'downloadable') {
          // Download needs a user click, which only the popup can provide.
          translators.delete(src);
          if (!reported.has(src)) send({ type: 'need-pair', source: src });
          reported.add(src);
          return null;
        }
        return Translator.create(pair);
      })().catch(() => {
        translators.delete(src);
        return null;
      }),
    );
  }
  return translators.get(src);
}

async function translate(text, src) {
  if (src === settings.target) return text;
  if (!('Translator' in self)) {
    if (!settings.translationEnabled || !worker) return null;
    const id = ++translationSeq;
    return new Promise((resolve) => {
      translations.set(id, resolve);
      worker.postMessage({
        type: 'translate',
        id,
        text,
        source: src === 'zh-Hant' ? 'zh' : src,
        target: settings.target === 'zh-Hant' ? 'zh' : settings.target,
      });
    });
  }
  const t = await getTranslator(src);
  if (!t) return null;
  if (src === 'en') for (const [re, to] of EN_GLOSSARY) text = text.replace(re, to);
  try {
    return await t.translate(text);
  } catch {
    return null;
  }
}
