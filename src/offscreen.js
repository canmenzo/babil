// Audio capture, segmentation, ASR scheduling and translation. One instance per extension.
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
let lagReported = 0;

let seg = null; // { id, frames, rms, speech, quiet, sinceProbe, words, language, emitted, lastEmitted }
let preroll = []; // [frame, rms] while no segment is open
let nextId = 1;
let noise = 0.005;
let lastLang = null;

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
  chrome.runtime.sendMessage({ target: 'bg', ...msg }).catch(() => {});
}

function status(state, text, extra = {}) {
  send({ type: 'status', state, text, ...extra });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target !== 'offscreen') return;
  if (msg.type === 'start') start(msg.streamId, msg.settings);
  else if (msg.type === 'stop') stop('Durduruldu');
});

async function start(streamId, s) {
  settings = s;
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

  worker = new Worker('asr-worker.js', { type: 'module' });
  worker.onmessage = ({ data }) => onWorker(data);
  status('loading', 'Model yükleniyor...', { progress: 0 });
  worker.postMessage({ type: 'load', model: settings.model });
  busy = true; // released on 'ready'

  if (settings.source !== 'auto' && settings.source !== settings.target) getTranslator(settings.source);
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
  const closed = { ...seg, frames: seg.frames.slice(0, end), rms: seg.rms.slice(0, end) };
  const rest = seg.frames.slice(end);
  const restRms = seg.rms.slice(end);
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
  const language = settings.source === 'auto' ? (job.final ? null : lastLang) : settings.source;
  worker.postMessage({ type: 'transcribe', id, audio: job.audio, language }, [job.audio.buffer]);
}

function onWorker(m) {
  if (m.type === 'progress') {
    const verb = m.fromDisk ? 'yükleniyor' : 'indiriliyor';
    status('loading', `Model ${verb} %${Math.round(m.progress)}`, { progress: m.progress });
  } else if (m.type === 'ready') {
    busy = false;
    ready = true;
    const where = m.device === 'webgpu' ? 'GPU' : 'CPU, yavaş olabilir';
    status('running', `Çalışıyor (${where}, Whisper ${m.model})`, { device: m.device });
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

function clean(text, language, noSpeech) {
  if (noSpeech > NO_SPEECH) return '';
  const t = text
    .replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*|[♪♫]/g, ' ')
    .replace(FILLERS[language] ?? FILLERS.other, (_, pre, punct) => (/[.!?…]/.test(punct) ? punct.replace(/,/g, '') : ' '))
    .replace(/,+([.!?…])/g, '$1')
    .replace(/\s+([,.!?…])/g, '$1')
    .replace(/^[\s,.!?…]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!/\p{L}/u.test(t)) return '';
  if (HALLUCINATIONS.some((re) => re.test(t)) || INTERJECTIONS[language]?.test(t)) return '';
  if (noSpeech > UNSURE && t.split(' ').length <= 2) return '';
  return t;
}

function handleResult(job, m) {
  const text = clean(m.text, m.language, m.noSpeech);
  const words = text ? text.split(' ') : [];
  if (job.final) {
    if (settings.source === 'auto' && text) lastLang = m.language;
    finishSegment(job.seg, words, m.language);
  } else if (words.length) {
    partial(job.seg, words, m.language);
  }
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
    emit([...carry.words, ...words.slice(s.emitted, end + 1)], language);
    carry.words = [];
    s.lastEmitted = words[end];
    s.emitted = end + 1;
  }
  clearTimeout(flushTimer);
  live([...carry.words, ...words.slice(s.emitted)], language);
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
  const all = [...carry.words, ...words.slice(skip)];
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
  const t = await getTranslator(src);
  if (!t) return null;
  if (src === 'en') for (const [re, to] of EN_GLOSSARY) text = text.replace(re, to);
  try {
    return await t.translate(text);
  } catch {
    return null;
  }
}
