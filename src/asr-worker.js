import {
  env,
  AutoModel,
  AutoProcessor,
  AutoTokenizer,
  WhisperForConditionalGeneration,
  MoonshineForConditionalGeneration,
  LogitsProcessor,
  LogitsProcessorList,
  pipeline,
  ModelRegistry,
  Tensor,
} from '@huggingface/transformers';
import { MODELS, VAD_ID, isCached, modelDevice, modelDtype, autoModel } from './settings.js';

env.allowLocalModels = false;
// The cache path turns the ORT factory into a blob: URL, which extension CSP refuses to import.
env.useWasmCache = false;

// CacheStorage throws "Unexpected internal error" on chrome-extension:// origins and transformers.js
// swallows it, so every start re-downloaded the model. Keep the files in OPFS instead.
const fileName = (key) => encodeURIComponent(key);
const opfsCache = {
  async match(key) {
    try {
      const dir = await navigator.storage.getDirectory();
      const file = await (await dir.getFileHandle(fileName(key))).getFile();
      return new Response(file, { headers: { 'content-length': String(file.size) } });
    } catch {
      return undefined;
    }
  },
  async put(key, response) {
    const dir = await navigator.storage.getDirectory();
    // Write under a temporary name so an interrupted download never looks like a cached file.
    const part = await dir.getFileHandle(`${fileName(key)}.part`, { create: true });
    await response.body.pipeTo(await part.createWritable());
    await part.move(fileName(key));
  },
};
env.useBrowserCache = false;
env.useCustomCache = true;
env.customCache = opfsCache;

const PRIOR_FLOOR = 0.01;
const VAD_WINDOW = 512;
const VAD_CONTEXT = 64;
const VAD_PROB = 0.5;
const VAD_MIN_SHARE = 0.1; // of a segment, below this Moonshine would be guessing at noise or music

// Decoding starts at <|startoftranscript|>. At the first step this records Whisper's no-speech
// probability and how sure it is of the language, then picks the language token, and forces
// <|transcribe|> <|notimestamps|> after that. One pass gives speech check, language and text.
class PromptProcessor extends LogitsProcessor {
  noSpeech = 0;

  constructor(gen) {
    super();
    this.transcribeId = gen.task_to_id.transcribe;
    this.noTimestampsId = gen.no_timestamps_token_id;
    this.noSpeechId = gen.no_timestamps_token_id - 1; // <|nocaptions|> (v2) / <|nospeech|> (v3)
  }

  _call(input_ids, logits) {
    for (let i = 0; i < input_ids.length; i++) {
      const data = logits[i].data;
      const n = input_ids[i].length;
      if (n === 1) {
        let max = -Infinity;
        for (const v of data) if (v > max) max = v;
        let sum = 0;
        for (const v of data) sum += Math.exp(v - max);
        this.noSpeech = Math.exp(data[this.noSpeechId] - max) / sum;
        // large-v3-turbo always reports no-speech ~0, but on noise and music its language guess is
        // spread thin (top two ~0.5) while speech gives ~1, so this doubles as a speech check.
        const p = langIds.map((id) => Math.exp(data[id] - max));
        const z = p.reduce((a, b) => a + b);
        const [first, second] = [...p].sort((a, b) => b - a);
        this.langConf = (first + second) / z;
        // Auto-detect leans on the languages heard so far, so one noisy guess cannot switch to Korean.
        let best = this.fixed;
        if (!best) {
          let bestScore = -Infinity;
          langIds.forEach((id, k) => {
            const score = Math.log(p[k]) + (this.prior ? Math.log(this.prior[idToLang.get(id)] ?? PRIOR_FLOOR) : 0);
            if (score > bestScore) [best, bestScore] = [id, score];
          });
        }
        data.fill(-Infinity);
        data[best] = 0;
      } else if (n <= 3) {
        // The default suppress list already set <|transcribe|> to -Infinity, so force it outright.
        data.fill(-Infinity);
        data[n === 2 ? this.transcribeId : this.noTimestampsId] = 0;
      } else {
        data[this.noSpeechId] = -Infinity;
      }
    }
    return logits;
  }
}

