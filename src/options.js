import { DEFAULTS, FONTS, EDGES, loadSettings, captionCss, langName, i18n, localize } from './settings.js';
import { listVoices, resolveVoice, sampleText, voiceStatus, PERSONAS } from './speech.js';
import { PACKS, packSize, resolveNeural, watchPacks } from './tts/catalog.js';
import { createTtsPlayer } from './tts-player.js';

localize();
let s = await loadSettings();

// Preview lines in the target language when there is a sample for it, else English.
const SAMPLES = {
  en: ["You didn't really think I'd do that, did you?", "Alright, we're moving on to the next round."],
  tr: ['Bunu gerçekten yapacağımı düşünmedin, değil mi?', 'Tamam, bir sonraki tura geçiyoruz.'],
  es: ['No pensaste de verdad que lo haría, ¿o sí?', 'Muy bien, pasamos a la siguiente ronda.'],
  hi: ['तुम्हें सच में नहीं लगा था कि मैं ऐसा करूँगा, है ना?', 'ठीक है, अब अगले राउंड पर चलते हैं।'],
  zh: ['你不会真以为我会那么做吧？', '好了，我们进入下一轮。'],
};

function sample() {
  const lang = s.target.split('-')[0];
  const orig = lang === 'en' ? SAMPLES.es : SAMPLES.en;
  return (SAMPLES[lang] ?? SAMPLES.en).map((trans, i) => ({ trans, orig: orig[i] }));
}

function options(select, map, prefix) {
  select.replaceChildren(
    ...Object.keys(map).map((value) => Object.assign(document.createElement('option'), { value, textContent: i18n(prefix + value) })),
  );
}

function trackControls(track) {
  const card = document.querySelector(`[data-track="${track}"]`);
  card.insertAdjacentHTML(
    'beforeend',
    `<label class="field">${i18n('font')} <select data-key="${track}.font"></select></label>
     <label class="field">${i18n('text_size')} <span class="range"><input type="range" min="12" max="64" step="1" data-key="${track}.size"><output></output></span></label>
     <label class="check"><input type="checkbox" data-key="${track}.bold"> ${i18n('bold')}</label>
     <div class="colors">
       <label class="field">${i18n('text_color')} <input type="color" data-key="${track}.color"></label>
       <label class="field">${i18n('bg_color')} <input type="color" data-key="${track}.bg"></label>
     </div>
     <label class="field">${i18n('bg_opacity')} <span class="range"><input type="range" min="0" max="1" step="0.05" data-key="${track}.bgOpacity"><output></output></span></label>`,
  );
  options(card.querySelector('select'), FONTS, 'font_');
}

trackControls('trans');
trackControls('orig');
options(document.querySelector('[data-key="edge"]'), EDGES, 'edge_');

let voices = await listVoices();
function voiceOptions() {
  const base = s.target.split('-')[0];
  document.querySelector('[data-key="ttsVoice"]').replaceChildren(
    new Option(i18n('voice_auto', langName(s.target)), ''),
    ...voices.filter((v) => v.lang?.split(/[-_]/)[0].toLowerCase() === base).map((v) => new Option(v.name, v.name)),
  );
}
voiceOptions();
// Firefox loads its voices after the page opens.
if (FIREFOX_BUILD) speechSynthesis.onvoiceschanged = async () => {
  voices = await listVoices();
  voiceOptions();
  fill();
};

// A new preview replaces the one playing (chrome.tts.speak interrupts by default).
function systemListen(ttsPersona) {
  const { voice, rate, pitch } = resolveVoice(voices, s.target, { ...s, ttsPersona });
  const text = sampleText(s.target);
  if (!FIREFOX_BUILD) return chrome.tts.speak(text, { lang: s.target, voiceName: voice?.name, rate, pitch });
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  Object.assign(u, { lang: s.target, voice: voice?.voice ?? null, rate, pitch });
  speechSynthesis.speak(u);
}

const tts = createTtsPlayer({ threads: Math.min(4, navigator.hardwareConcurrency || 2) });
let listenAfterDownload = null;
// The popup opens this page with ?download=1 to download the chosen persona's voice.
let autoDownload = new URLSearchParams(location.search).has('download');
const packs = watchPacks((msg) => {
  const chosen = resolveNeural(s.ttsPersona, s.target);
  if (autoDownload && !msg.type && chosen && !packs[chosen.pack].ready) download(chosen.pack);
  autoDownload = false;
  if (msg.type === 'ready' && listenAfterDownload && resolveNeural(listenAfterDownload, s.target)?.pack === msg.pack) listen(listenAfterDownload);
  fill();
});

function download(pack) {
  Object.assign(packs[pack], { progress: 0, error: null });
  tts.download(pack);
  fill();
}

// A persona whose voice is not downloaded yet downloads it first, then plays the sample.
function listen(ttsPersona) {
  const voice = resolveNeural(ttsPersona, s.target);
  listenAfterDownload = null;
  tts.stop();
  if (FIREFOX_BUILD) speechSynthesis.cancel();
  else chrome.tts.stop();
  if (!voice) return systemListen(ttsPersona);
  if (!packs[voice.pack].ready) {
    listenAfterDownload = ttsPersona;
    if (packs[voice.pack].progress == null) download(voice.pack);
    return;
  }
  tts.speak(sampleText(s.target), voice).catch(() => systemListen(ttsPersona));
}

