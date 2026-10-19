import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, rmSync, copyFileSync, unlinkSync } from 'node:fs';

const watch = process.argv.includes('--watch');
const firefox = process.argv.includes('--firefox');
const outdir = firefox ? 'dist-firefox' : 'dist';
const ort = 'node_modules/onnxruntime-web/dist';

rmSync(outdir, { recursive: true, force: true });
mkdirSync(`${outdir}/ort`, { recursive: true });
cpSync('static', outdir, { recursive: true });
cpSync('src/worklet.js', `${outdir}/worklet.js`);
for (const f of ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']) {
  cpSync(`${ort}/${f}`, `${outdir}/ort/${f}`);
}
if (firefox) {
  copyFileSync('static/manifest.firefox.json', `${outdir}/manifest.json`);
  cpSync('static/background.firefox.html', `${outdir}/background.html`);
}
unlinkSync(`${outdir}/manifest.firefox.json`);
unlinkSync(`${outdir}/background.firefox.html`);

const common = {
  bundle: true,
  outdir,
  target: firefox ? 'firefox128' : 'chrome138',
  logLevel: 'info',
  legalComments: 'none',
  minifySyntax: firefox,
  define: { FIREFOX_BUILD: firefox ? 'true' : 'false', ...(firefox ? { chrome: 'browser' } : {}) },
};
const contexts = [
  // Extension pages and workers are ES modules.
  await esbuild.context({
    ...common,
    entryPoints: firefox
      ? ['src/background-firefox.js', 'src/offscreen.js', 'src/popup.js', 'src/options.js', 'src/asr-worker.js']
      : ['src/background.js', 'src/offscreen.js', 'src/popup.js', 'src/options.js', 'src/asr-worker.js'],
    format: 'esm',
    // Use the ORT build that loads its wasm factory from wasmPaths instead of inlining it.
    conditions: ['onnxruntime-web-use-extern-wasm'],
  }),
  // Injected with scripting.executeScript, which only takes classic scripts.
  await esbuild.context({
    ...common,
    entryPoints: firefox ? ['src/content.js', 'src/capture-firefox.js'] : ['src/content.js'],
    format: 'iife',
  }),
];

if (watch) {
  await Promise.all(contexts.map((c) => c.watch()));
} else {
  await Promise.all(contexts.map((c) => c.rebuild()));
  await Promise.all(contexts.map((c) => c.dispose()));
}
