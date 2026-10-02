import { describe, expect, it } from 'vitest';
import {
  addMonths,
  calculateEmi,
  effectiveAnnualRate,
  generateSchedule,
  groupByYear,
  nextStatementDate,
  parseISODate,
  validate,
  type LoanInputs,
} from './emi';
import { fromQuery, toQuery } from './share';

const base: LoanInputs = {
  principal: 100000,
  annualRate: 12,
  tenureMonths: 12,
  startDate: '2026-01-10',
  shiftToStatement: false,
  statementDay: 5,
  applyGst: false,
  gstRate: 18,
  processingFee: 0,
  extraMonthly: 0,
  lumpSum: 0,
  lumpSumMonth: 1,
};

describe('calculateEmi', () => {
  it('matches the textbook value', () => {
    // ₹1,00,000 @ 12% for 12 months → ₹8,884.88
    expect(calculateEmi(100000, 12, 12)).toBeCloseTo(8884.88, 2);
  });
  it('handles 0% rate', () => {
    expect(calculateEmi(12000, 0, 12)).toBe(1000);
  });
});

describe('generateSchedule', () => {
  it('amortises to zero and totals add up', () => {
    const r = generateSchedule(base);
    expect(r.schedule).toHaveLength(12);
    expect(r.schedule.at(-1)!.closing).toBe(0);
    const principal = r.schedule.reduce((s, x) => s + x.principal, 0);
    expect(principal).toBeCloseTo(100000, 4);
    expect(r.totalInterest).toBeCloseTo(8884.88 * 12 - 100000, 1);
    expect(r.effectiveRate).toBeCloseTo(12, 4);
  });

  it('adds GST on interest only', () => {
    const r = generateSchedule({ ...base, applyGst: true });
    expect(r.totalGst).toBeCloseTo(r.totalInterest * 0.18, 6);
    expect(r.schedule[0].payment).toBeCloseTo(r.emi + 1000 * 0.18, 6);
  });

  it('charges broken-period interest and counts it in totals', () => {
    const r = generateSchedule({ ...base, shiftToStatement: true, statementDay: 5, applyGst: true });
    // 10 Jan → 5 Feb = 26 days
    expect(r.brokenPeriodDays).toBe(26);
    const broken = (100000 * 0.12 * 26) / 365;
    expect(r.brokenPeriodInterest).toBeCloseTo(broken, 6);
    expect(r.schedule[0].date).toBe('2026-02-05');
    expect(r.schedule[0].oneTime).toBeCloseTo(broken * 1.18, 6);
    expect(r.totalPayable).toBeCloseTo(100000 + r.totalInterest + r.totalGst, 6);
    expect(r.effectiveRate).toBeGreaterThan(12);
  });

  it('prepayments shorten the loan and save interest', () => {
    const plain = generateSchedule({ ...base, tenureMonths: 60 });
    const pre = generateSchedule({ ...base, tenureMonths: 60, extraMonthly: 2000, lumpSum: 20000, lumpSumMonth: 6 });
    expect(pre.months).toBeLessThan(60);
    expect(pre.totalInterest).toBeLessThan(plain.totalInterest);
    expect(pre.totalPrepaid + pre.schedule.reduce((s, x) => s + x.principal, 0)).toBeCloseTo(100000, 4);
    expect(pre.schedule.at(-1)!.closing).toBe(0);
  });

  it('includes processing fee with GST in the first payment', () => {
    const r = generateSchedule({ ...base, processingFee: 199, applyGst: true });
    expect(r.schedule[0].oneTime).toBeCloseTo(199 * 1.18, 6);
    expect(r.totalPayable).toBeCloseTo(100000 + r.totalInterest + r.totalGst + 199, 6);
  });

  it('“no-cost” EMI with fee has a positive effective rate', () => {
    const r = generateSchedule({ ...base, annualRate: 0, processingFee: 499, applyGst: true });
    expect(r.totalInterest).toBe(0);
    expect(r.effectiveRate).toBeGreaterThan(0);
  });
});

describe('dates', () => {
  it('clamps month ends', () => {
    expect(addMonths(parseISODate('2026-01-31')!, 1).toISOString().slice(0, 10)).toBe('2026-02-28');
    expect(addMonths(parseISODate('2026-01-31')!, 2, 31).toISOString().slice(0, 10)).toBe('2026-03-31');
  });
  it('next statement date is strictly after start', () => {
    const s = parseISODate('2026-03-05')!;
    expect(nextStatementDate(s, 5).toISOString().slice(0, 10)).toBe('2026-04-05');
    expect(nextStatementDate(s, 20).toISOString().slice(0, 10)).toBe('2026-03-20');
    expect(nextStatementDate(parseISODate('2026-02-10')!, 31).toISOString().slice(0, 10)).toBe('2026-02-28');
  });
  it('rejects impossible dates', () => {
    expect(parseISODate('2026-02-30')).toBeNull();
  });
});

describe('misc', () => {
  it('validate flags bad input', () => {
    expect(validate({ ...base, principal: NaN, tenureMonths: 0 })).toMatchObject({
      principal: expect.any(String),
      tenureMonths: expect.any(String),
    });
    expect(validate(base)).toEqual({});
  });
  it('effective rate of a zero-cost loan is 0', () => {
    expect(effectiveAnnualRate(1200, Array(12).fill(100))).toBe(0);
  });
  it('groups by year', () => {
    const rows = groupByYear(generateSchedule({ ...base, tenureMonths: 24 }).schedule);
    expect(rows.map((r) => r.label)).toEqual(['2026', '2027', '2028']);
    expect(rows.reduce((s, r) => s + r.months, 0)).toBe(24);
  });
  it('share link round-trips', () => {
    const i = { ...base, applyGst: true, extraMonthly: 500 };
    expect({ ...base, ...fromQuery(toQuery(i)) }).toEqual(i);
  });
});
