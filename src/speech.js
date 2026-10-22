// Reads final captions aloud, each once, in the target language. Only MAX_QUEUE sentences wait
// behind the one being spoken; older ones are dropped so speech stays close to the video.
const MAX_QUEUE = 2;

export function createSpeaker({ speak, cancel, onSpeaking = () => {} }) {
  const spoken = new Set();
  const queue = [];
  let turn = 0;
  let busy = false;

  function next() {
    const text = queue.shift();
    if (busy !== !!text) onSpeaking((busy = !!text));
    if (!text) return;
    const t = ++turn;
    speak(text, () => t === turn && next());
  }

  return {
    caption(msg, target) {
      if (!msg.final || spoken.has(msg.id)) return;
      const text = msg.translated ?? (msg.language === target ? msg.original : null);
      if (!text) return;
      spoken.add(msg.id);
      queue.push(text);
      if (queue.length > MAX_QUEUE) queue.shift();
      if (!busy) next();
    },
    stop() {
      queue.length = 0;
      spoken.clear();
      turn++;
      if (busy) onSpeaking((busy = false));
      cancel();
    },
  };
}

// The chosen voice if it speaks the language, else a local one, else any.
export function pickVoice(voices, lang, name) {
  const base = lang.split('-')[0].toLowerCase();
  const fits = voices.filter((v) => v.lang?.split(/[-_]/)[0].toLowerCase() === base);
  return fits.find((v) => v.name === name) ?? fits.find((v) => !v.remote) ?? fits[0];
}

export async function listVoices() {
  if (FIREFOX_BUILD) return speechSynthesis.getVoices().map((v) => ({ name: v.name, lang: v.lang, remote: !v.localService, voice: v }));
  return (await chrome.tts.getVoices()).map((v) => ({ name: v.voiceName, lang: v.lang, remote: v.remote }));
}
