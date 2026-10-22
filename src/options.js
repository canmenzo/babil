import { DEFAULTS, FONTS, EDGES, loadSettings, captionCss, langName } from './settings.js';
import { listVoices, resolveVoice, sampleText, PERSONAS } from './speech.js';

let s = await loadSettings();

const SAMPLE = [
  { trans: 'Bunu gerçekten yapacağımı düşünmedin, değil mi?', orig: "You didn't really think I'd do that, did you?" },
  { trans: 'Tamam, bir sonraki tura geçiyoruz.', orig: "Alright, we're moving on to the next round." },
];

function options(select, map) {
  select.replaceChildren(
    ...Object.entries(map).map(([value, { label }]) => Object.assign(document.createElement('option'), { value, textContent: label })),
  );
}

function trackControls(track) {
  const card = document.querySelector(`[data-track="${track}"]`);
  card.insertAdjacentHTML(
    'beforeend',
    `<label class="field">Font <select data-key="${track}.font"></select></label>
     <label class="field">Yazı boyutu (px) <span class="range"><input type="range" min="12" max="64" step="1" data-key="${track}.size"><output></output></span></label>
     <label class="check"><input type="checkbox" data-key="${track}.bold"> Kalın</label>
     <div class="colors">
       <label class="field">Yazı rengi <input type="color" data-key="${track}.color"></label>
       <label class="field">Arka plan rengi <input type="color" data-key="${track}.bg"></label>
     </div>
     <label class="field">Arka plan opaklığı <span class="range"><input type="range" min="0" max="1" step="0.05" data-key="${track}.bgOpacity"><output></output></span></label>`,
  );
  options(card.querySelector('select'), FONTS);
}

trackControls('trans');
trackControls('orig');
options(document.querySelector('[data-key="edge"]'), EDGES);

let voices = await listVoices();
function voiceOptions() {
  const base = s.target.split('-')[0];
  document.querySelector('[data-key="ttsVoice"]').replaceChildren(
    new Option(`Otomatik (${langName(s.target)})`, ''),
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
function listen(ttsPersona) {
  const { voice, rate, pitch } = resolveVoice(voices, s.target, { ...s, ttsPersona });
  const text = sampleText(s.target);
  if (!FIREFOX_BUILD) return chrome.tts.speak(text, { lang: s.target, voiceName: voice?.name, rate, pitch });
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  Object.assign(u, { lang: s.target, voice: voice?.voice ?? null, rate, pitch });
  speechSynthesis.speak(u);
}

const personaCards = Object.entries(PERSONAS).map(([id, p]) => {
  const card = document.createElement('label');
  card.className = 'persona';
  card.innerHTML = '<input type="radio" name="ttsPersona"><strong></strong><span class="small"></span><span class="small muted voice"></span><button type="button">Dinle</button>';
  card.querySelector('strong').textContent = p.name;
  card.querySelector('.small').textContent = p.desc;
  card.querySelector('input').onchange = () => {
    s.ttsPersona = id;
    fill();
    chrome.storage.local.set({ ttsPersona: id });
  };
  card.querySelector('button').onclick = () => listen(id);
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
    if (out) out.textContent = el.dataset.key.endsWith('bgOpacity') ? `%${Math.round(v * 100)}` : v;
  }
  for (const card of personaCards) {
    const on = card.personaId === s.ttsPersona;
    card.classList.toggle('selected', on);
    card.querySelector('input').checked = on;
    const name = resolveVoice(voices, s.target, { ...s, ttsPersona: card.personaId }).voice?.name ?? 'Sistem sesi';
    Object.assign(card.querySelector('.voice'), { textContent: name, title: name });
  }
  for (const el of customOnly) el.hidden = s.ttsPersona !== 'custom';
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
    ...SAMPLE.slice(-s.cues).map(({ trans, orig }) => {
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

// Dragging the captions on a video changes the position from another context, the popup the persona.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === 'local' && (changes.position || changes.ttsPersona)) {
    s = await loadSettings();
    fill();
    preview();
  }
});

addEventListener('resize', preview);
fill();
preview();
