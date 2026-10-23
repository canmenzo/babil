// Chinese text to phoneme ids for Piper's pinyin voices, following piper1-gpl's
// phonemize_chinese.py (Apache-2.0), with pinyin-pro in place of g2pW.
import { pinyin } from 'pinyin-pro';

// Longest first.
const INITIALS = ['zh', 'ch', 'sh', ...'bpmfdtnlgkhjqxrzcsyw'];
// Phonemes followed by a pad: tones, pauses and the space.
const GROUP_END = new Set([...'12345。？！.?!—…、，：；,:; ']);
const SENTENCE = /(?:[。！？]|…+)+[”’」』）》】〕〉]*|[.!?…]+['")\]}’”»]*(?=\s+[\p{Lu}\p{Lt}\p{Lo}])/gu;

const DIGITS = '零一二三四五六七八九';

function group(n, lead) {
  let s = '';
  let gap = false;
  for (const [v, unit] of [[1000, '千'], [100, '百'], [10, '十'], [1, '']]) {
    const d = Math.floor(n / v) % 10;
    if (!d) {
      gap ||= !!s;
      continue;
    }
    if (gap) s += '零';
    gap = false;
    s += (d === 1 && v === 10 && lead && !s ? '' : DIGITS[d]) + unit;
  }
  return s;
}

// Spelled like unicode-rbnf's zh spellout, which piper uses: 2026 -> 二千零二十六, 12.5 -> 十二点五.
function number(str) {
  const [int, frac = ''] = str.replace(/^-/, '').split('.');
  let n = Number(int);
  let s = n ? '' : '零';
  let gap = false;
  for (const [v, unit] of [[1e12, '兆'], [1e8, '亿'], [1e4, '万'], [1, '']]) {
    const g = Math.floor(n / v) % 10000;
    if (!g) {
      gap ||= !!s;
      continue;
    }
    if (gap || (s && g < 1000)) s += '零';
    gap = false;
    s += group(g, !s) + unit;
  }
  const f = frac.replace(/0+$/, '');
  if (f) s += '点' + [...f].map((d) => DIGITS[d]).join('');
  return (str.startsWith('-') ? '负' : '') + s;
}

function numbersToWords(text) {
  return text
    .replace(/([-−])?(\d+)\s*(?:°\s*C|℃)/g, (_, sign, n) => `${sign ? '零下' : ''}${number(n)}度`)
    .replace(/(-?\d+(?:\.\d+)?|[零〇一二三四五六七八九十百千万亿两点]+)\s*[%％]/g, (_, n) => `百分之${/\d/.test(n) ? number(n) : n}`)
    .replace(/-?\d+(?:\.\d+)?/g, number);
}

function phonemes(sentence, idMap) {
  const out = [];
  for (const { origin, pinyin: syl, isZh } of pinyin(numbersToWords(sentence), { type: 'all', toneType: 'num', v: true })) {
    // Like piper, a character without pinyin is kept only if it is a known symbol.
    if (!isZh || !syl) {
      if (origin in idMap) out.push(origin);
      continue;
    }
    const base = syl.slice(0, -1);
    const tone = syl.at(-1) === '0' ? '5' : syl.at(-1);
    const ini = INITIALS.find((i) => base.startsWith(i)) ?? '';
    if (ini === base) continue; // m2, ng4: not in the id map, piper drops them too
    out.push(ini || 'Ø', base.slice(ini.length), tone);
  }
  return out;
}

// One id list per sentence, each synthesized on its own like piper does.
export function phonemeIds(text, idMap) {
  text = text.replace(/[“”"*]/g, '');
  const sentences = [];
  let at = 0;
  for (const m of text.matchAll(SENTENCE)) {
    sentences.push(text.slice(at, m.index + m[0].length));
    at = m.index + m[0].length;
  }
  sentences.push(text.slice(at));
  return sentences
    .map((s) => phonemes(s.trim(), idMap))
    .filter((p) => p.length)
    .map((p) => {
      const ids = [...idMap['^']];
      for (const ph of p) {
        if (!idMap[ph]) continue;
        ids.push(...idMap[ph]);
        if (GROUP_END.has(ph)) ids.push(...idMap._);
      }
      return [...ids, ...idMap.$];
    });
}
