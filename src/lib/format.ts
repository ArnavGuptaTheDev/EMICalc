const inr2 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inr0 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const num0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const num2 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
const fixed2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 1,23,456.70 — table cells (currency noted once in the header). */
export const amount = (v: number) => fixed2.format(fixNegZero(v));

/** ₹1,23,456.78 */
export const money = (v: number) => inr2.format(fixNegZero(v));
/** ₹1,23,457 */
export const money0 = (v: number) => inr0.format(fixNegZero(v));
/** 1,23,457 */
export const plain0 = (v: number) => num0.format(fixNegZero(v));
export const plain2 = (v: number) => num2.format(fixNegZero(v));

const fixNegZero = (v: number) => (Object.is(Math.round(v * 100) / 100, -0) || Math.abs(v) < 0.005 ? 0 : v);

/** Compact Indian units: ₹4.5 L, ₹1.2 Cr, ₹85K. */
export function moneyShort(v: number): string {
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  const trim = (x: number) => x.toFixed(x >= 100 ? 0 : x >= 10 ? 1 : 2).replace(/\.?0+$/, '');
  if (a >= 1e7) return `${sign}₹${trim(a / 1e7)} Cr`;
  if (a >= 1e5) return `${sign}₹${trim(a / 1e5)} L`;
  if (a >= 1e3) return `${sign}₹${trim(a / 1e3)}K`;
  return `${sign}₹${Math.round(a)}`;
}

/** "5 lakh", "1.25 crore" — spoken form shown under the amount field. */
export function amountInWords(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return '';
  const trim = (x: number) => x.toFixed(2).replace(/\.?0+$/, '');
  if (v >= 1e7) return `${trim(v / 1e7)} crore`;
  if (v >= 1e5) return `${trim(v / 1e5)} lakh`;
  if (v >= 1e3) return `${trim(v / 1e3)} thousand`;
  return `${Math.round(v)}`;
}

export function tenureLabel(months: number): string {
  const y = Math.floor(months / 12);
  const m = months % 12;
  const parts = [];
  if (y) parts.push(`${y} yr${y > 1 ? 's' : ''}`);
  if (m || !y) parts.push(`${m} mo`);
  return parts.join(' ');
}

const monthFmt = new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const dayFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export const monthYear = (iso: string) => monthFmt.format(new Date(iso + 'T00:00:00Z'));
export const fullDate = (iso: string) => dayFmt.format(new Date(iso + 'T00:00:00Z'));
export const percent = (v: number) => `${num2.format(v)}%`;

/** Parse user-typed numbers: strips ₹, commas and spaces. Returns NaN when blank. */
export function parseNumber(raw: string): number {
  const cleaned = raw.replace(/[₹,\s]/g, '');
  return cleaned === '' ? NaN : Number(cleaned);
}
