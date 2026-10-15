import {
  env,
  AutoProcessor,
  AutoTokenizer,
  WhisperForConditionalGeneration,
  LogitsProcessor,
  LogitsProcessorList,
} from '@huggingface/transformers';

env.allowLocalModels = false;
// The cache path turns the ORT factory into a blob: URL, which extension CSP refuses to import.
env.useWasmCache = false;
env.backends.onnx.wasm.wasmPaths = {
  mjs: new URL('ort/ort-wasm-simd-threaded.asyncify.mjs', self.location.href).href,
  wasm: new URL('ort/ort-wasm-simd-threaded.asyncify.wasm', self.location.href).href,
};

const MODELS = {
  tiny: 'onnx-community/whisper-tiny',
  base: 'onnx-community/whisper-base',
  small: 'onnx-community/whisper-small',
  turbo: 'onnx-community/whisper-large-v3-turbo',
};

// After <|startoftranscript|>: allow only a language token, then force <|transcribe|> <|notimestamps|>.
// This gives Whisper's own language detection and the transcript in a single pass.
class AutoLanguageProcessor extends LogitsProcessor {
  constructor(langIds, transcribeId, noTimestampsId) {
    super();
    this.langIds = langIds;
    this.transcribeId = transcribeId;
    this.noTimestampsId = noTimestampsId;
  }

  _call(input_ids, logits) {
    for (let i = 0; i < input_ids.length; i++) {
      const data = logits[i].data;
      const n = input_ids[i].length;
      if (n > 3) continue;
      if (n === 1) {
        const kept = this.langIds.map((id) => data[id]);
        data.fill(-Infinity);
        this.langIds.forEach((id, k) => (data[id] = kept[k]));
      } else {
        // The default suppress list already set <|transcribe|> to -Infinity, so force it outright.
        data.fill(-Infinity);
        data[n === 2 ? this.transcribeId : this.noTimestampsId] = 0;
      }
    }
    return logits;
  }
}

let model, processor, tokenizer, gen, idToLang, autoProcessor;

async function load(name) {
  const adapter = await navigator.gpu?.requestAdapter();
  const device = adapter ? 'webgpu' : 'wasm';
  const f16 = adapter?.features.has('shader-f16');
  // small costs ~70 ms more than base on a GPU and fixes most short-phrase mistakes; on CPU it is too slow.
  if (name === 'auto') name = device === 'webgpu' ? 'small' : 'base';
  let dtype;
  if (device === 'wasm') dtype = 'q8';
  else if (name === 'turbo') dtype = { encoder_model: f16 ? 'fp16' : 'q4', decoder_model_merged: 'q4' };
  else dtype = { encoder_model: 'fp32', decoder_model_merged: 'q4' };

  const id = MODELS[name] ?? MODELS.base;
  const progress_callback = (p) => {
    if (p.status === 'progress_total') postMessage({ type: 'progress', progress: p.progress });
  };
  [model, processor, tokenizer] = await Promise.all([
    WhisperForConditionalGeneration.from_pretrained(id, { dtype, device, progress_callback }),
    AutoProcessor.from_pretrained(id),
    AutoTokenizer.from_pretrained(id),
  ]);

  gen = model.generation_config;
  idToLang = new Map(Object.entries(gen.lang_to_id).map(([tok, tid]) => [tid, tok.slice(2, -2)]));
  autoProcessor = new AutoLanguageProcessor(
    [...idToLang.keys()],
    gen.task_to_id.transcribe,
    gen.no_timestamps_token_id,
  );

  // First run compiles the WebGPU shaders; do it now instead of on the first caption.
  await transcribe(new Float32Array(16000), 'en');
  postMessage({ type: 'ready', device, model: name });
}

async function transcribe(audio, language) {
  const { input_features } = await processor(audio);
  const auto = !language;
  const decoder_input_ids = [
    gen.decoder_start_token_id,
    ...(auto ? [] : [gen.lang_to_id[`<|${language}|>`], gen.task_to_id.transcribe, gen.no_timestamps_token_id]),
  ];
  let logits_processor = null;
  if (auto) {
    logits_processor = new LogitsProcessorList();
    logits_processor.push(autoProcessor);
  }
  // Cap output by audio length so a hallucination loop cannot run for hundreds of tokens.
  const max_new_tokens = Math.min(128, Math.ceil((audio.length / 16000) * 7) + 8);
  const out = await model.generate({
    inputs: input_features,
    decoder_input_ids,
    logits_processor,
    max_new_tokens,
  });
  const ids = (out.sequences ?? out).tolist()[0].map(Number);
  return {
    text: tokenizer.decode(ids, { skip_special_tokens: true }).trim(),
    language: language || idToLang.get(ids[1]) || 'en',
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
        const r = await transcribe(data.audio, data.language);
        postMessage({ type: 'result', id: data.id, ...r, ms: Math.round(performance.now() - t0) });
      } catch (e) {
        postMessage({ type: 'result', id: data.id, text: '', error: String(e?.message ?? e) });
      }
    });
  }
};
