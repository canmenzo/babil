// Downloads voice packs into OPFS and synthesizes speech with them, one job at a time. Download
// progress goes to every extension page on the 'babil-tts' BroadcastChannel.
import * as ort from 'onnxruntime-web/webgpu';
import { PACKS, packBytes } from './tts/catalog.js';
import { createSupertonic } from './tts/supertonic.js';
import { createPiper } from './tts/piper.js';

ort.env.wasm.wasmPaths = {
  mjs: new URL('ort/ort-wasm-simd-threaded.asyncify.mjs', self.location.href).href,
  wasm: new URL('ort/ort-wasm-simd-threaded.asyncify.wasm', self.location.href).href,
};
// Threads need cross-origin isolation; without it ORT runs on one.
ort.env.wasm.numThreads = Number(new URL(self.location.href).searchParams.get('threads')) || 2;

const channel = new BroadcastChannel('babil-tts');
const announce = (msg) => channel.postMessage(msg);

async function packDir(pack, create = false) {
  const tts = await (await navigator.storage.getDirectory()).getDirectoryHandle('tts', { create });
  return tts.getDirectoryHandle(pack, { create });
}

async function sha256(file) {
  const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Written under .part and moved into place once the hash matches, as in asr-worker.js.
async function fetchFile(dir, name, { url, sha256: want }, progress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const part = await dir.getFileHandle(`${name}.part`, { create: true });
  let got = 0;
  const count = new TransformStream({
    transform(chunk, ctl) {
      got += chunk.length;
      progress(chunk.length);
      ctl.enqueue(chunk);
    },
  });
  try {
    await res.body.pipeThrough(count).pipeTo(await part.createWritable());
    if ((await sha256(await part.getFile())) !== want) throw new Error(`${name}: checksum mismatch`);
    await part.move(name);
  } catch (e) {
    progress(-got);
    await dir.removeEntry(`${name}.part`).catch(() => {});
    throw e;
  }
}

async function download(pack) {
  const dir = await packDir(pack, true);
  const have = new Set();
  for await (const name of dir.keys()) have.add(name);
  const total = packBytes(pack);
  let loaded = 0;
  let shown = 0;
  const progress = (n) => {
    loaded += n;
    if (Math.abs(loaded - shown) > total / 200) announce({ type: 'progress', pack, loaded: (shown = loaded), total });
  };
  for (const f of PACKS[pack].files) {
    if (have.has(f.name)) {
      progress(f.sources[0].bytes);
      continue;
    }
    // A later source is the fallback for a missing or changed earlier one.
    for (const [i, src] of f.sources.entries()) {
      try {
        await fetchFile(dir, f.name, src, progress);
        break;
      } catch (e) {
        if (i === f.sources.length - 1) throw e;
      }
    }
  }
}

// The options page and the captions may both ask for a pack; the lock makes one of them wait and
// then find the files already there.
const downloads = new Map();
function ensure(pack) {
  if (!downloads.has(pack)) {
    const job = navigator.locks
      .request(`babil-tts:${pack}`, () => download(pack))
      .then(
        () => announce({ type: 'ready', pack }),
        (e) => announce({ type: 'error', pack, message: String(e?.message ?? e) }),
      )
      .finally(() => downloads.delete(pack));
    downloads.set(pack, job);
  }
  return downloads.get(pack);
}

const engines = new Map();
function engine(pack) {
  if (!engines.has(pack)) {
    const load = async () => {
      const dir = await packDir(pack);
      const read = async (name) => new Uint8Array(await (await (await dir.getFileHandle(name)).getFile()).arrayBuffer());
      const options = { executionProviders: ['wasm'] };
      return pack === 'supertonic3' ? createSupertonic({ ort, read, options }) : createPiper({ ort, read, options });
    };
    const job = load();
    job.catch(() => engines.delete(pack));
    engines.set(pack, job);
  }
  return engines.get(pack);
}

async function synth(text, voice) {
  const e = await engine(voice.pack);
  const t0 = performance.now();
  const pcm = voice.engine === 'supertonic' ? await e.synth(text, voice.lang, voice.style, voice.speed) : await e.synth(text, voice);
  const ms = performance.now() - t0;
  // Supertonic now and then overshoots; scale down instead of clipping.
  let peak = 0;
  for (const x of pcm) peak = Math.max(peak, Math.abs(x));
  if (peak > 1) for (let i = 0; i < pcm.length; i++) pcm[i] /= peak;
  return { pcm, sampleRate: e.sampleRate, ms };
}

let chain = Promise.resolve();
let epoch = 0;

self.onmessage = ({ data }) => {
  if (data.type === 'download') ensure(data.pack);
  else if (data.type === 'load') chain = chain.then(() => engine(data.pack)).catch(() => {});
  else if (data.type === 'cancel') epoch++;
  else if (data.type === 'synth') {
    const e = epoch;
    chain = chain.then(async () => {
      if (e !== epoch) return;
      try {
        const audio = await synth(data.text, data.voice);
        postMessage({ type: 'audio', id: data.id, ...audio }, [audio.pcm.buffer]);
      } catch (err) {
        postMessage({ type: 'synth-error', id: data.id, message: String(err?.message ?? err) });
      }
    });
  } else if (data.type === 'delete') {
    // Queued behind synthesis, so no job is using the sessions it releases.
    chain = chain.then(() =>
      navigator.locks.request(`babil-tts:${data.pack}`, async () => {
        await engines.get(data.pack)?.then((x) => x.release()).catch(() => {});
        engines.delete(data.pack);
        const root = await navigator.storage.getDirectory();
        await root.getDirectoryHandle('tts').then((d) => d.removeEntry(data.pack, { recursive: true })).catch(() => {});
        announce({ type: 'deleted', pack: data.pack });
      }),
    );
  }
};
