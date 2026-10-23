// Ported from Supertonic's web/helper.js (MIT, Copyright (c) 2025 Supertone Inc.), with typed arrays.

const REPLACE = {
  '–': '-', '‑': '-', '—': '-', _: ' ', '“': '"', '”': '"', '‘': "'", '’': "'", '´': "'", '`': "'",
  '[': ' ', ']': ' ', '|': ' ', '/': ' ', '#': ' ', '→': ' ', '←': ' ', '@': ' at ', 'e.g.,': 'for example, ', 'i.e.,': 'that is, ',
};
const EMOJI = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+/gu;

function preprocess(text, lang) {
  text = text.normalize('NFKD').replace(EMOJI, '');
  for (const [k, v] of Object.entries(REPLACE)) text = text.replaceAll(k, v);
  text = text
    .replace(/[♥☆♡©\\]/g, '')
    .replace(/ ([,.!?;:'])/g, '$1')
    .replace(/"{2,}/g, '"')
    .replace(/'{2,}/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  if (!/[.!?;:,'"')\]}…。」』】〉》›»]$/.test(text)) text += '.';
  return `<${lang}>${text}</${lang}>`;
}

const ABBREV = /(?<!Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.|Sr\.|Jr\.|Ph\.D\.|etc\.|e\.g\.|i\.e\.|vs\.|Inc\.|Ltd\.|Co\.|Corp\.|St\.|Ave\.|Blvd\.)(?<!\b[A-Z]\.)(?<=[.!?])\s+/;

function chunks(text, max) {
  const out = [];
  for (const para of text.trim().split(/\n\s*\n+/)) {
    let cur = '';
    for (const s of para.trim().split(ABBREV)) {
      if (cur && cur.length + s.length + 1 > max) {
        out.push(cur);
        cur = s;
      } else cur += (cur ? ' ' : '') + s;
    }
    if (cur) out.push(cur);
  }
  return out;
}

// read(name) returns a file of the pack as bytes. Styles are F1-F5 and M1-M5.
export async function createSupertonic({ ort, read, options, steps = 4 }) {
  const json = async (name) => JSON.parse(new TextDecoder().decode(await read(name)));
  const [cfg, indexer] = await Promise.all([json('tts.json'), json('unicode_indexer.json')]);
  const sessions = [];
  // One at a time: each create briefly holds the file bytes twice.
  for (const name of ['duration_predictor', 'text_encoder', 'vector_estimator', 'vocoder']) {
    sessions.push(await ort.InferenceSession.create(await read(`${name}.onnx`), options));
  }
  const [dp, enc, est, voc] = sessions;
  const sampleRate = cfg.ae.sample_rate;
  const chunkSize = cfg.ae.base_chunk_size * cfg.ttl.chunk_compress_factor;
  const dim = cfg.ttl.latent_dim * cfg.ttl.chunk_compress_factor;
  const styles = new Map();
  const f32 = (data, dims) => new ort.Tensor('float32', data, dims);

  async function style(name) {
    if (!styles.has(name)) {
      const s = await json(`${name}.json`);
      const t = (v) => f32(Float32Array.from(v.data.flat(Infinity)), v.dims);
      styles.set(name, { ttl: t(s.style_ttl), dp: t(s.style_dp) });
    }
    return styles.get(name);
  }

  async function infer(text, lang, st, speed) {
    const s = preprocess(text, lang);
    const n = s.length;
    const ids = new BigInt64Array(n);
    for (let j = 0; j < n; j++) {
      const cp = s.codePointAt(j);
      ids[j] = BigInt(cp < indexer.length ? indexer[cp] : -1);
    }
    const text_ids = new ort.Tensor('int64', ids, [1, n]);
    const text_mask = f32(new Float32Array(n).fill(1), [1, 1, n]);
    const { duration } = await dp.run({ text_ids, style_dp: st.dp, text_mask });
    const samples = Math.floor((duration.data[0] / speed) * sampleRate);
    const { text_emb } = await enc.run({ text_ids, style_ttl: st.ttl, text_mask });

    const len = Math.ceil(samples / chunkSize);
    let xt = new Float32Array(dim * len);
    for (let i = 0; i < xt.length; i++) {
      const u1 = Math.max(0.0001, Math.random());
      xt[i] = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * Math.random());
    }
    const latent_mask = f32(new Float32Array(len).fill(1), [1, 1, len]);
    const total_step = f32(new Float32Array([steps]), [1]);
    for (let step = 0; step < steps; step++) {
      const out = await est.run({
        noisy_latent: f32(xt, [1, dim, len]),
        text_emb,
        style_ttl: st.ttl,
        latent_mask,
        text_mask,
        current_step: f32(new Float32Array([step]), [1]),
        total_step,
      });
      xt = out.denoised_latent.data;
    }
    const { wav_tts } = await voc.run({ latent: f32(xt, [1, dim, len]) });
    return wav_tts.data.subarray(0, samples);
  }

  return {
    sampleRate,
    async synth(text, lang, styleName, speed = 1.05) {
      const st = await style(styleName);
      const parts = [];
      for (const c of chunks(text, lang === 'ja' || lang === 'ko' ? 120 : 300)) parts.push(await infer(c, lang, st, speed));
      const gap = Math.floor(0.3 * sampleRate);
      const pcm = new Float32Array(parts.reduce((n, p) => n + p.length, 0) + gap * (parts.length - 1));
      let at = 0;
      for (const p of parts) {
        pcm.set(p, at);
        at += p.length + gap;
      }
      return pcm;
    },
    release: () => Promise.all(sessions.map((s) => s.release())),
  };
}
