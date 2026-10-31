# Privacy Policy

Effective October 30, 2026. This policy covers the Babil browser extension.

Babil has no servers of its own. It does not collect analytics, telemetry, or usage data, and it does not sell or share your data with anyone.

## Audio and captions stay on your computer

When you start captions, Babil captures the audio of the tab you are watching and transcribes it on your computer with a Whisper speech model. Translation also runs on your computer: Chrome's built-in Translator API in Chrome, a local Transformers.js model in Firefox. Read-aloud uses a voice downloaded to your computer or your system's own voices. No audio, transcript, or translation ever leaves your browser.

## What Babil downloads

Babil downloads model files once and keeps them in the browser's cache:

- a Whisper speech model (about 600 MB on automatic) from Hugging Face (`huggingface.co` and its download hosts);
- optional voices for read-aloud from Hugging Face;
- in Chrome, translation language packs through Chrome's own Translator API, served by Google;
- in Firefox, a translation model (up to about 1.1 GB) from Hugging Face.

These are plain file downloads. They carry no information about you, what you watch, or what was said.

## Update checks

Copies installed from the GitHub zip, not from a browser store, ask GitHub (`api.github.com`) for the latest release when you open the panel. That request carries no page data. Store installs update through the store and never make it.

## What Babil stores

Your caption settings (languages, model choice, voice, appearance) are kept in the browser's extension local storage on this device and are deleted when you remove Babil. Downloaded models and voices are kept in the browser cache; the settings page can delete voices, and removing Babil removes everything.

## Permissions

- `tabCapture` (Chrome) and `<all_urls>` (Firefox): capture the audio of the tab you start captions on, after you click Start.
- `activeTab` and `scripting`: draw the captions over the video on that tab only.
- `offscreen` (Chrome): run speech recognition in a background document so the popup can close.
- `storage` and `unlimitedStorage`: keep your settings and the downloaded models.
- `tts` (Chrome): read translations aloud with a system voice when no downloaded voice is available.

## Contact

Questions or concerns: open an issue at https://github.com/canmenzo/babil/issues.
