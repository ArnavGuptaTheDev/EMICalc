/**
 * ─────────────────────────────────────────────────────────────
 *  EDIT SITE CONTENT HERE
 *  Copy, default values, slider ranges and the FAQ all live in this
 *  file. Change anything, save, and the dev server hot-reloads.
 * ─────────────────────────────────────────────────────────────
 */
import type { LoanInputs } from '../lib/emi';

export const site = {
  name: 'EMICalc',
  title: 'EMICalc — EMI calculator with GST, fees & prepayments',
  description:
    'Work out your monthly EMI, total interest, GST on interest, broken-period interest and the true cost of a loan or credit-card EMI. Free, private, works offline in your browser.',
  url: 'https://emicalc.pages.dev',
  themeColor: { light: '#f5f1e8', dark: '#151513' },

  hero: {
    eyebrow: 'Loan & card EMI calculator',
    title: 'Know every rupee before you sign.',
    lede: 'EMI, interest, GST and fees, plus a month-by-month schedule. Everything runs in your browser and is saved only on this device.',
  },

  footer: {
    note: 'Figures are estimates for planning. Your lender’s statement is the final word — banks may round EMIs or compute interest on a daily basis.',
  },
} as const;

/** Values the calculator starts with on a first visit. */
export const defaults: Omit<LoanInputs, 'startDate'> = {
  principal: 500000,
  annualRate: 10.5,
  tenureMonths: 36,
  shiftToStatement: false,
  statementDay: 5,
  applyGst: false,
  gstRate: 18,
  processingFee: 0,
  extraMonthly: 0,
  lumpSum: 0,
  lumpSumMonth: 12,
};

/** Slider ranges. The number inputs beside them accept values outside these (up to the hard limits in lib/emi.ts). */
export const sliders = {
  principal: { min: 10000, max: 10000000, step: 5000 },
  annualRate: { min: 0, max: 36, step: 0.05 },
  tenureMonths: { min: 1, max: 360, step: 1 },
};

/** Quick-pick presets shown as chips above the form. */
export const presets: { label: string; values: Partial<LoanInputs> }[] = [
  { label: 'Phone on card', values: { principal: 80000, annualRate: 15, tenureMonths: 9, applyGst: true, shiftToStatement: true, processingFee: 199 } },
  { label: 'Personal loan', values: { principal: 500000, annualRate: 10.5, tenureMonths: 36, applyGst: false, shiftToStatement: false, processingFee: 0 } },
  { label: 'Car loan', values: { principal: 800000, annualRate: 8.75, tenureMonths: 60, applyGst: false, shiftToStatement: false, processingFee: 0 } },
  { label: 'Home loan', values: { principal: 5000000, annualRate: 8.4, tenureMonths: 240, applyGst: false, shiftToStatement: false, processingFee: 0 } },
];

export const formula = {
  title: 'How the numbers are worked out',
  items: [
    {
      term: 'Monthly EMI',
      math: 'EMI = P × r × (1 + r)ⁿ ÷ ((1 + r)ⁿ − 1)',
      body: 'P is the loan amount, r the monthly rate (annual rate ÷ 12 ÷ 100) and n the number of months. At a 0% rate the EMI is simply P ÷ n.',
    },
    {
      term: 'Interest & principal each month',
      math: 'interest = balance × r  ·  principal = EMI − interest',
      body: 'Early EMIs are mostly interest. As the balance falls, more of each EMI goes to principal.',
    },
    {
      term: 'GST on interest',
      math: 'GST = interest × GST rate',
      body: 'Credit-card EMIs in India attract GST (usually 18%) on the interest part, and on any processing fee. GST is paid on top of the EMI.',
    },
    {
      term: 'Broken-period interest',
      math: 'extra = P × annual rate × days ÷ 365',
      body: 'If the first EMI is moved to your next statement date, the days between purchase and statement are charged as simple interest on the first bill. The gap is capped at 60 days.',
    },
    {
      term: 'Effective rate',
      math: 'the IRR of the cash flows, × 12',
      body: 'This is the rate that equates everything you actually pay (EMIs, GST, fees, broken-period interest) to the amount you borrowed. Use it to compare offers, especially “no-cost” EMIs.',
    },
  ],
};

export const faq = [
  {
    q: 'Where are my saved calculations stored?',
    a: 'In your browser’s local storage on this device only. Nothing is sent to a server. Clearing site data removes them, so use “Export backup” if you want a copy.',
  },
  {
    q: 'What does a prepayment do here?',
    a: 'Prepayments reduce the principal directly. The EMI stays the same and the loan finishes earlier. The calculator shows the months and interest you save against the same loan with no prepayments.',
  },
  {
    q: 'Is a “no-cost EMI” really free?',
    a: 'Often not. Set the rate to 0%, switch on GST and add the processing fee. If the effective rate comes out above 0%, the deal costs you something.',
  },
  {
    q: 'Why is my bank’s EMI a few rupees different?',
    a: 'Lenders round EMIs, may use daily-reducing balances or 360-day years, and adjust the final instalment. The differences are usually small.',
  },
];