let vad, arch, model, processor, tokenizer, gen, idToLang, langIds, prompter, suppress_tokens;
let device = 'wasm';
let f16 = false;
let translator;

async function load(name, source) {
  ({ device, f16 } = await modelDevice());
  // WebGPU needs the asyncify build; on the CPU the plain one is 10-14% faster.
  const build = device === 'webgpu' ? '.asyncify' : '';
  env.backends.onnx.wasm.wasmPaths = {
    mjs: new URL(`ort/ort-wasm-simd-threaded${build}.mjs`, self.location.href).href,
    wasm: new URL(`ort/ort-wasm-simd-threaded${build}.wasm`, self.location.href).href,
  };
  if (device === 'wasm') env.backends.onnx.wasm.numThreads = Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 2) - 1));
  if (name === 'auto') name = autoModel(device, source);
  if (!MODELS[name]) name = 'base';
  const dtype = modelDtype(name, device, f16);
  const { id } = MODELS[name];
  arch = MODELS[name].arch;
  const Model = arch === 'moonshine' ? MoonshineForConditionalGeneration : WhisperForConditionalGeneration;
  vad = arch === 'moonshine' ? await AutoModel.from_pretrained(VAD_ID, { config: { model_type: 'custom' }, dtype: 'fp32', device: 'wasm' }) : null;
  const fromDisk = await isCached(name);
  const progress_callback = (p) => {
    if (p.status === 'progress_total') postMessage({ type: 'progress', progress: p.progress, fromDisk });
  };
  [model, processor, tokenizer] = await Promise.all([
    Model.from_pretrained(id, { dtype, device, progress_callback }),
    AutoProcessor.from_pretrained(id),
    AutoTokenizer.from_pretrained(id),
  ]);

  if (arch !== 'moonshine') {
    gen = model.generation_config;
    idToLang = new Map(Object.entries(gen.lang_to_id).map(([tok, tid]) => [tid, tok.slice(2, -2)]));
    langIds = [...idToLang.keys()];
    prompter = new PromptProcessor(gen);
    suppress_tokens = gen.suppress_tokens.filter((t) => t !== prompter.noSpeechId);
  }

  // First run compiles the WebGPU shaders; do it now instead of on the first caption.
  await transcribe(new Float32Array(16000), 'en');
  postMessage({ type: 'ready', device, model: name });
}

// Fetches the files load() would, into the same cache, without loading the model.
async function download(name) {
  const { id } = MODELS[name];
  ({ device, f16 } = await modelDevice());
  const files = await ModelRegistry.get_files(id, { dtype: modelDtype(name, device, f16), device });
  const url = ([repo, file]) => `https://huggingface.co/${repo}/resolve/main/${file}`;
  const wanted = files.map((file) => [id, file]);
  if (MODELS[name].arch === 'moonshine') wanted.push([VAD_ID, 'onnx/model.onnx']);
  const missing = [];
  for (const f of wanted) if (!(await opfsCache.match(url(f)))) missing.push(f);
  const sizes = await Promise.all(missing.map(([repo, file]) => ModelRegistry.get_file_metadata(repo, file)));
  const total = sizes.reduce((n, m) => n + (m.size ?? 0), 0);
  let loaded = 0;
  let shown = -1;
  for (const file of missing) {
    const res = await fetch(url(file));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const count = new TransformStream({
      transform(chunk, ctl) {
        loaded += chunk.length;
        const pct = Math.min(99, Math.floor((100 * loaded) / total));
        if (pct !== shown) postMessage({ type: 'download-progress', progress: (shown = pct) });
        ctl.enqueue(chunk);
      },
    });
    await opfsCache.put(url(file), new Response(res.body.pipeThrough(count)));
  }
}

// The share of the audio the voice detector calls speech.
async function speechShare(audio) {
  const sr = new Tensor('int64', [16000n], []);
  let state = new Tensor('float32', new Float32Array(2 * 128), [2, 1, 128]);
  let voiced = 0;
  let total = 0;
  // Silero v5 reads each window with the 64 samples before it.
  const window = new Float32Array(VAD_CONTEXT + VAD_WINDOW);
  for (let i = 0; i + VAD_WINDOW <= audio.length; i += VAD_WINDOW, total++) {
    window.copyWithin(0, VAD_WINDOW);
    window.set(audio.subarray(i, i + VAD_WINDOW), VAD_CONTEXT);
    const input = new Tensor('float32', window.slice(), [1, window.length]);
    const { output, stateN } = await vad({ input, sr, state });
    state = stateN;
    if (output.data[0] > VAD_PROB) voiced++;
  }
  return total ? voiced / total : 0;
}

