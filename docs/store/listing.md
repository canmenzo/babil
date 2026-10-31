# Store listing: Babil

Copy/paste reference for the Chrome Web Store and Firefox Add-ons (AMO) dashboards. Not part of the extension package.

## Name

```
Babil: Live Captions and Translation
```

## Summary (Chrome: 132 chars max; AMO: 250)

```
Live captions for any browser video, transcribed and translated on your computer. Free, no account, no API key.
```

## Description

```
Babil puts live captions on any video playing in your browser and translates them into your language while you watch. Everything runs on your computer: speech recognition with Whisper, translation with the browser's local translation model, and an optional read-aloud voice. Nothing you watch is uploaded.

How it works
- Play a video on YouTube, Twitch, Kick or any site with a standard player.
- Click the Babil icon, pick the language you want captions in, and press Start (or Alt+Shift+T).
- Captions appear over the video: the translation, with the original on top if you want it.
- Tick "Read translation aloud" to hear the translation with a downloaded voice persona or a system voice.

The first start downloads a speech model once (about 600 MB on automatic; smaller and larger models are available). Later starts use the saved copy. A graphics card makes recognition faster.

Customize
- Font, size, colors, edge style and position of the captions, which you can also drag over the video.
- Number of sentences on screen, time on screen, instant or sentence-by-sentence translation.
- Six voice personas per language for read-aloud, plus your own system voice.

Privacy
- No servers, no account, no analytics. Audio, transcripts and translations never leave your browser.
- The only downloads are model files from Hugging Face and the browser's own translation packs.

Open source (MIT): https://github.com/canmenzo/babil
Website: https://babil.menzo.dev
```

## Category

Chrome: Accessibility (alternate: Productivity > Tools). AMO: Language Support (alternate: Other).

## Privacy policy URL

```
https://babil.menzo.dev/privacy.html
```

## Chrome Web Store: privacy practices tab

### Single purpose

```
Show live captions for the video playing in the current tab, transcribed and translated on the user's computer.
```

### Permission justifications

**tabCapture**

```
Captures the audio of the tab the user started captions on, only after the user clicks Start in the popup or presses the shortcut. The audio is transcribed locally in an offscreen document and never leaves the browser.
```

**offscreen**

```
Speech recognition and translation run in an offscreen document so the popup can close and the service worker can sleep while captions keep running. Reason: AUDIO_PLAYBACK / WORKERS (local speech model).
```

**scripting** and **activeTab**

```
Inject the caption overlay (content.js, bundled) into the tab the user started captions on, and only that tab. No page content is read; the script only draws captions over the video element.
```

**storage** and **unlimitedStorage**

```
Keep the user's caption settings (languages, model, voice, appearance) in chrome.storage.local, and cache the downloaded speech model (up to about 1.5 GB) and voices in the browser cache so they are downloaded once.
```

**tts**

```
Read the translated captions aloud with a system voice when the user ticks "Read translation aloud" and has not downloaded a voice.
```

### Remote code

Answer: **No, I am not using remote code.**

```
All JavaScript and the ONNX Runtime WebAssembly are bundled in the package. The 'wasm-unsafe-eval' CSP keyword exists only so the bundled ONNX Runtime can run. The speech and voice model files downloaded from Hugging Face are data (weights), not code; they are loaded by the bundled runtime. The CSP also allows api.github.com: copies loaded unpacked from the GitHub release zip check it for a newer version. Store installs never make that request.
```

### Data usage

Check **none** of the data categories. Audio is processed locally and discarded; no data is collected or transmitted to the developer or anyone else. Check all three certifications.

## Firefox Add-ons (AMO) notes

- Upload `babil-firefox-<version>.zip` and, when asked, the source zip (`babil-source-<version>.zip`), because the package is bundled with esbuild. Build instructions for reviewers: `npm install` then `npm run build:firefox` with Node 20+; output is `dist-firefox/`.
- `<all_urls>` is used only for `tabs.executeScript` on the tab the user starts captions on; Firefox has no tabCapture, so the content script captures the page's video element audio instead.
- Data collection: none (declared in the manifest).
- Reviewer note for the `new Function` warning: it is in the unmodified onnxruntime-web 1.31 loader (`ort/ort-wasm-simd-threaded.asyncify.mjs`), used by Emscripten for its wasm glue, not for remote code.

## Assets

- Chrome screenshot (1280 x 800): `docs/store/chrome/01-captions.png`
- Chrome small promo tile (440 x 280): `docs/store/chrome/small-promo.png`
- Firefox screenshot (1280 x 800): `docs/store/firefox/01-captions.png`
- Icon (128 x 128): `static/icons/128.png`
