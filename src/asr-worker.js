import {
  env,
  AutoProcessor,
  AutoTokenizer,
  WhisperForConditionalGeneration,
  LogitsProcessor,
  LogitsProcessorList,
} from '@huggingface/transformers';
import { MODELS, isCached } from './settings.js';

env.allowLocalModels = false;
// The cache path turns the ORT factory into a blob: URL, which extension CSP refuses to import.
env.useWasmCache = false;
env.backends.onnx.wasm.wasmPaths = {
  mjs: new URL('ort/ort-wasm-simd-threaded.asyncify.mjs', self.location.href).href,
  wasm: new URL('ort/ort-wasm-simd-threaded.asyncify.wasm', self.location.href).href,
};

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

let model, processor, tokenizer, gen, idToLang, langIds, prompter, suppress_tokens;

async function load(name) {
  const adapter = await navigator.gpu?.requestAdapter();
  const device = adapter ? 'webgpu' : 'wasm';
  const f16 = adapter?.features.has('shader-f16');
  // small costs ~50 ms more than base on a GPU and fixes most short-phrase mistakes; on CPU it is too slow.
  if (name === 'auto') name = device === 'webgpu' ? 'small' : 'base';
  let dtype;
  if (device === 'wasm') dtype = 'q8';
  else if (name === 'turbo') dtype = { encoder_model: f16 ? 'fp16' : 'q4', decoder_model_merged: 'q4' };
  else dtype = { encoder_model: 'fp32', decoder_model_merged: 'q4' };

  if (!MODELS[name]) name = 'base';
  const { id } = MODELS[name];
  const fromDisk = await isCached(name);
  const progress_callback = (p) => {
    if (p.status === 'progress_total') postMessage({ type: 'progress', progress: p.progress, fromDisk });
  };
  [model, processor, tokenizer] = await Promise.all([
    WhisperForConditionalGeneration.from_pretrained(id, { dtype, device, progress_callback }),
    AutoProcessor.from_pretrained(id),
    AutoTokenizer.from_pretrained(id),
  ]);

  gen = model.generation_config;
  idToLang = new Map(Object.entries(gen.lang_to_id).map(([tok, tid]) => [tid, tok.slice(2, -2)]));
  langIds = [...idToLang.keys()];
  prompter = new PromptProcessor(gen);
  suppress_tokens = gen.suppress_tokens.filter((t) => t !== prompter.noSpeechId);

  // First run compiles the WebGPU shaders; do it now instead of on the first caption.
  await transcribe(new Float32Array(16000), 'en');
  postMessage({ type: 'ready', device, model: name });
}

// prior: { language: weight } from earlier segments, used when the language is not fixed.
async function transcribe(audio, language, prior) {
  const { input_features } = await processor(audio);
  prompter.fixed = language ? gen.lang_to_id[`<|${language}|>`] : null;
  prompter.prior = prior && Object.keys(prior).length ? prior : null;
  const logits_processor = new LogitsProcessorList();
  logits_processor.push(prompter);
  // Cap output by audio length so a hallucination loop cannot run for hundreds of tokens.
  const max_new_tokens = Math.min(128, Math.ceil((audio.length / 16000) * 7) + 8);
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
    chain = chain.then(() => load(data.model)).catch((e) => postMessage({ type: 'error', message: String(e?.message ?? e) }));
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
  }
};
