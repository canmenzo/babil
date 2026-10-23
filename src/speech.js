import { i18n, langName } from './settings.js';
import { PACKS, packSize, resolveNeural } from './tts/catalog.js';

// Reads final captions aloud, each once, in the target language. Only MAX_QUEUE sentences wait
// behind the one being spoken; older ones are dropped so speech stays close to the video.
const MAX_QUEUE = 2;

export function createSpeaker({ speak, cancel, prepare = () => {}, onSpeaking = () => {} }) {
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
      else prepare(text);
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

// Speaks with a downloaded voice through the engine page's tts-player.js. done(false) means the
// sentence still needs a system voice. Replies with an unknown id are from before a restart.
export function neuralSpeaker(send) {
  const pending = new Map();
  let seq = 0;
  const ended = ({ id, ok }) => {
    const p = pending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    pending.delete(id);
    p.done(ok);
  };
  return {
    speak(text, voice, done) {
      const id = ++seq;
      const timer = setTimeout(() => ended({ id, ok: false }), Math.max(10000, 150 * text.length));
      pending.set(id, { done, timer });
      send({ type: 'tts-speak', id, text, voice });
    },
    ended,
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

// Shared with the Hammurabi desktop app; keep ids and values in sync. Rate and pitch: 1 is normal.
// Names and descriptions are the messages persona_<id>_name and persona_<id>_desc.
export const PERSONAS = {
  lale: { gender: 'female', rate: 1, pitch: 1 },
  ayla: { gender: 'female', rate: 1.05, pitch: 1.15 },
  deniz: { gender: 'male', rate: 0.95, pitch: 0.95 },
  ates: { gender: 'male', rate: 1, pitch: 0.8 },
  bilge: { gender: 'female', rate: 0.8, pitch: 1 },
  ruzgar: { gender: 'any', rate: 1.35, pitch: 1.05 },
  custom: {},
};

// Neither chrome.tts nor speechSynthesis reports gender, so guess it from well-known Windows,
// Edge and macOS voice names. Google voices are female unless their name says Male.
const FEMALE = new Set('emel zira hazel susan katja hedda helena hortense elsa irina hoda aria jenny yelda samantha karen moira tessa victoria amélie anna monica milena'.split(' '));
const MALE = new Set('tolga ahmet david mark george stefan pablo paul cosimo pavel naayf guy cem alex daniel fred thomas markus jorge yuri maged'.split(' '));

export function voiceGender(name) {
  const words = name.toLowerCase().split(/[^\p{L}]+/u);
  if (words.includes('google')) return words.includes('male') ? 'male' : 'female';
  if (words.some((w) => FEMALE.has(w))) return 'female';
  if (words.some((w) => MALE.has(w))) return 'male';
}

// A voice of the persona's gender if the language has one, else the usual pick. Local voices come
// first, even of the other gender: an online voice would send the captions off the computer. Custom
// keeps the user's own voice and rate.
export function resolveVoice(voices, lang, s) {
  const p = PERSONAS[s.ttsPersona] ?? PERSONAS.lale;
  if (p === PERSONAS.custom) return { voice: pickVoice(voices, lang, s.ttsVoice), rate: s.ttsRate, pitch: 1 };
  const local = voices.filter((v) => !v.remote);
  const gendered = (list) => list.filter((v) => voiceGender(v.name) === p.gender);
  const voice = pickVoice(gendered(local), lang, '') ?? pickVoice(local, lang, '') ?? pickVoice(gendered(voices), lang, '') ?? pickVoice(voices, lang, '');
  return { voice, rate: p.rate, pitch: p.pitch };
}

// What a persona card or the popup says about its voice: which one it is and whether it is
// downloaded. packs is from watchPacks; system is the system voice resolveVoice picked.
export function voiceStatus(persona, lang, packs, system) {
  const v = resolveNeural(persona, lang);
  if (!v) {
    const label = system?.name ?? i18n('system_voice');
    return { label, state: persona === 'custom' ? i18n('system_voice') : i18n('tts_no_neural', langName(lang)) };
  }
  const name = v.style ? i18n('tts_voice_supertonic', v.style) : PACKS[v.pack].name;
  const label = v.like ? i18n('tts_shared', name, i18n(`persona_${v.like}_name`), i18n(`tts_tweak_${v.tweak}`)) : name;
  const p = packs[v.pack];
  let state;
  if (p.ready) state = i18n('tts_downloaded');
  else if (p.progress != null) state = i18n('downloading_pct', p.progress);
  else if (p.error) state = i18n('tts_failed', p.error);
  else state = i18n('tts_needs_download', packSize(v.pack));
  return { label, state, voice: v, ready: !!p.ready, progress: p.ready ? null : p.progress };
}

const SAMPLES = {
  tr: 'Merhaba, çevirileri bu sesle okuyacağım.',
  en: 'Hi, I will read the translations in this voice.',
  de: 'Hallo, ich lese die Übersetzungen mit dieser Stimme vor.',
  es: 'Hola, leeré las traducciones con esta voz.',
  fr: 'Bonjour, je lirai les traductions avec cette voix.',
  ar: 'مرحبًا، سأقرأ الترجمات بهذا الصوت.',
  ru: 'Привет, я буду читать переводы этим голосом.',
  it: 'Ciao, leggerò le traduzioni con questa voce.',
  pt: 'Olá, vou ler as traduções com esta voz.',
  ja: 'こんにちは、この声で翻訳を読み上げます。',
  zh: '你好，我会用这个声音朗读翻译。',
  ko: '안녕하세요, 이 목소리로 번역을 읽어 드릴게요.',
  hi: 'नमस्ते, अनुवाद इसी आवाज़ में पढ़े जाएँगे।',
};

export function sampleText(lang) {
  return SAMPLES[lang.split('-')[0]] ?? SAMPLES.en;
}
