# Babil

**Live translated captions for any video in Chrome. Runs entirely on your computer.**

![Babil caption preview](docs/screenshot.png)

## Features

- Captures video audio from any site, including YouTube, Twitch, and Kick
- Live translation into 26 languages, including Turkish, English, Spanish, German, and Japanese
- Original and translated captions displayed together, ideal for language learning
- Translations appear once each sentence is complete and stay unchanged while you read
- Filters out filler words such as "um" and "uh", game audio, music, and background noise
- Captions appear about 0.5 seconds after a sentence ends
- Audio stays on your computer. No account, API key, or fees
- Customizable font, size, color, and background
- Works in fullscreen

## Installation

1. Download `babil-v...zip` from the [**latest release**](https://github.com/canmenzo/babil/releases/latest) and extract it
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** in the top-right corner
4. Click **Load unpacked** and select the extracted folder containing `manifest.json`

> Pin Babil from Chrome's Extensions menu for quick access.

### Updating

The popup notifies you when a new version is available. You can also check manually using the update check button at the bottom of the popup. Download the ZIP, extract it over your existing Babil folder, and click the reload button in the popup. Your settings and downloaded models are preserved.

## Usage

While a video is playing, click the Babil icon and press the button to start captions. Keyboard shortcut: `Alt+Shift+T`.

On first use, the selected model downloads once (about 600 MB with automatic selection). After that, it loads from disk.

- Select the spoken language if you know it to improve accuracy
- Model selection controls accuracy; caption speed is the same across models. Choose the highest-accuracy model if you have a powerful GPU
- Language and model changes take effect immediately while captions are running
- Drag captions to reposition them over the video
- Choose how many sentences remain visible from the popup
- Open the caption appearance settings using the link in the popup

## Requirements

- Desktop Chrome 138 or later
- A GPU is recommended; the extension also works without one, but runs more slowly

## Development

```sh
npm install
npm run build   # Output: dist/
```

Whisper (transformers.js, WebGPU) transcribes audio, and Chrome's on-device Translator API translates it. Built with Manifest V3 and an offscreen document.

## License

MIT
