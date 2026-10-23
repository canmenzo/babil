import { phonemeIds } from './pinyin.js';

// A Piper voice with pinyin phonemes (Chinese). Each sentence is synthesized and peak-normalized on
// its own, like piper does.
export async function createPiper({ ort, read, options }) {
  const config = JSON.parse(new TextDecoder().decode(await read('voice.onnx.json')));
  const session = await ort.InferenceSession.create(await read('voice.onnx'), options);
  const { noise_scale, length_scale, noise_w } = config.inference;
  return {
    sampleRate: config.audio.sample_rate,
    async synth(text, { lengthScale = 1, noiseScale = 1 }) {
      const parts = [];
      for (const ids of phonemeIds(text, config.phoneme_id_map)) {
        const { output } = await session.run({
          input: new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]),
          input_lengths: new ort.Tensor('int64', BigInt64Array.of(BigInt(ids.length)), [1]),
          scales: new ort.Tensor('float32', Float32Array.of(noise_scale * noiseScale, length_scale * lengthScale, noise_w), [3]),
        });
        let peak = 0;
        for (const x of output.data) peak = Math.max(peak, Math.abs(x));
        parts.push(output.data.map((x) => (peak > 1e-8 ? x / peak : 0)));
      }
      const pcm = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
      let at = 0;
      for (const p of parts) {
        pcm.set(p, at);
        at += p.length;
      }
      return pcm;
    },
    release: () => session.release(),
  };
}
