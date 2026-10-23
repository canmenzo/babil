// Plays downloaded voices from a page: the offscreen document (Chrome), the background page
// (Firefox) or the options page. Synthesis runs in tts-worker.js.
export function createTtsPlayer({ threads }) {
  let worker, ctx, source;
  let seq = 0;
  let turn = 0;
  let slowRuns = 0;
  const jobs = new Map(); // worker job id -> resolve
  const cache = new Map(); // text and voice -> Promise of audio, so prepare() can run ahead

  function post(msg) {
    if (!worker) {
      worker = new Worker(`tts-worker.js?threads=${threads}`, { type: 'module' });
      worker.onmessage = ({ data }) => {
        const resolve = jobs.get(data.id);
        jobs.delete(data.id);
        resolve?.(data.type === 'audio' ? data : Promise.reject(new Error(data.message)));
      };
    }
    worker.postMessage(msg);
  }

  function synth(text, voice) {
    const key = JSON.stringify([text, voice]);
    if (!cache.has(key)) {
      const id = ++seq;
      cache.set(key, new Promise((resolve) => jobs.set(id, resolve)));
      post({ type: 'synth', id, text, voice });
      if (cache.size > 4) cache.delete(cache.keys().next().value);
    }
    const audio = cache.get(key);
    audio.catch(() => {});
    return [key, audio];
  }

  const player = {
    // Synthesis ran slower than real time twice in a row, or this page may not play audio: the
    // caller should use system voices instead.
    fallback: false,
    async speak(text, voice) {
      const t = ++turn;
      const [key, pending] = synth(text, voice);
      const audio = await pending;
      cache.delete(key);
      if (!audio || t !== turn) return;
      const seconds = audio.pcm.length / audio.sampleRate;
      slowRuns = audio.ms / 1000 > seconds ? slowRuns + 1 : 0;
      if (slowRuns >= 2) player.fallback = true;
      ctx ??= new AudioContext();
      // A page without a user gesture may not be allowed to play (Firefox background page).
      if (ctx.state !== 'running') await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 300))]);
      if (ctx.state !== 'running') {
        player.fallback = true;
        throw new Error('audio blocked');
      }
      const buffer = ctx.createBuffer(1, audio.pcm.length, audio.sampleRate);
      buffer.copyToChannel(audio.pcm, 0);
      source = ctx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = voice.playbackRate ?? 1;
      source.connect(ctx.destination);
      await new Promise((resolve) => {
        source.onended = resolve;
        source.start();
      });
    },
    prepare(text, voice) {
      synth(text, voice);
    },
    stop() {
      turn++;
      source?.stop();
      source = null;
      for (const resolve of jobs.values()) resolve(null);
      jobs.clear();
      cache.clear();
      worker?.postMessage({ type: 'cancel' });
    },
    load: (pack) => post({ type: 'load', pack }),
    download: (pack) => post({ type: 'download', pack }),
    remove: (pack) => post({ type: 'delete', pack }),
  };
  return player;
}