// One row per voice pack the target language uses, with its download state.
function packRows() {
  const used = [...new Set(Object.keys(PERSONAS).map((p) => resolveNeural(p, s.target)?.pack).filter(Boolean))];
  document.getElementById('packs').replaceChildren(
    ...used.map((pack) => {
      const p = packs[pack];
      const row = document.createElement('div');
      row.className = 'pack';
      row.innerHTML = '<div class="pack-head"><strong></strong><span class="small muted"></span><button type="button"></button></div><div class="bar"><div></div></div><span class="small muted"></span>';
      const [name, state] = row.querySelectorAll('.pack-head > *');
      const button = row.querySelector('button');
      name.textContent = PACKS[pack].name;
      if (p.ready) state.textContent = i18n('tts_downloaded');
      else state.textContent = p.error ? i18n('tts_failed', p.error) : packSize(pack);
      const busy = p.progress != null;
      button.textContent = busy ? i18n('downloading_pct', p.progress) : i18n(p.ready ? 'tts_delete' : 'tts_download');
      button.disabled = busy;
      button.onclick = () => (p.ready ? tts.remove(pack) : download(pack));
      row.querySelector('.bar').hidden = !busy;
      row.querySelector('.bar > div').style.width = `${p.progress ?? 0}%`;
      const note = row.lastElementChild;
      note.textContent = `${i18n(busy ? 'tts_keep_open' : 'tts_pack_note')} `;
      note.append(Object.assign(document.createElement('a'), { href: PACKS[pack].license, target: '_blank', textContent: i18n('tts_license') }));
      return row;
    }),
  );
}

const personaCards = Object.keys(PERSONAS).map((id) => {
  const card = document.createElement('label');
  card.className = 'persona';
  card.innerHTML =
    '<input type="radio" name="ttsPersona"><strong></strong><span class="small"></span><span class="small muted voice"></span><span class="small state"></span><div class="bar"><div></div></div><button type="button"></button>';
  card.querySelector('strong').textContent = i18n(`persona_${id}_name`);
  card.querySelector('.small').textContent = i18n(`persona_${id}_desc`);
  card.querySelector('button').textContent = i18n('listen');
  const choose = () => {
    s.ttsPersona = id;
    fill();
    chrome.storage.local.set({ ttsPersona: id });
  };
  card.querySelector('input').onchange = choose;
  // A button inside a label does not check its radio, so Listen chooses the persona itself.
  card.querySelector('button').onclick = () => {
    choose();
    listen(id);
  };
  return Object.assign(card, { personaId: id });
});
document.getElementById('personas').append(...personaCards);
const customOnly = ['ttsVoice', 'ttsRate'].map((k) => document.querySelector(`[data-key="${k}"]`).closest('.field'));

// Firefox plays the video itself, so there is no audio path to duck.
if (FIREFOX_BUILD) document.getElementById('ttsDuck').remove();

const inputs = [...document.querySelectorAll('[data-key]')];

function get(key) {
  return key.split('.').reduce((o, k) => o[k], s);
}

function fill() {
  for (const el of inputs) {
    const v = get(el.dataset.key);
    if (el.type === 'checkbox') el.checked = v;
    else el.value = v;
    const out = el.parentElement.querySelector('output');
    if (out) out.textContent = el.dataset.key.endsWith('bgOpacity') ? i18n('percent', Math.round(v * 100)) : v;
  }
  for (const card of personaCards) {
    const on = card.personaId === s.ttsPersona;
    card.classList.toggle('selected', on);
    card.querySelector('input').checked = on;
    const system = resolveVoice(voices, s.target, { ...s, ttsPersona: card.personaId }).voice;
    const st = voiceStatus(card.personaId, s.target, packs, system);
    Object.assign(card.querySelector('.voice'), { textContent: st.label, title: st.label });
    const state = card.querySelector('.state');
    state.textContent = st.state;
    state.classList.toggle('ok', st.ready);
    card.querySelector('.bar').hidden = st.progress == null;
    card.querySelector('.bar > div').style.width = `${st.progress ?? 0}%`;
  }
  for (const el of customOnly) el.hidden = s.ttsPersona !== 'custom';
  packRows();
}

function preview() {
  const box = document.getElementById('previewBox');
  const height = document.getElementById('preview').clientHeight;
  const scale = s.scaleWithVideo ? Math.min(2, Math.max(0.5, height / 640)) : 1;
  box.style.setProperty('--scale', scale);
  box.style.bottom = `${(height * s.position) / 100}px`;
  let style = document.getElementById('captionStyle');
  if (!style) {
    style = document.createElement('style');
    style.id = 'captionStyle';
    document.head.append(style);
  }
  style.textContent = captionCss(s);
  box.replaceChildren(
    ...sample().slice(-s.cues).map(({ trans, orig }) => {
      const cue = document.createElement('div');
      cue.className = 'cue';
      for (const [cls, text] of [['trans', trans], ['orig', orig]]) {
        const line = document.createElement('div');
        line.className = cls;
        line.append(Object.assign(document.createElement('span'), { textContent: text }));
        cue.append(line);
      }
      return cue;
    }),
  );
}

for (const el of inputs) {
  el.addEventListener('input', () => {
    const path = el.dataset.key.split('.');
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (el.type === 'range') v = Number(v);
    if (path.length === 2) s[path[0]] = { ...s[path[0]], [path[1]]: v };
    else s[path[0]] = v;
    fill();
    preview();
    chrome.storage.local.set({ [path[0]]: s[path[0]] });
  });
}

document.getElementById('reset').onclick = async () => {
  const { model, source, target, tts, ttsPersona, ttsVoice, ttsRate, ttsDuck, ...look } = DEFAULTS;
  await chrome.storage.local.set(look);
  s = await loadSettings();
  fill();
  preview();
};

// Dragging the captions on a video changes the position from another context, the popup the persona
// and the target language.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === 'local' && (changes.position || changes.ttsPersona || changes.target)) {
    s = await loadSettings();
    voiceOptions();
    fill();
    preview();
  }
});

addEventListener('resize', preview);
fill();
preview();
