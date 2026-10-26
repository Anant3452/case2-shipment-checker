// Parsers for messy seller input: "about 3 pallets", "1.2 t", "£5.4k", "next Thursday".
// Pure: anything time-relative takes `today` (ISO) as an argument.

export interface Parsed<T> {
  value: T;
  /** Seller hedged ("about", "~", "-ish"): confirm once. */
  approximate: boolean;
  /** Human note about a conversion, e.g. "1.2 t = 1,200 kg". */
  note?: string;
}

const SMALL: Record<string, number> = {
  zero: 0, a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90, dozen: 12,
};
const SCALE: Record<string, number> = { hundred: 100, thousand: 1_000, k: 1_000, million: 1_000_000, m: 1_000_000 };

/** "five thousand four hundred" → 5400. Returns null if any word is not a number word. */
export function wordsToNumber(text: string): number | null {
  const words = text.toLowerCase().replace(/-/g, ' ').split(/\s+/).filter((w) => w && w !== 'and');
  if (words.length === 0) return null;
  let total = 0;
  let current = 0;
  let seen = false;
  for (const w of words) {
    if (w in SMALL) { current += SMALL[w]; seen = true; }
    else if (w === 'hundred') { current = (current || 1) * 100; seen = true; }
    else if (w in SCALE) { total += (current || 1) * SCALE[w]; current = 0; seen = true; }
    else return null;
  }
  return seen ? total + current : null;
}

const APPROX = /\b(about|around|approx(?:imately)?|roughly|circa|ca\.?|nearly|almost|maybe|or so)\b|~|-?ish\b/i;

export function isApproximate(text: string): boolean {
  return APPROX.test(text);
}

/**
 * First number in the text. Handles "1,080", "5.4k", "3-ish", "about 3", "two", "five thousand".
 */
export function parseNumber(text: string): Parsed<number> | null {
  const approximate = isApproximate(text);
  const m = text.match(/(-?\d[\d,]*(?:\.\d+)?)\s*(k|m)?\b/i);
  if (m) {
    let n = Number(m[1].replace(/,/g, ''));
    if (m[2]) n *= m[2].toLowerCase() === 'k' ? 1_000 : 1_000_000;
    return Number.isFinite(n) ? { value: n, approximate } : null;
  }
  // Longest run of number words.
  const tokens = text.toLowerCase().replace(/[^a-z\s-]/g, ' ').split(/\s+/);
  let best: number | null = null;
  for (let i = 0; i < tokens.length; i++) {
    for (let j = tokens.length; j > i; j--) {
      const run = tokens.slice(i, j).join(' ');
      if (run === 'a' || run === 'an') continue;
      const n = wordsToNumber(run);
      if (n !== null) { best = n; i = tokens.length; break; }
    }
  }
  return best === null ? null : { value: best, approximate };
}

/** Count of a noun: "about 3 pallets" → 3. Requires the noun nearby. */
export function parseCount(text: string, noun: string): Parsed<number> | null {
  const nouns = `${noun}s?`;
  const numberish = String.raw`(?:about|around|approx(?:imately)?|roughly|~)?\s*(?:\d[\d,]*(?:\.\d+)?(?:\s*-?\s*ish)?|[a-z]+(?:[\s-][a-z]+){0,3})`;
  const re = new RegExp(`(${numberish})\\s+${nouns}\\b`, 'gi');
  for (const m of text.matchAll(re)) {
    // Trim leading words that aren't numbers ("send 3" → "3", "send three" → "three").
    const words = m[1].trim().split(/\s+/);
    for (let i = 0; i < words.length; i++) {
      const candidate = words.slice(i).join(' ');
      if (/^(a|an)$/i.test(candidate)) return { value: 1, approximate: isApproximate(m[0]) };
      const p = parseNumber(candidate);
      if (p && (/\d/.test(candidate) || wordsToNumber(candidate.replace(APPROX, '').trim()) !== null)) {
        return { value: p.value, approximate: isApproximate(m[0]) || p.approximate };
      }
    }
  }
  return null;
}

const NON_GBP = /(€|\$|¥|₹|\b(eur|euro|euros|usd|dollars?|inr|rupees?|rs\.?|yen|jpy|cny|yuan|rmb|chf|francs?|sek|krona|kronor)\b)/i;

export type MoneyResult =
  | ({ ok: true } & Parsed<number>)
  | { ok: false; reason: 'non-gbp'; currency: string }
  | { ok: false; reason: 'unparseable' };

/** "£5.4k", "5,400 GBP", "five thousand four hundred pounds" → 5400. Non-GBP is rejected. */
export function parseMoneyGBP(text: string): MoneyResult {
  const other = text.match(NON_GBP);
  if (other) return { ok: false, reason: 'non-gbp', currency: other[0] };
  const cleaned = text.replace(/£|\bgbp\b|\bpounds?\b|\bquid\b|\bsterling\b/gi, ' ');
  const p = parseNumber(cleaned);
  if (!p) return { ok: false, reason: 'unparseable' };
  return { ok: true, ...p };
}

