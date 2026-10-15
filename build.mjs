import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

const watch = process.argv.includes('--watch');
const ort = 'node_modules/onnxruntime-web/dist';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist/ort', { recursive: true });
cpSync('static', 'dist', { recursive: true });
cpSync('src/worklet.js', 'dist/worklet.js');
for (const f of ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']) {
  cpSync(`${ort}/${f}`, `dist/ort/${f}`);
}

const common = { bundle: true, outdir: 'dist', target: 'chrome138', logLevel: 'info', legalComments: 'none' };
const contexts = [
  // Extension pages and workers are ES modules.
  await esbuild.context({
    ...common,
    entryPoints: ['src/background.js', 'src/offscreen.js', 'src/popup.js', 'src/options.js', 'src/asr-worker.js'],
    format: 'esm',
    // Use the ORT build that loads its wasm factory from wasmPaths instead of inlining it.
    conditions: ['onnxruntime-web-use-extern-wasm'],
  }),
  // Injected with scripting.executeScript, which only takes classic scripts.
  await esbuild.context({ ...common, entryPoints: ['src/content.js'], format: 'iife' }),
];

if (watch) {
  await Promise.all(contexts.map((c) => c.watch()));
} else {
  await Promise.all(contexts.map((c) => c.rebuild()));
  await Promise.all(contexts.map((c) => c.dispose()));
}
