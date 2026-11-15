# Store listing: Babil

Copy/paste reference for the Chrome Web Store and Firefox Add-ons (AMO) dashboards. Not part of the extension package.

Current version: **0.8.5**. Files (built on the Mac from the source zip, so the AMO reviewer's rebuild matches byte for byte):

- `babil-chrome-0.8.5.zip`: Chrome Web Store build (`npm run build:store`, no `key` in the manifest)
- `babil-firefox-0.8.5.zip`: AMO build (`npm run build:firefox`)
- `babil-source-0.8.5.zip`: source for AMO reviewers (`git -c core.autocrlf=false archive`, LF line endings; a CRLF archive does not rebuild identically)

## Name

Chrome (75 max):

```
Babil: Live Captions and Translation
```

AMO (30 max):

```
Babil: Live Video Translation
```

## Summary (Chrome: 132 chars max; AMO: 250)

```
Live captions for any browser video, transcribed and translated on your computer. Free, no account, no API key.
```

## Description

```
Babil puts live captions on any video playing in your browser and translates them into your language while you watch. Everything runs on your computer: speech recognition with Whisper or Moonshine, translation with a local translation model, and an optional read-aloud voice. Nothing you watch is uploaded.

How it works
- Play a video on YouTube, Twitch, Kick or any site with a standard player.
- Click the Babil icon, pick the language you want captions in, and press Start (or Alt+Shift+T).
- Captions appear over the video: the translation, with the original on top if you want it.
- Tick "Read translation aloud" to hear the translation with a downloaded voice persona or a system voice.

The first start downloads a speech model once (up to about 600 MB on automatic, less without a graphics card; the popup lets you pick, download or delete models). Later starts use the saved copy. A graphics card makes recognition faster.

Customize
- Font, size, colors, edge style and position of the captions, which you can also drag over the video.
- Number of sentences on screen, time on screen, instant or sentence-by-sentence translation.
- Six voice personas per language for read-aloud, plus your own system voice.

Privacy
- No servers, no account, no analytics. Audio, transcripts and translations never leave your browser.
- The only downloads are model files from Hugging Face and, in Chrome, the browser's own translation packs.

Open source (MIT): https://github.com/canmenzo/babil
Website: https://babil.menzo.dev
```

## Category

Chrome: Accessibility (alternate: Productivity > Tools). AMO: see the AMO section.

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
Keep the user's caption settings (languages, model, voice, appearance) in chrome.storage.local, and cache the downloaded speech model (up to about 1.6 GB) and voices in the browser cache so they are downloaded once.
```

**tts**

```
Read the translated captions aloud with a system voice when the user ticks "Read translation aloud" and has not downloaded a voice.
```

### Remote code

Answer: **No, I am not using remote code.**

```
All JavaScript and the ONNX Runtime WebAssembly are bundled in the package. The 'wasm-unsafe-eval' CSP keyword exists only so the bundled ONNX Runtime can run. The speech and voice model files downloaded from Hugging Face are data (weights), not code; they are loaded by the bundled runtime. Extension updates are handled by the browser through the Chrome Web Store or Firefox Add-ons; the extension does not check GitHub for updates.
```

### Data usage

Check **none** of the data categories. Audio is processed locally and discarded; no data is collected or transmitted to the developer or anyone else. Check all three certifications.

## Firefox Add-ons (AMO): every field, in submission order

Dashboard: https://addons.mozilla.org/developers/ > Submit a New Add-on > On this site.

### 1. Upload version

- File: `babil-firefox-0.8.5.zip`
- Compatible applications: **Firefox** only (untick Firefox for Android; the manifest requires desktop Firefox 142+)
- Data collection: filled from the manifest (`none`), nothing to tick

### 2. Source code

- "Do you need to submit source code?": **Yes** (bundled with esbuild)
- File: `babil-source-0.8.5.zip`

### 3. Describe add-on

**Name** (30 max)

```
Babil: Live Video Translation
```

**Add-on URL** (slug; if taken, use `babil-captions`)

```
babil
```

**Summary** (250 max)

```
Live captions for any browser video, transcribed and translated on your computer. Free, no account, no API key.
```

**Description**: the Description block above.

**This add-on is experimental**: unticked. **This add-on requires payment, non-free services or software**: unticked.

**Categories** (up to 3)

- Language Support
- Photos, Music & Videos

**Support email**

```
hi@menzo.dev
```

**Support website**

```
https://github.com/canmenzo/babil/issues
```

**License**: MIT License

**This add-on has a Privacy Policy**: ticked, then paste:

```
Privacy policy: Babil

Effective November 1, 2026. This policy covers the Babil browser extension.

Babil has no servers of its own. It does not collect analytics, telemetry or usage data, and it does not sell or share your data with anyone.

AUDIO AND CAPTIONS STAY ON YOUR COMPUTER

When you start captions, Babil captures the audio of the video you are watching and transcribes it on your computer with a speech model (Whisper, or Moonshine for English). Translation also runs on your computer, with a local Transformers.js model. Read-aloud uses a voice downloaded to your computer or your system's own voices. No audio, transcript or translation ever leaves your browser.

WHAT BABIL DOWNLOADS

Babil downloads model files once and keeps them in the browser's cache:

- a speech model (about 600 MB on automatic) from Hugging Face (huggingface.co and its download hosts);
- a translation model (up to about 1.1 GB) from Hugging Face;
- optional voices for read-aloud from Hugging Face.

These are plain file downloads. They carry no information about you, what you watch or what was said.

UPDATE CHECKS

Firefox Add-ons installations update through the browser automatically. Babil does not contact GitHub or run its own update checks.

WHAT BABIL STORES

Your caption settings (languages, model choice, voice, appearance) are kept in the browser's extension local storage on this device and are deleted when you remove Babil. Downloaded models and voices are kept in the browser cache; the settings page can delete voices, and removing Babil removes everything.

PERMISSIONS

- Access to all websites (<all_urls>) and activeTab: capture the audio of the video on the tab you start captions on, after you click Start, and draw the captions over that video.
- Access to huggingface.co and its download hosts: download the speech, translation and voice models.
- storage and unlimitedStorage: keep your settings and the downloaded models.

CONTACT

Questions or concerns: open an issue at https://github.com/canmenzo/babil/issues

Full policy online: https://babil.menzo.dev/privacy.html
```

**Notes to Reviewer**

```
Source code is required: the extension is bundled with esbuild. The attached source package (also public at https://github.com/canmenzo/babil, MIT) contains everything needed to rebuild it.

BUILD (produces an exact copy of the submitted files)

Verified on macOS with Node.js 26.8.1 and npm 11.19.0: a clean build from the attached source package is byte-identical to the submitted package.

1. Unzip the source package and open a terminal in its folder.
2. npm ci
   (npm may warn that protobufjs's postinstall script was not run; it is not needed for the build.)
3. npm run build:firefox
4. The built extension is in dist-firefox/. Its contents match the submitted package.

What build.mjs does: copies static/ to dist-firefox/, swaps in manifest.firefox.json and background.firefox.html, copies four onnxruntime-web WASM runtime files unchanged from node_modules/onnxruntime-web/dist into dist-firefox/ort/, and bundles src/*.js with esbuild (minifySyntax only, no identifier mangling).

THIRD-PARTY LIBRARIES (unmodified, from npm, exact versions pinned in package-lock.json)

- @huggingface/transformers: on-device speech recognition and translation
- onnxruntime-web (1.31.0-dev.20260914-8d85527a0): WASM inference runtime, bundled locally, never loaded remotely
- pinyin-pro: pinyin annotations for Chinese captions

NOTES

- No remote code. Only model weights (ONNX data files) and voices are downloaded from Hugging Face at runtime; all executable code and WASM ship inside the package.
- 'wasm-unsafe-eval' in the CSP is required to run the bundled ONNX Runtime WASM.
- The `new Function` use flagged by the validator is in the unmodified onnxruntime-web loader (ort/ort-wasm-simd-threaded.asyncify.mjs), part of Emscripten's wasm glue, not remote code.
- <all_urls> is used to inject the capture script into the user's current tab after they click Start, which reads that tab's playing <video> via captureStream/mozCaptureStream (Firefox has no tabCapture). Nothing is captured until the user starts captions.
- No data is sent anywhere. Audio, transcripts and translations stay in the browser.

HOW TO TEST

1. Open a YouTube video with speech and press play.
2. Click the Babil toolbar icon, choose a target language, click the large Start button (or Alt+Shift+T).
3. The first start downloads the speech model (about 600 MB) and the translation model, so allow a few minutes. Captions then appear over the video.
```

### 4. After submitting (Edit Product Page / Manage Status & Versions)

**Version notes** (0.8.5)

```
First release on Firefox Add-ons.
```

**Homepage**

```
https://babil.menzo.dev
```

**Screenshots**: `firefox-screenshot-1280x800.png` (repo: `docs/store/firefox/01-captions.png`)

**Icon**: `icon-128.png` (repo: `static/icons/128.png`)

**Contributions URL**: leave empty.

## Assets

- Chrome screenshot (1280 x 800): `docs/store/chrome/01-captions.png`
- Chrome small promo tile (440 x 280): `docs/store/chrome/small-promo.png`
- Firefox screenshot (1280 x 800): `docs/store/firefox/01-captions.png`
- Icon (128 x 128): `static/icons/128.png`
