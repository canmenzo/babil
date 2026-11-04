# <img src="docs/icon-128.png" alt="" width="32" height="32"> Babil

**Watch videos in your language. Live captions, translated on your computer.**

![Babil caption preview](docs/screenshot.png)

- Translate videos into 26 languages on YouTube, Twitch, Kick, and more
- See original and translated captions together, including in fullscreen
- Hear translations read aloud in a natural voice, with the video turned down while each sentence plays (Chrome)
- Move captions by dragging; customize font, size, and colors
- Audio stays on your computer. Free, with no account or API key

## Install

Needs **Chrome 138+ or Firefox 142+ on a desktop computer**. A graphics card helps it run faster.

Download the ZIP for your browser from the [latest release](https://github.com/canmenzo/babil/releases/latest) and unzip it.

**Chrome:** go to `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose the folder containing `manifest.json`.

**Firefox:** go to `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on...**, and choose `manifest.json`. It stays loaded until Firefox restarts.

To update, replace the files and reload the extension. Your settings and downloaded models stay unless you remove it.

## Use

1. Play a video and click the **Babil icon** in the toolbar
2. Choose the language to translate into
3. Click the **large button at the top**, or press `Alt+Shift+T`

The first start downloads a speech model (up to about 600 MB) and later starts reuse it. On Firefox, the first translation also downloads a translation model (up to about 1.1 GB). Firefox captures audio from the page's video element, so it can't translate protected media.

To hear the translation, tick **Read translation aloud** and pick a persona under **Voice**. Voices are a one-time download (about 210 MB for 22 languages, 63 MB each for Chinese) that you can manage on the settings page. Until one is downloaded, and for Bengali and Thai, a system voice reads instead.

For better accuracy, select the video's spoken language.

## Develop

```sh
npm install
npm run build           # dist/
npm run build:store     # dist/, for the Chrome Web Store
npm run build:firefox   # dist-firefox/
```

Uses Whisper and Moonshine via transformers.js, and Chrome's on-device Translator API. Firefox translates with a local Transformers.js model.

To publish, bump the version in `package.json`, `package-lock.json`, and both manifests, then upload a ZIP of each build's contents to its store listing. Use `build:store` for Chrome and keep the Firefox add-on ID (`babil@canmenzo`). Store assets are in `docs/store/`.

## License

MIT. The downloadable voices have their own licenses:

- [Supertonic 3](https://huggingface.co/supertone-oss-archive/supertonic-3) by Supertone (22 languages): OpenRAIL-M. Babil downloads a [copy with an 8-bit vector estimator](https://huggingface.co/payam1394/traxlate-supertonic-3-q8ve), or the original if that copy is gone. Babil's Supertonic code is ported from Supertone's MIT sample code.
- [Xiao Ya](https://huggingface.co/rhasspy/piper-voices/tree/main/zh/zh_CN/xiao_ya/medium) (Piper, Chinese): trained on the Biaobei dataset, non-commercial use only.
- [Chaowen](https://huggingface.co/rhasspy/piper-voices/tree/main/zh/zh_CN/chaowen/medium) (Piper, Chinese): CC0 dataset, fine-tuned from Xiao Ya.
