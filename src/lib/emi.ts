/**
 * EMI engine — pure functions, no DOM. Covered by tests in emi.test.ts.
 *
 * Standard reducing-balance EMI:
 *   r   = annualRate / 12 / 100
 *   EMI = P · r · (1 + r)^n / ((1 + r)^n − 1)      (EMI = P / n when r = 0)
 *
 * Each month: interest = balance · r, principal = EMI − interest,
 * GST (if on) = interest · gstRate. The first instalment can additionally carry
 * broken-period interest (start date → first statement date, at annualRate/365
 * per day), a processing fee, and GST on both.
 */

export interface LoanInputs {
  principal: number;
  /** Annual interest rate in percent, e.g. 14 for 14% p.a. */
  annualRate: number;
  tenureMonths: number;
  /** ISO date (YYYY-MM-DD) the loan is disbursed / purchase is made. */
  startDate: string;
  /** Align the first EMI to the next statement date (charges broken-period interest). */
  shiftToStatement: boolean;
  /** Day of month the statement is generated, 1–31. */
  statementDay: number;
  applyGst: boolean;
  /** GST rate in percent, e.g. 18. */
  gstRate: number;
  /** One-time processing fee, charged with the first instalment. */
  processingFee: number;
  /** Extra principal paid every month on top of the EMI. */
  extraMonthly: number;
  /** One-time part-payment. */
  lumpSum: number;
  /** Instalment number at which the lump sum is paid. */
  lumpSumMonth: number;
}

export interface Installment {
  n: number;
  /** ISO date of the instalment. */
  date: string;
  opening: number;
  interest: number;
  gst: number;
  /** Principal repaid through the regular EMI. */
  principal: number;
  /** Extra principal prepaid this month. */
  prepayment: number;
  /** Broken-period interest + fee + their GST (first instalment only). */
  oneTime: number;
  /** Total cash out this month. */
  payment: number;
  closing: number;
}

export interface LoanResult {
  emi: number;
  /** EMI + GST on the first month's interest — what a card statement typically shows. */
  firstMonthPayment: number;
  brokenPeriodDays: number;
  brokenPeriodInterest: number;
  totalInterest: number;
  totalGst: number;
  processingFee: number;
  totalPrepaid: number;
  totalPayable: number;
  months: number;
  /** Annualised effective cost of the loan (IRR × 12), incl. GST & fees, in percent. */
  effectiveRate: number;
  schedule: Installment[];
}

export const LIMITS = {
  principal: { min: 1, max: 50_000_000_000 },
  annualRate: { min: 0, max: 99.99 },
  tenureMonths: { min: 1, max: 600 },
  statementDay: { min: 1, max: 31 },
  gstRate: { min: 0, max: 50 },
} as const;

const EPS = 0.005;

export function monthlyRate(annualRate: number): number {
  return annualRate / 12 / 100;
}

export function calculateEmi(principal: number, annualRate: number, months: number): number {
  if (principal <= 0 || months <= 0) return 0;
  const r = monthlyRate(annualRate);
  if (r === 0) return principal / months;
  const f = Math.pow(1 + r, months);
  return (principal * r * f) / (f - 1);
}

/* ---------- dates (all UTC to avoid DST/timezone drift) ---------- */

export function parseISODate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return Number.isNaN(d.getTime()) || d.getUTCDate() !== +m[3] ? null : d;
}

export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** Same day-of-month `offset` months later, clamped to the month's last day (31 Jan + 1 → 28/29 Feb). */
export function addMonths(d: Date, offset: number, day = d.getUTCDate()): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + offset;
  const target = new Date(Date.UTC(y, m, 1));
  const dim = daysInMonth(target.getUTCFullYear(), target.getUTCMonth());
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(day, dim)));
}

/** The first statement date strictly after `start`. */
export function nextStatementDate(start: Date, statementDay: number): Date {
  const thisMonth = addMonths(start, 0, statementDay);
  return thisMonth.getTime() > start.getTime() ? thisMonth : addMonths(start, 1, statementDay);
}

const DAY_MS = 86_400_000;

/* ---------- validation ---------- */

export type FieldErrors = Partial<Record<keyof LoanInputs, string>>;

export function validate(i: LoanInputs): FieldErrors {
  const e: FieldErrors = {};
  const num = (v: number) => typeof v === 'number' && Number.isFinite(v);

  if (!num(i.principal) || i.principal < LIMITS.principal.min) e.principal = 'Enter a loan amount';
  else if (i.principal > LIMITS.principal.max) e.principal = 'Amount can be at most ₹5,000 crore';

  if (!num(i.annualRate) || i.annualRate < 0) e.annualRate = 'Enter an interest rate (0 or more)';
  else if (i.annualRate > LIMITS.annualRate.max) e.annualRate = 'Rate must be below 100%';

  if (!num(i.tenureMonths) || i.tenureMonths < 1 || !Number.isInteger(i.tenureMonths))
    e.tenureMonths = 'Enter a tenure of at least 1 month';
  else if (i.tenureMonths > LIMITS.tenureMonths.max) e.tenureMonths = 'Tenure can be at most 50 years';

  if (!parseISODate(i.startDate)) e.startDate = 'Pick a valid date';

  if (i.shiftToStatement && (!Number.isInteger(i.statementDay) || i.statementDay < 1 || i.statementDay > 31))
    e.statementDay = 'Statement day must be 1–31';

  if (i.applyGst && (!num(i.gstRate) || i.gstRate < 0 || i.gstRate > LIMITS.gstRate.max))
    e.gstRate = 'GST must be between 0 and 50%';

  if (!num(i.processingFee) || i.processingFee < 0) e.processingFee = 'Fee cannot be negative';
  if (!num(i.extraMonthly) || i.extraMonthly < 0) e.extraMonthly = 'Cannot be negative';
  if (!num(i.lumpSum) || i.lumpSum < 0) e.lumpSum = 'Cannot be negative';
  if (i.lumpSum > 0 && (!Number.isInteger(i.lumpSumMonth) || i.lumpSumMonth < 1 || i.lumpSumMonth > i.tenureMonths))
    e.lumpSumMonth = `Pick a month between 1 and ${i.tenureMonths || 1}`;

  return e;
}