/** "1.2 t" → 1200, "800 g" → 0.8, "620kg" → 620. Bare numbers are taken as kg. */
export function parseWeightKg(text: string): Parsed<number> | null {
  const approximate = isApproximate(text);
  const m = text.match(/(\d[\d,]*(?:\.\d+)?)\s*(kgs?|kilo(?:gram)?s?|t|tonnes?|tons?|g|grams?|lbs?|pounds?)?\b/i);
  if (!m) {
    const n = parseNumber(text);
    return n ? { value: n.value, approximate } : null;
  }
  const n = Number(m[1].replace(/,/g, ''));
  const unit = (m[2] ?? 'kg').toLowerCase();
  const fmt = (x: number) => x.toLocaleString('en-GB', { maximumFractionDigits: 3 });
  if (/^(t|tonnes?|tons?)$/.test(unit)) return { value: n * 1000, approximate, note: `${fmt(n)} t = ${fmt(n * 1000)} kg` };
  if (/^(g|grams?)$/.test(unit)) return { value: n / 1000, approximate, note: `${fmt(n)} g = ${fmt(n / 1000)} kg` };
  if (/^(lbs?|pounds?)$/.test(unit)) {
    const v = Math.round(n * 0.45359237 * 100) / 100;
    return { value: v, approximate, note: `${fmt(n)} lb = ${fmt(v)} kg` };
  }
  return { value: n, approximate };
}

/** Strip spaces, dots and dashes. Returns null when no digits are present ("mugs"). */
export function parseHsCode(text: string): string | null {
  const m = text.match(/\d[\d\s.\-]*\d|\d/);
  if (!m) return null;
  return m[0].replace(/[\s.\-]/g, '');
}

function isoFrom(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** "05-11-2026", "5/11/2026", "05.11.2026" → "2026-11-05". Day first. */
export function parseDMY(text: string): string | null {
  const m = text.trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (!m) return null;
  return isoFrom(Number(m[3]), Number(m[2]), Number(m[1]));
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function addDaysIso(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/**
 * Dates in conversation. "today", "tomorrow", "in 3 days", "Thursday", "next Thursday",
 * "5 Nov", "5th November 2026", "Nov 5", "05-11-2026".
 * A weekday name means the next one after today ("next Thursday" on a Monday = in 3 days);
 * the assistant always echoes the resolved date so the seller can correct it.
 * A day-month without a year means the next such date on or after today.
 */
export function parseNaturalDate(text: string, today: string): string | null {
  const t = text.toLowerCase();
  const dmy = t.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/);
  if (dmy) return isoFrom(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));
  const iso = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return isoFrom(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  if (/\btoday\b/.test(t)) return today;
  if (/\btomorrow\b/.test(t)) return addDaysIso(today, 1);
  const inDays = t.match(/\bin\s+(\d+|[a-z]+)\s+days?\b/);
  if (inDays) {
    const n = /\d/.test(inDays[1]) ? Number(inDays[1]) : wordsToNumber(inDays[1]);
    if (n != null) return addDaysIso(today, n);
  }
  const inWeeks = t.match(/\bin\s+(\d+|a|one|two|three)\s+weeks?\b/);
  if (inWeeks) {
    const n = /\d/.test(inWeeks[1]) ? Number(inWeeks[1]) : wordsToNumber(inWeeks[1]);
    if (n != null) return addDaysIso(today, 7 * n);
  }
  if (/\bnext week\b/.test(t)) return addDaysIso(today, 7);

  const mon = String.raw`(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
  const dm = t.match(new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?${mon}\b(?:\s+(\d{4}))?`));
  const md = t.match(new RegExp(String.raw`\b${mon}\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4}))?`));
  if (dm || md) {
    const day = Number(dm ? dm[1] : md![2]);
    const month = MONTHS.indexOf((dm ? dm[2] : md![1]).slice(0, 3)) + 1;
    const yearText = dm ? dm[3] : md![3];
    const ty = Number(today.slice(0, 4));
    if (yearText) return isoFrom(Number(yearText), month, day);
    const thisYear = isoFrom(ty, month, day);
    if (thisYear && thisYear >= today) return thisYear;
    return isoFrom(ty + 1, month, day);
  }

  const wd = t.match(/\b(next\s+|this\s+|on\s+)?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|rsday|urday|sday)?\b/);
  if (wd) {
    const target = DAYS.findIndex((d) => d.startsWith(wd[2].slice(0, 3)));
    const [y, m, d] = today.split('-').map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    let diff = (target - dow + 7) % 7;
    if (diff === 0) diff = 7;
    return addDaysIso(today, diff);
  }
  return null;
}
