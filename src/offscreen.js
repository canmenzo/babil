// Audio capture, segmentation, ASR scheduling and translation. One instance per extension.
const TARGET = 'tr';
const FRAME = 1600; // 100 ms at 16 kHz, matches worklet.js

// Latency tuning, all in 100 ms frames.
const MIN_FINAL = 8; // a segment needs at least 0.8 s before a pause can close it
const PAUSE = 3; // 0.3 s of quiet closes the segment
const MAX_SEG = 50; // hard cut at 5 s so continuous talk (streams) still finalizes
const CUT_SEARCH = 15; // on a hard cut, split at the quietest frame within the last 1.5 s
const PARTIAL_EVERY = 6; // re-run the open segment every 0.6 s of new audio
const MIN_SPEECH = 3; // segments with fewer loud frames are dropped (Whisper hallucinates on silence)
const MAX_BACKLOG = 2; // finals waiting beyond this are committed with their last partial text

const HALLUCINATIONS = [
  /altyaz[ıi].*m\.?\s?k\.?/i,
  /amara\.org/i,
  /^(thanks|thank you) for watching[.!]?$/i,
  /^abone ol/i,
  /^(\.|,|!|\?|-|\s)+$/,
];

let stream, playCtx, asrCtx, worker;
let settings = {};
let running = false;
let ready = false;
let lagReported = 0;

let seg = null; // { id, frames: Float32Array[], rms: number[], speech, quiet, sinceProbe, partial }
let nextId = 1;
let noise = 0.005;
let lastLang = null;

const finals = []; // closed segments waiting for ASR
let busy = false;
const jobs = new Map(); // worker job id -> { segId, final, seg }
let jobSeq = 0;
const finalized = new Set();

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

  if (settings.source !== 'auto' && settings.source !== TARGET) getTranslator(settings.source);
}

function stop(text) {
  if (!running) return;
  running = false;
  ready = false;
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
    if (!loud) return;
    seg = { id: nextId++, frames: [], rms: [], speech: 0, quiet: 0, sinceProbe: 0, partial: null };
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

// Close the open segment at frame `end`; frames after it start the next segment.
function closeSegment(end) {
  const closed = { ...seg, frames: seg.frames.slice(0, end), rms: seg.rms.slice(0, end) };
  const rest = seg.frames.slice(end);
  const restRms = seg.rms.slice(end);
  seg = null;
  const threshold = Math.max(0.004, noise * 2.5);
  if (restRms.some((r) => r > threshold)) {
    seg = {
      id: nextId++,
      frames: rest,
      rms: restRms,
      speech: restRms.filter((r) => r > threshold).length,
      quiet: 0,
      sinceProbe: rest.length,
      partial: null,
    };
  }

  if (closed.speech < MIN_SPEECH) {
    if (closed.partial) commit(closed, closed.partial);
    return;
  }
  finals.push(closed);
  while (finals.length > MAX_BACKLOG) {
    const dropped = finals.shift();
    if (dropped.partial) commit(dropped, dropped.partial);
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
    status('loading', `Model indiriliyor %${Math.round(m.progress)}`, { progress: m.progress });
  } else if (m.type === 'ready') {
    busy = false;
    ready = true;
    status('running', m.device === 'webgpu' ? 'Çalışıyor (GPU)' : 'Çalışıyor (CPU, yavaş olabilir)', { device: m.device });
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

function clean(text) {
  const t = text
    .replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*|[♪♫]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return HALLUCINATIONS.some((re) => re.test(t)) ? '' : t;
}

function handleResult(job, m) {
  if (finalized.has(job.segId)) return;
  const text = clean(m.text);
  if (job.final) {
    if (settings.source === 'auto' && text) lastLang = m.language;
    commit(job.seg, text ? { text, language: m.language } : job.seg.partial);
  } else if (text) {
    job.seg.partial = { text, language: m.language };
    show(job.segId, text, m.language, false);
  }
}

function commit(s, result) {
  finalized.add(s.id);
  if (result) show(s.id, result.text, result.language, true);
  else send({ type: 'caption', id: s.id, remove: true });
}

async function show(id, original, language, final) {
  send({ type: 'caption', id, original, translated: null, language, final });
  const translated = await translate(original, language);
  if (!final && finalized.has(id)) return; // a stale partial must not overwrite the final line
  if (translated) send({ type: 'caption', id, original, translated, language, final });
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
        const avail = await Translator.availability({ sourceLanguage: src, targetLanguage: TARGET });
        if (avail === 'unavailable') return null;
        if (avail === 'downloadable') {
          // Download needs a user click, which only the popup can provide.
          translators.delete(src);
          if (!reported.has(src)) send({ type: 'need-pair', source: src });
          reported.add(src);
          return null;
        }
        return Translator.create({ sourceLanguage: src, targetLanguage: TARGET });
      })().catch(() => {
        translators.delete(src);
        return null;
      }),
    );
  }
  return translators.get(src);
}

async function translate(text, src) {
  if (src === TARGET) return text;
  const t = await getTranslator(src);
  if (!t) return null;
  try {
    return await t.translate(text);
  } catch {
    return null;
  }
}
