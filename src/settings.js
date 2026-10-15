export const DEFAULTS = {
  model: 'auto',
  source: 'auto',
  target: 'tr',
  showOriginal: true,
  originalFirst: false,
  position: 8, // % of the video height, measured from its bottom
  edge: 'shadow',
  cues: 2, // how many caption blocks stay on screen
  hold: 4, // seconds a final caption stays
  scaleWithVideo: true,
  trans: { font: 'sans', size: 30, color: '#ffffff', bg: '#000000', bgOpacity: 0.75, bold: true },
  orig: { font: 'sans', size: 20, color: '#ffe066', bg: '#000000', bgOpacity: 0.6, bold: false },
};

// Whisper can transcribe all of these.
export const SOURCE_LANGS = [
  'en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'pl', 'ru', 'uk', 'tr', 'ar', 'fa', 'hi', 'bn', 'ur',
  'id', 'vi', 'th', 'ja', 'ko', 'zh', 'el', 'sv', 'ro', 'cs', 'hu', 'he',
];

// Subset of Chrome Translator API targets, most spoken first.
export const TARGET_LANGS = [
  'tr', 'en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ar', 'hi', 'bn', 'zh', 'zh-Hant', 'ja', 'ko',
  'id', 'vi', 'th', 'nl', 'pl', 'uk', 'el', 'sv', 'ro', 'cs', 'hu',
];

export function langName(code) {
  const name = new Intl.DisplayNames(['tr'], { type: 'language' }).of(code);
  return name.charAt(0).toLocaleUpperCase('tr') + name.slice(1);
}

export const FONTS = {
  sans: { label: 'Sans (Arial)', css: 'Roboto, Arial, Helvetica, sans-serif' },
  system: { label: 'Sistem', css: 'system-ui, "Segoe UI", sans-serif' },
  serif: { label: 'Serif', css: 'Georgia, "Times New Roman", serif' },
  mono: { label: 'Eş aralıklı', css: 'Consolas, "Courier New", monospace' },
  casual: { label: 'Gündelik', css: '"Comic Sans MS", "Comic Neue", cursive' },
  condensed: { label: 'Dar', css: '"Arial Narrow", "Roboto Condensed", sans-serif-condensed, sans-serif' },
  smallcaps: { label: 'Küçük büyük harf', css: 'Roboto, Arial, sans-serif', smallCaps: true },
};

export const EDGES = {
  none: { label: 'Yok', css: 'none' },
  shadow: { label: 'Gölge', css: '2px 2px 4px rgba(0,0,0,.95)' },
  outline: {
    label: 'Kontur',
    css: '-1.5px -1.5px 0 #000, 1.5px -1.5px 0 #000, -1.5px 1.5px 0 #000, 1.5px 1.5px 0 #000, 0 0 3px #000',
  },
  raised: { label: 'Kabartma', css: '1px 1px 0 #000, 2px 2px 0 #000' },
  depressed: { label: 'Gömme', css: '-1px -1px 0 #000, 1px 1px 0 rgba(255,255,255,.4)' },
};

export async function loadSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return {
    ...DEFAULTS,
    ...stored,
    trans: { ...DEFAULTS.trans, ...stored.trans },
    orig: { ...DEFAULTS.orig, ...stored.orig },
  };
}

function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// Shared by the overlay and the settings preview. Sizes scale with the --scale custom property.
export function captionCss(s) {
  const line = (cls, t) => `
    .${cls} {
      font-family: ${FONTS[t.font]?.css ?? FONTS.sans.css};
      font-variant: ${FONTS[t.font]?.smallCaps ? 'small-caps' : 'normal'};
      font-size: calc(${t.size}px * var(--scale, 1));
      font-weight: ${t.bold ? 700 : 400};
      color: ${t.color};
    }
    .${cls} span { background: ${rgba(t.bg, t.bgOpacity)}; }`;
  return `
    .cue { display: flex; flex-direction: ${s.originalFirst ? 'column-reverse' : 'column'}; align-items: center; gap: .15em; margin-top: .3em; }
    .trans, .orig { line-height: 1.35; text-align: center; text-shadow: ${EDGES[s.edge]?.css ?? 'none'}; }
    .trans span, .orig span { padding: .08em .35em; border-radius: .18em; box-decoration-break: clone; -webkit-box-decoration-break: clone; white-space: pre-wrap; }
    .orig { display: ${s.showOriginal ? 'block' : 'none'}; }
    ${line('trans', s.trans)}
    ${line('orig', s.orig)}`;
}
