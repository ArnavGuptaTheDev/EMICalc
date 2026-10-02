/** Encode/decode calculator inputs in the URL so a calculation can be shared as a link. */
import type { LoanInputs } from './emi';

const MAP: [keyof LoanInputs, string][] = [
  ['principal', 'p'],
  ['annualRate', 'r'],
  ['tenureMonths', 'n'],
  ['startDate', 'd'],
  ['shiftToStatement', 'sh'],
  ['statementDay', 'sd'],
  ['applyGst', 'g'],
  ['gstRate', 'gr'],
  ['processingFee', 'f'],
  ['extraMonthly', 'x'],
  ['lumpSum', 'ls'],
  ['lumpSumMonth', 'lm'],
];

export function toQuery(i: LoanInputs): string {
  const q = new URLSearchParams();
  for (const [key, short] of MAP) {
    const v = i[key];
    if (typeof v === 'boolean') {
      if (v) q.set(short, '1');
    } else if (v !== 0 && v !== '') {
      q.set(short, String(v));
    }
  }
  return q.toString();
}

export function fromQuery(search: string): Partial<LoanInputs> | null {
  const q = new URLSearchParams(search);
  if (!q.has('p')) return null;
  const out: Record<string, unknown> = {};
  for (const [key, short] of MAP) {
    const raw = q.get(short);
    if (key === 'startDate') {
      if (raw) out[key] = raw;
    } else if (key === 'shiftToStatement' || key === 'applyGst') {
      out[key] = raw === '1';
    } else {
      const n = raw === null ? 0 : Number(raw);
      if (Number.isFinite(n)) out[key] = n;
    }
  }
  return out as Partial<LoanInputs>;
}