async function loadTranslator() {
  if (translator) return;
  const progress_callback = (p) => {
    if (p.status === 'progress_total') postMessage({ type: 'translation-progress', progress: p.progress });
  };
  translator = await pipeline('translation', 'Xenova/m2m100_418M', {
    device,
    dtype: device === 'webgpu' && f16 ? 'q4f16' : 'q8',
    progress_callback,
  });
  postMessage({ type: 'translation-ready' });
}

// prior: { language: weight } from earlier segments, used when the language is not fixed.
async function transcribe(audio, language, prior) {
  // Cap output by audio length so a hallucination loop cannot run for hundreds of tokens.
  const max_new_tokens = Math.min(128, Math.ceil((audio.length / 16000) * 7) + 8);
  if (arch === 'moonshine') {
    const share = await speechShare(audio);
    if (share < VAD_MIN_SHARE) return { text: '', language: 'en', noSpeech: 1, langConf: 1, speechShare: share };
    const { input_values } = await processor(audio);
    const out = await model.generate({ input_values, max_new_tokens });
    const ids = (out.sequences ?? out).tolist()[0].map(Number);
    return { text: tokenizer.decode(ids, { skip_special_tokens: true }).trim(), language: 'en', noSpeech: 0, langConf: 1, speechShare: share };
  }
  const { input_features } = await processor(audio);
  prompter.fixed = language ? gen.lang_to_id[`<|${language}|>`] : null;
  prompter.prior = prior && Object.keys(prior).length ? prior : null;
  const logits_processor = new LogitsProcessorList();
  logits_processor.push(prompter);
  const out = await model.generate({
    inputs: input_features,
    decoder_input_ids: [gen.decoder_start_token_id],
    logits_processor,
    suppress_tokens,
    max_new_tokens,
  });
  const ids = (out.sequences ?? out).tolist()[0].map(Number);
  return {
    text: tokenizer.decode(ids, { skip_special_tokens: true }).trim(),
    language: idToLang.get(ids[1]) || language || 'en',
    noSpeech: prompter.noSpeech,
    langConf: prompter.langConf,
  };
}

// Jobs are serialized; the GPU can only usefully run one at a time anyway.
let chain = Promise.resolve();

self.onmessage = ({ data }) => {
  if (data.type === 'load') {
    chain = chain.then(() => load(data.model, data.source)).catch((e) => postMessage({ type: 'error', message: String(e?.message ?? e) }));
  } else if (data.type === 'download') {
    download(data.model).then(
      () => postMessage({ type: 'download-done' }),
      (e) => postMessage({ type: 'download-done', error: String(e?.message ?? e) }),
    );
  } else if (data.type === 'transcribe') {
    chain = chain.then(async () => {
      const t0 = performance.now();
      try {
        const r = await transcribe(data.audio, data.language, data.prior);
        postMessage({ type: 'result', id: data.id, ...r, ms: Math.round(performance.now() - t0) });
      } catch (e) {
        postMessage({ type: 'result', id: data.id, text: '', error: String(e?.message ?? e) });
      }
    });
  } else if (data.type === 'translation-load') {
    chain = chain.then(loadTranslator).catch((e) => postMessage({ type: 'translation-error', message: String(e?.message ?? e) }));
  } else if (data.type === 'translate') {
    chain = chain.then(async () => {
      try {
        await loadTranslator();
        const [result] = await translator(data.text, { src_lang: data.source, tgt_lang: data.target });
        postMessage({ type: 'translated', id: data.id, text: result.translation_text });
      } catch (e) {
        postMessage({ type: 'translation-error', message: String(e?.message ?? e) });
        postMessage({ type: 'translated', id: data.id, text: null });
      }
    });
  }
};
