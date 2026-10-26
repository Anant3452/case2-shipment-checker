// Display helpers for seller-facing text (style guide, section 10).

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** £5,400 or £5,400.50 — decimals only when needed. */
export function money(n: number): string {
  const pennies = Math.round(n * 100);
  const whole = pennies % 100 === 0;
  return '£' + (pennies / 100).toLocaleString('en-GB', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  });
}

/** Thousands separators, up to 2 decimals. */
export function num(n: number): string {
  return n.toLocaleString('en-GB', { maximumFractionDigits: 2 });
}

/** 620 kg, 1,250.5 kg */
export function kg(n: number): string {
  return `${num(n)} kg`;
}

/** 2.3% — one decimal, or two when one would round a near-1% value to exactly 1%. */
export function pct(n: number): string {
  let s = n.toFixed(1);
  if (Number(s) === 1 && n !== 1) s = n.toFixed(2);
  return `${Number(s)}%`;
}

/** ISO YYYY-MM-DD → "5 Nov 2026" */
export function displayDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** Adds calendar days to an ISO date. */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** Whole days from a to b (b − a). */
export function daysBetween(a: string, b: string): number {
  const toUtc = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${num(n)} ${n === 1 ? word : pluralWord}`;
}

/** "a, b and c" */
export function listJoin(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