/* ---------- schedule ---------- */

export function generateSchedule(i: LoanInputs): LoanResult {
  const r = monthlyRate(i.annualRate);
  const g = i.applyGst ? i.gstRate / 100 : 0;
  const emi = calculateEmi(i.principal, i.annualRate, i.tenureMonths);
  const start = parseISODate(i.startDate) ?? new Date(Date.UTC(2000, 0, 1));

  // Broken-period interest: start date → first statement date, simple daily interest.
  let firstDate = addMonths(start, 1);
  let brokenDays = 0;
  let brokenInterest = 0;
  if (i.shiftToStatement) {
    firstDate = nextStatementDate(start, i.statementDay);
    brokenDays = Math.min(60, Math.max(0, Math.round((firstDate.getTime() - start.getTime()) / DAY_MS)));
    brokenInterest = (i.principal * (i.annualRate / 100) * brokenDays) / 365;
  }
  const fee = Math.max(0, i.processingFee || 0);
  const oneTime = brokenInterest + fee + (brokenInterest + fee) * g;
  const anchorDay = firstDate.getUTCDate();

  const schedule: Installment[] = [];
  let balance = i.principal;
  let totalInterest = brokenInterest;
  let totalGst = (brokenInterest + fee) * g;
  let totalPrepaid = 0;

  for (let n = 1; n <= i.tenureMonths && balance > EPS; n++) {
    const opening = balance;
    const interest = opening * r;
    const principal = Math.min(Math.max(emi - interest, 0), opening);
    const wantedExtra = (i.extraMonthly || 0) + (i.lumpSum > 0 && n === i.lumpSumMonth ? i.lumpSum : 0);
    const prepayment = Math.min(wantedExtra, opening - principal);
    const gst = interest * g;
    let closing = opening - principal - prepayment;
    if (closing < EPS) closing = 0;
    const extra = n === 1 ? oneTime : 0;

    schedule.push({
      n,
      date: toISODate(addMonths(firstDate, n - 1, anchorDay)),
      opening,
      interest,
      gst,
      principal,
      prepayment,
      oneTime: extra,
      payment: principal + interest + gst + prepayment + extra,
      closing,
    });

    totalInterest += interest;
    totalGst += gst;
    totalPrepaid += prepayment;
    balance = closing;
  }

  const totalPayable = i.principal + totalInterest + totalGst + fee;

  return {
    emi,
    firstMonthPayment: schedule[0]?.payment ?? 0,
    brokenPeriodDays: brokenDays,
    brokenPeriodInterest: brokenInterest,
    totalInterest,
    totalGst,
    processingFee: fee,
    totalPrepaid,
    totalPayable,
    months: schedule.length,
    effectiveRate: effectiveAnnualRate(i.principal, schedule.map((s) => s.payment)),
    schedule,
  };
}

/** Same loan with prepayments removed — the baseline used to show savings. */
export function withoutPrepayments(i: LoanInputs): LoanInputs {
  return { ...i, extraMonthly: 0, lumpSum: 0 };
}

export function hasPrepayments(i: LoanInputs): boolean {
  return (i.extraMonthly || 0) > 0 || (i.lumpSum || 0) > 0;
}

/**
 * Monthly IRR of (+principal at t0, −payment_k at month k), annualised ×12 so it
 * compares directly with the quoted rate. Bisection — monotonic and robust.
 */
export function effectiveAnnualRate(principal: number, payments: number[]): number {
  if (principal <= 0 || payments.length === 0) return 0;
  const pv = (x: number) => payments.reduce((s, p, k) => s + p / Math.pow(1 + x, k + 1), 0);
  if (pv(0) <= principal) return 0;
  let lo = 0;
  let hi = 1;
  while (pv(hi) > principal && hi < 64) hi *= 2;
  for (let k = 0; k < 100; k++) {
    const mid = (lo + hi) / 2;
    if (pv(mid) > principal) lo = mid;
    else hi = mid;
  }
  return ((lo + hi) / 2) * 12 * 100;
}

/* ---------- yearly roll-up ---------- */

export interface YearRow {
  label: string;
  interest: number;
  gst: number;
  principal: number;
  prepayment: number;
  oneTime: number;
  payment: number;
  closing: number;
  months: number;
}

/** Groups instalments by calendar year of their due date. */
export function groupByYear(schedule: Installment[]): YearRow[] {
  const map = new Map<string, YearRow>();
  for (const s of schedule) {
    const label = s.date.slice(0, 4);
    let row = map.get(label);
    if (!row) {
      row = { label, interest: 0, gst: 0, principal: 0, prepayment: 0, oneTime: 0, payment: 0, closing: 0, months: 0 };
      map.set(label, row);
    }
    row.interest += s.interest;
    row.gst += s.gst;
    row.principal += s.principal;
    row.prepayment += s.prepayment;
    row.oneTime += s.oneTime;
    row.payment += s.payment;
    row.closing = s.closing;
    row.months++;
  }
  return [...map.values()];
}
