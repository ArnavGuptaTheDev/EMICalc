/**
 * The calculator island: wires the static markup in Calculator.astro to the
 * pure engine in lib/emi.ts. No framework — just DOM + a single render().
 */
import { defaults, presets, sliders } from '../content/site';
import {
  generateSchedule,
  groupByYear,
  hasPrepayments,
  toISODate,
  validate,
  withoutPrepayments,
  type FieldErrors,
  type LoanInputs,
  type LoanResult,
} from '../lib/emi';
import { amount, amountInWords, fullDate, money, money0, moneyShort, monthYear, parseNumber, percent, plain2, tenureLabel } from '../lib/format';
import { fromQuery, toQuery } from '../lib/share';
import * as store from '../lib/storage';
import { renderBalanceChart } from './charts';
import { downloadCsv, downloadImage, saveBlob } from './exports';

/* ───────────── helpers ───────────── */

const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => [...root.querySelectorAll<T>(sel)];
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function todayISO(): string {
  const d = new Date();
  return toISODate(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())));
}

/** Coerce anything loaded from storage / URL into a complete, well-typed LoanInputs. */
function sanitize(p: Partial<LoanInputs> | null | undefined): LoanInputs {
  const out: LoanInputs = { ...defaults, startDate: todayISO() };
  if (!p || typeof p !== 'object') return out;
  for (const key of Object.keys(out) as (keyof LoanInputs)[]) {
    const v = p[key];
    if (typeof v === typeof out[key] && (typeof v !== 'number' || Number.isFinite(v))) (out as unknown as Record<string, unknown>)[key] = v;
  }
  return out;
}

const sameInputs = (a: LoanInputs, b: LoanInputs) => toQuery(a) === toQuery(b);

/* ───────────── state ───────────── */

let state: LoanInputs;
let tenureUnit: 'months' | 'years' = 'months';
let view: 'monthly' | 'yearly' = 'monthly';
let result: LoanResult | null = null;
let baseline: LoanResult | null = null;
let errors: FieldErrors = {};

/* ───────────── field wiring ───────────── */

type Kind = 'amount' | 'decimal' | 'int';
const FIELDS: { id: string; key: keyof LoanInputs; kind: Kind; optional?: boolean }[] = [
  { id: 'f-principal', key: 'principal', kind: 'amount' },
  { id: 'f-rate', key: 'annualRate', kind: 'decimal' },
  { id: 'f-gstrate', key: 'gstRate', kind: 'decimal' },
  { id: 'f-stmtday', key: 'statementDay', kind: 'int' },
  { id: 'f-fee', key: 'processingFee', kind: 'amount', optional: true },
  { id: 'f-extra', key: 'extraMonthly', kind: 'amount', optional: true },
  { id: 'f-lump', key: 'lumpSum', kind: 'amount', optional: true },
  { id: 'f-lumpmonth', key: 'lumpSumMonth', kind: 'int' },
];

const ERROR_TARGET: Partial<Record<keyof LoanInputs, string>> = {
  ...Object.fromEntries(FIELDS.map((f) => [f.key, f.id])),
  tenureMonths: 'f-tenure',
  startDate: 'f-start',
};

function formatField(kind: Kind, v: number, optional?: boolean): string {
  if (!Number.isFinite(v)) return '';
  if (optional && v === 0) return '';
  if (kind === 'amount') return plain2(v);
  return String(v);
}

/* principal slider is logarithmic so small and large loans both get resolution */
const P_MIN = sliders.principal.min;
const P_MAX = sliders.principal.max;
const toLog = (v: number) => Math.round((1000 * Math.log(Math.min(Math.max(v, P_MIN), P_MAX) / P_MIN)) / Math.log(P_MAX / P_MIN));
function fromLog(t: number): number {
  const v = P_MIN * Math.pow(P_MAX / P_MIN, t / 1000);
  const step = Math.max(500, 5 * Math.pow(10, Math.floor(Math.log10(v)) - 2));
  return Math.min(P_MAX, Math.round(v / step) * step);
}

function setFill(r: HTMLInputElement) {
  const min = +r.min;
  const max = +r.max;
  const pct = max > min ? ((+r.value - min) / (max - min)) * 100 : 0;
  r.style.setProperty('--fill', `${Math.min(100, Math.max(0, pct))}%`);
}

function tenureDisplayValue(): string {
  if (!Number.isFinite(state.tenureMonths)) return '';
  return tenureUnit === 'years' ? plain2(state.tenureMonths / 12).replace(/,/g, '') : String(state.tenureMonths);
}

/** Push state into every control, skipping the element the user is typing in. */
function syncFields(skip?: Element | null) {
  for (const f of FIELDS) {
    const el = $<HTMLInputElement>('#' + f.id);
    if (el !== skip) el.value = formatField(f.kind, state[f.key] as number, f.optional);
  }
  const tenure = $<HTMLInputElement>('#f-tenure');
  if (tenure !== skip) tenure.value = tenureDisplayValue();
  const start = $<HTMLInputElement>('#f-start');
  if (start !== skip) start.value = state.startDate;
  $<HTMLInputElement>('#f-gst').checked = state.applyGst;
  $<HTMLInputElement>('#f-shift').checked = state.shiftToStatement;
  $('#sub-gst').hidden = !state.applyGst;
  $('#sub-shift').hidden = !state.shiftToStatement;

  const rp = $<HTMLInputElement>('#r-principal');
  if (rp !== skip && Number.isFinite(state.principal)) rp.value = String(toLog(state.principal));
  const rr = $<HTMLInputElement>('#r-rate');
  if (rr !== skip && Number.isFinite(state.annualRate)) rr.value = String(state.annualRate);
  const rt = $<HTMLInputElement>('#r-tenure');
  if (tenureUnit === 'years') {
    rt.min = '1';
    rt.max = String(Math.round(sliders.tenureMonths.max / 12));
    rt.step = '1';
    if (rt !== skip && Number.isFinite(state.tenureMonths)) rt.value = String(Math.round(state.tenureMonths / 12));
  } else {
    rt.min = String(sliders.tenureMonths.min);
    rt.max = String(sliders.tenureMonths.max);
    rt.step = '1';
    if (rt !== skip && Number.isFinite(state.tenureMonths)) rt.value = String(state.tenureMonths);
  }
  $$<HTMLInputElement>('.range').forEach(setFill);

  $('#tenure-affix').textContent = tenureUnit === 'years' ? 'yrs' : 'mo';
  $('#tenure-min').textContent = tenureUnit === 'years' ? '1 yr' : '1 mo';
  $('#tenure-max').textContent = tenureUnit === 'years' ? `${rt.max} yrs` : `${rt.max} mo`;
  $$<HTMLButtonElement>('[data-unit]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.unit === tenureUnit)));
}

/* ───────────── render ───────────── */

let frame = 0;
function schedule() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(render);
}

let persistTimer = 0;

function render() {
  errors = validate(state);
  // Hide errors for switched-off sections.
  if (!state.applyGst) delete errors.gstRate;
  if (!state.shiftToStatement) delete errors.statementDay;
  showErrors();

  $('#w-principal').textContent = amountInWords(state.principal) ? `₹ ${amountInWords(state.principal)}` : '';
  $('#w-tenure').textContent = Number.isFinite(state.tenureMonths) && state.tenureMonths > 0 ? tenureLabel(state.tenureMonths) : '';
  updateGroupMeta();

  const invalid = Object.keys(errors).length > 0;
  $('#results').classList.toggle('invalid', invalid);
  $('#invalid-note').hidden = !invalid;
  if (invalid) return;

  result = generateSchedule(state);
  baseline = hasPrepayments(state) ? generateSchedule(withoutPrepayments(state)) : null;
  renderSummary(result, baseline);
  renderTable();
  renderChart();
  renderPrintHead();

  clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => store.saveLast(state), 300);
}

function showErrors() {
  for (const el of $$('[data-error-for]')) {
    const key = el.dataset.errorFor as keyof LoanInputs;
    el.textContent = errors[key] ?? '';
  }
  for (const [key, id] of Object.entries(ERROR_TARGET)) {
    const input = document.getElementById(id!);
    if (input) input.setAttribute('aria-invalid', String(Boolean(errors[key as keyof LoanInputs])));
  }
}

function updateGroupMeta() {
  const card: string[] = [];
  if (state.applyGst) card.push(`GST ${Number.isFinite(state.gstRate) ? state.gstRate : '–'}%`);
  if (state.shiftToStatement) card.push(`statement day ${Number.isFinite(state.statementDay) ? state.statementDay : '–'}`);
  if (state.processingFee > 0) card.push(`fee ${moneyShort(state.processingFee)}`);
  $('#m-card').textContent = card.length ? card.join(' · ') : 'None';

  const pre: string[] = [];
  if (state.extraMonthly > 0) pre.push(`${moneyShort(state.extraMonthly)}/mo`);
  if (state.lumpSum > 0) pre.push(`${moneyShort(state.lumpSum)} once`);
  $('#m-prepay').textContent = pre.length ? pre.join(' + ') : 'None';
}

function renderSummary(r: LoanResult, base: LoanResult | null) {
  const s = r.schedule;
  $('#emi-value').innerHTML = `${esc(money(r.emi))}<span class="per"> /month</span>`;
  $('#mb-value').textContent = money(r.emi);

  const first = s[0];
  const last = s[s.length - 1];
  $('#emi-sub').textContent = `${tenureLabel(r.months)} · first EMI ${fullDate(first.date)}`;

  // First-bill and GST note
  const notes: string[] = [];
  if (first.oneTime > 0.005) {
    const parts: string[] = [];
    if (r.brokenPeriodInterest > 0) parts.push(`${money0(r.brokenPeriodInterest)} interest for ${r.brokenPeriodDays} days before the first statement`);
    if (r.processingFee > 0) parts.push(`${money0(r.processingFee)} processing fee`);
    if (state.applyGst && first.oneTime - r.brokenPeriodInterest - r.processingFee > 0.005)
      parts.push(`${money0(first.oneTime - r.brokenPeriodInterest - r.processingFee)} GST on those`);
    notes.push(`<strong>First bill ${esc(money(first.payment))}</strong>. It includes ${esc(parts.join(', '))}.`);
  }
  if (state.applyGst && r.totalGst > 0) {
    const second = s[1] ?? first;
    notes.push(
      `With GST on interest, monthly bills run from <strong>${esc(money(second.payment))}</strong> down to <strong>${esc(money(last.payment))}</strong>.`,
    );
  }
  const fn = $('#first-note');
  fn.hidden = notes.length === 0;
  fn.innerHTML = notes.join(' ');

  const sv = $('#savings');
  if (base) {
    const saved = base.totalInterest + base.totalGst - (r.totalInterest + r.totalGst);
    const months = base.months - r.months;
    sv.hidden = false;
    sv.innerHTML = `Prepayments save <strong>${esc(money0(saved))}</strong> in interest${state.applyGst ? ' and GST' : ''} and finish <strong>${tenureLabel(months)}</strong> earlier.`;
  } else sv.hidden = true;

  const other = r.totalGst + r.processingFee;
  const stack = $('#stack');
  const seg = (k: string, v: number) => {
    const el = $<HTMLElement>(`[data-k="${k}"]`, stack);
    el.style.flexGrow = String(Math.max(v, 0));
    el.hidden = v <= 0;
  };
  seg('principal', state.principal);
  seg('interest', r.totalInterest);
  seg('gst', other);
  stack.setAttribute(
    'aria-label',
    `Total payable ${money0(r.totalPayable)}: principal ${money0(state.principal)}, interest ${money0(r.totalInterest)}${other > 0 ? `, GST and fees ${money0(other)}` : ''}`,
  );

  $('#v-principal').textContent = money(state.principal);
  $('#v-interest').textContent = money(r.totalInterest);
  const bn = $('#v-broken-note');
  bn.hidden = r.brokenPeriodInterest <= 0;
  bn.textContent = `incl. ${money0(r.brokenPeriodInterest)} broken-period`;
  $('#row-gst').hidden = other <= 0;
  $('#l-gst').textContent = r.totalGst > 0 && r.processingFee > 0 ? 'GST & fees' : r.processingFee > 0 ? 'Processing fee' : 'GST';
  $('#v-gst').textContent = money(other);
  $('#v-total').textContent = money(r.totalPayable);

  $('#fact-eff').textContent = percent(Math.round(r.effectiveRate * 100) / 100);
  $('#fact-end').textContent = monthYear(last.date);
  $('#fact-ratio').textContent = percent(Math.round(((r.totalInterest + other) / state.principal) * 1000) / 10);
  $('#fact-months').textContent = String(r.months);
}

function renderTable() {
  if (!result) return;
  const s = result.schedule;
  const gst = result.totalGst > 0;
  const pre = result.totalPrepaid > 0;
  const table = $('#schedule-table');
  let html = '';

  if (view === 'monthly') {
    html += `<thead><tr><th scope="col">Month</th><th scope="col">Payment</th><th scope="col">Principal</th><th scope="col">Interest</th>${gst ? '<th scope="col">GST</th>' : ''}${pre ? '<th scope="col">Prepaid</th>' : ''}<th scope="col">Balance</th></tr></thead><tbody>`;
    for (const r of s) {
      html += `<tr><td><span class="n">${r.n}</span>${monthYear(r.date)}</td><td class="pay">${amount(r.payment)}${r.oneTime > 0.005 ? `<small>incl. ${amount(r.oneTime)} one-time</small>` : ''}</td><td>${amount(r.principal)}</td><td>${amount(r.interest)}</td>${gst ? `<td>${amount(r.gst)}</td>` : ''}${pre ? `<td>${r.prepayment > 0 ? amount(r.prepayment) : '–'}</td>` : ''}<td>${amount(r.closing)}</td></tr>`;
    }
    html += '</tbody>';
  } else {
    html += `<thead><tr><th scope="col">Year</th><th scope="col">Paid</th><th scope="col">Principal</th><th scope="col">Interest</th>${gst ? '<th scope="col">GST</th>' : ''}${pre ? '<th scope="col">Prepaid</th>' : ''}<th scope="col">Balance</th></tr></thead><tbody>`;
    for (const y of groupByYear(s)) {
      html += `<tr><td>${y.label} <small>${y.months} EMI${y.months > 1 ? 's' : ''}</small></td><td class="pay">${amount(y.payment)}</td><td>${amount(y.principal)}</td><td>${amount(y.interest)}</td>${gst ? `<td>${amount(y.gst)}</td>` : ''}${pre ? `<td>${y.prepayment > 0 ? amount(y.prepayment) : '–'}</td>` : ''}<td>${amount(y.closing)}</td></tr>`;
    }
    html += '</tbody>';
  }
  const sum = (f: (x: (typeof s)[number]) => number) => s.reduce((a, x) => a + f(x), 0);
  html += `<tfoot><tr><td>Total</td><td>${amount(sum((x) => x.payment))}</td><td>${amount(sum((x) => x.principal))}</td><td>${amount(result.totalInterest)}</td>${gst ? `<td>${amount(result.totalGst)}</td>` : ''}${pre ? `<td>${amount(result.totalPrepaid)}</td>` : ''}<td></td></tr></tfoot>`;
  table.innerHTML = html;

  $('#schedule-sub').textContent = `${s.length} instalments · ${monthYear(s[0].date)} to ${monthYear(s[s.length - 1].date)}`;
  $('#table-meta').textContent = `Amounts in ₹.${result.brokenPeriodInterest > 0 ? ' Interest total includes broken-period interest charged with the first bill.' : ''}`;
  $$<HTMLButtonElement>('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
}

function renderChart() {
  if (!result) return;
  renderBalanceChart($('#balance-chart'), $('#chart-tip'), $('#chart-legend'), result, baseline, state.principal);
}

function renderPrintHead() {
  const i = state;
  const bits = [`${money0(i.principal)} at ${i.annualRate}% p.a. for ${tenureLabel(i.tenureMonths)}`, `starting ${fullDate(i.startDate)}`];
  if (i.applyGst) bits.push(`GST ${i.gstRate}% on interest`);
  if (i.shiftToStatement) bits.push(`first EMI on statement day ${i.statementDay}`);
  if (i.processingFee > 0) bits.push(`fee ${money0(i.processingFee)}`);
  if (i.extraMonthly > 0) bits.push(`extra ${money0(i.extraMonthly)}/month`);
  if (i.lumpSum > 0) bits.push(`${money0(i.lumpSum)} part-payment at month ${i.lumpSumMonth}`);
  $('#print-head').innerHTML = `<h1>EMI summary</h1><p>${esc(bits.join(' · '))}</p>`;
}

/* ───────────── toast ───────────── */

let toastTimer = 0;
/** Shows a toast. While a modal dialog is open the toast moves inside it, since everything outside a modal is inert. */
function toast(msg: string, action?: { label: string; run: () => void }) {
  const t = $('#toast');
  const hide = () => {
    t.classList.remove('show');
  };
  $('#toast-msg').textContent = msg;
  const btn = $<HTMLButtonElement>('#toast-action');
  btn.hidden = !action;
  btn.onclick = action
    ? () => {
        action.run();
        hide();
      }
    : null;
  if (action) btn.textContent = action.label;
  clearTimeout(toastTimer);
  const host = document.querySelector<HTMLDialogElement>('dialog[open]') ?? document.body;
  if (t.parentElement !== host) host.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  toastTimer = window.setTimeout(hide, action ? 6000 : 3000);
}

/* ───────────── saved calculations ───────────── */

function updateSavedCount() {
  $('#saved-count').textContent = String(store.listSaved().length);
}

function suggestName(): string {
  return `${moneyShort(state.principal)} · ${state.annualRate}% · ${tenureLabel(state.tenureMonths)}`;
}

function openSaveDialog() {
  if (!result || Object.keys(errors).length) {
    toast('Fix the highlighted fields first');
    return;
  }
  const dlg = $<HTMLDialogElement>('#save-dialog');
  const input = $<HTMLInputElement>('#save-name');
  input.value = suggestName();
  dlg.showModal();
  input.select();
}

function commitSave() {
  if (!result) return;
  const name = $<HTMLInputElement>('#save-name').value.trim() || suggestName();
  const saved = store.addSaved({ name, inputs: { ...state }, emi: result.emi, totalPayable: result.totalPayable });
  if (!saved) {
    toast('Couldn’t save. Browser storage is unavailable or full.');
    return;
  }
  updateSavedCount();
  toast(`Saved “${name}”`, { label: 'View', run: openSavedDialog });
}

function renderSavedList() {
  const body = $('#saved-body');
  const items = store.listSaved();
  $('#saved-clear').hidden = items.length === 0;
  $('#saved-export').hidden = items.length === 0;
  if (!items.length) {
    body.innerHTML = `<div class="empty"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4z"/></svg>No saved calculations yet.<br />Use <strong>Save</strong> to keep one here.</div>`;
    return;
  }
  const dateFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  body.innerHTML = `<ul class="saved-list">${items
    .map((it) => {
      const i = sanitize(it.inputs);
      const extras = [i.applyGst ? 'GST' : '', hasPrepayments(i) ? 'prepay' : ''].filter(Boolean).join(', ');
      return `<li class="saved-item${sameInputs(i, state) ? ' current' : ''}" data-id="${esc(it.id)}">
        <span class="name">${esc(it.name)}</span>
        <span class="emi">${esc(money0(it.emi))}<small>per month</small></span>
        <span class="meta">${esc(moneyShort(i.principal))} · ${i.annualRate}% · ${esc(tenureLabel(i.tenureMonths))}${extras ? ` · ${esc(extras)}` : ''} · ${esc(dateFmt.format(new Date(it.createdAt)))}</span>
        <div class="row-actions">
          <button type="button" class="btn btn-sm btn-primary" data-act="load">Load</button>
          <button type="button" class="btn btn-sm" data-act="rename">Rename</button>
          <button type="button" class="btn btn-sm btn-ghost btn-danger" data-act="delete" aria-label="Delete ${esc(it.name)}">Delete</button>
        </div>
      </li>`;
    })
    .join('')}</ul>`;
}

function openSavedDialog() {
  renderSavedList();
  $<HTMLDialogElement>('#saved-dialog').showModal();
}

function onSavedAction(e: Event) {
  const btn = (e.target as Element).closest<HTMLButtonElement>('[data-act]');
  if (!btn) return;
  const li = btn.closest<HTMLElement>('[data-id]')!;
  const id = li.dataset.id!;
  const item = store.listSaved().find((s) => s.id === id);
  if (!item) return;

  if (btn.dataset.act === 'load') {
    applyInputs(sanitize(item.inputs));
    $<HTMLDialogElement>('#saved-dialog').close();
    toast(`Loaded “${item.name}”`);
    $('#results').scrollIntoView({ block: 'start' });
  } else if (btn.dataset.act === 'delete') {
    const snapshot = store.listSaved();
    store.deleteSaved(id);
    renderSavedList();
    updateSavedCount();
    toast(`Deleted “${item.name}”`, {
      label: 'Undo',
      run: () => {
        store.restoreSaved(snapshot);
        updateSavedCount();
        if ($<HTMLDialogElement>('#saved-dialog').open) renderSavedList();
      },
    });
  } else if (btn.dataset.act === 'rename') {
    const nameEl = $('.name', li);
    const input = document.createElement('input');
    input.className = 'text-input';
    input.value = item.name;
    input.maxLength = 80;
    input.setAttribute('aria-label', 'New name');
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (commit: boolean) => {
      if (done) return;
      done = true;
      const name = input.value.trim();
      if (commit && name) store.renameSaved(id, name);
      renderSavedList();
    };
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        finish(true);
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
  }
}

/* ───────────── apply / init ───────────── */

function applyInputs(next: LoanInputs) {
  state = next;
  if (state.applyGst || state.shiftToStatement || state.processingFee > 0) ($('#g-card') as HTMLDetailsElement).open = true;
  if (hasPrepayments(state)) ($('#g-prepay') as HTMLDetailsElement).open = true;
  syncFields();
  render();
}

async function shareLink() {
  const url = `${location.origin}${location.pathname}?${toQuery(state)}`;
  const coarse = matchMedia('(pointer: coarse)').matches;
  if (coarse && navigator.share) {
    try {
      await navigator.share({ title: 'EMI calculation', text: `EMI ${money(result?.emi ?? 0)}/month: ${suggestName()}`, url });
      return;
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied. Anyone with it sees this calculation.');
  } catch {
    history.replaceState(null, '', url);
    toast('Copy the link from the address bar');
  }
}

function setupTheme() {
  const btn = $<HTMLButtonElement>('#btn-theme');
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const current = () => (document.documentElement.dataset.theme as 'light' | 'dark' | undefined) ?? (mq.matches ? 'dark' : 'light');
  const label = () => btn.setAttribute('aria-label', `Switch to ${current() === 'dark' ? 'light' : 'dark'} theme`);
  label();
  mq.addEventListener('change', () => {
    label();
    renderChart();
  });
  btn.addEventListener('click', () => {
    const next = current() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    store.savePrefs({ theme: next });
    label();
    renderChart();
  });
}

function setupExportMenu() {
  const btn = $<HTMLButtonElement>('#btn-export');
  const menu = $('#export-menu');
  const close = () => {
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  };
  btn.addEventListener('click', () => {
    const open = menu.hidden;
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    if (open) $<HTMLButtonElement>('button', menu).focus();
  });
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !(e.target as Element).closest('.menu-wrap')) close();
  });
  menu.addEventListener('keydown', (e) => {
    const items = $$<HTMLButtonElement>('button', menu);
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') items[(i + 1) % items.length].focus();
    else if (e.key === 'ArrowUp') items[(i - 1 + items.length) % items.length].focus();
    else if (e.key === 'Escape') {
      close();
      btn.focus();
    } else return;
    e.preventDefault();
  });
  menu.addEventListener('click', async (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('[data-export]');
    if (!b || !result) return;
    close();
    const kind = b.dataset.export;
    if (kind === 'csv') downloadCsv(result, state);
    else if (kind === 'image') {
      await downloadImage(result, state);
    } else if (kind === 'print') {
      const prev = view;
      // Print the full monthly schedule.
      if (view !== 'monthly') {
        view = 'monthly';
        renderTable();
      }
      window.print();
      if (prev !== view) {
        view = prev;
        renderTable();
      }
    }
  });
}

function setupDialogs() {
  for (const dlg of $$<HTMLDialogElement>('dialog')) {
    dlg.addEventListener('close', () => {
      const t = $('#toast');
      if (t.parentElement === dlg) document.body.appendChild(t);
    });
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) dlg.close();
      if ((e.target as Element).closest('[data-close]')) dlg.close();
    });
  }
  $('#save-form').addEventListener('submit', (e) => {
    e.preventDefault();
    $<HTMLDialogElement>('#save-dialog').close();
    commitSave();
  });
  $('#saved-body').addEventListener('click', onSavedAction);
  $('#btn-saved').addEventListener('click', openSavedDialog);
  $('#btn-save').addEventListener('click', openSaveDialog);

  $('#saved-clear').addEventListener('click', () => {
    const snapshot = store.listSaved();
    if (!snapshot.length) return;
    store.clearSaved();
    renderSavedList();
    updateSavedCount();
    toast(`Cleared ${snapshot.length} saved`, {
      label: 'Undo',
      run: () => {
        store.restoreSaved(snapshot);
        updateSavedCount();
        if ($<HTMLDialogElement>('#saved-dialog').open) renderSavedList();
      },
    });
  });
  $('#saved-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(store.listSaved(), null, 2)], { type: 'application/json' });
    saveBlob(blob, `emicalc-backup-${todayISO()}.json`);
  });
  $<HTMLInputElement>('#saved-import-file').addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const n = store.importSaved(JSON.parse(await file.text()));
      renderSavedList();
      updateSavedCount();
      toast(n ? `Imported ${n} calculation${n > 1 ? 's' : ''}` : 'Nothing new to import');
    } catch {
      toast('That file isn’t a valid EMICalc backup');
    }
  });
}

function setupMobileBar() {
  const bar = $('#mobile-bar');
  const target = $('#emi-value');
  const io = new IntersectionObserver(([entry]) => {
    const show = !entry.isIntersecting && !$('#results').classList.contains('invalid');
    bar.classList.toggle('show', show);
  });
  io.observe(target);
  const topbar = $('#topbar');
  const onScroll = () => topbar.classList.toggle('scrolled', window.scrollY > 4);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

function setupInputs() {
  for (const f of FIELDS) {
    const el = $<HTMLInputElement>('#' + f.id);
    el.addEventListener('input', () => {
      let v = parseNumber(el.value);
      if (Number.isNaN(v) && f.optional) v = 0;
      if (f.kind === 'int' && Number.isFinite(v)) v = Math.round(v);
      (state as unknown as Record<string, unknown>)[f.key] = v;
      syncFields(el);
      schedule();
    });
    el.addEventListener('change', () => syncFields());
  }

  const tenure = $<HTMLInputElement>('#f-tenure');
  tenure.addEventListener('input', () => {
    const v = parseNumber(tenure.value);
    state.tenureMonths = Number.isFinite(v) ? Math.round(tenureUnit === 'years' ? v * 12 : v) : NaN;
    syncFields(tenure);
    schedule();
  });
  tenure.addEventListener('change', () => syncFields());

  const start = $<HTMLInputElement>('#f-start');
  start.addEventListener('input', () => {
    state.startDate = start.value;
    schedule();
  });

  const rp = $<HTMLInputElement>('#r-principal');
  rp.addEventListener('input', () => {
    state.principal = fromLog(+rp.value);
    syncFields(rp);
    schedule();
  });
  const rr = $<HTMLInputElement>('#r-rate');
  rr.addEventListener('input', () => {
    state.annualRate = Math.round(+rr.value * 100) / 100;
    syncFields(rr);
    schedule();
  });
  const rt = $<HTMLInputElement>('#r-tenure');
  rt.addEventListener('input', () => {
    state.tenureMonths = tenureUnit === 'years' ? +rt.value * 12 : +rt.value;
    syncFields(rt);
    schedule();
  });

  $<HTMLInputElement>('#f-gst').addEventListener('change', (e) => {
    state.applyGst = (e.target as HTMLInputElement).checked;
    if (state.applyGst && !Number.isFinite(state.gstRate)) state.gstRate = defaults.gstRate;
    syncFields();
    schedule();
  });
  $<HTMLInputElement>('#f-shift').addEventListener('change', (e) => {
    state.shiftToStatement = (e.target as HTMLInputElement).checked;
    if (state.shiftToStatement && !Number.isFinite(state.statementDay)) state.statementDay = defaults.statementDay;
    syncFields();
    schedule();
  });

  $$<HTMLButtonElement>('[data-unit]').forEach((b) =>
    b.addEventListener('click', () => {
      tenureUnit = b.dataset.unit as 'months' | 'years';
      store.savePrefs({ tenureUnit });
      syncFields();
    }),
  );
  $$<HTMLButtonElement>('[data-view]').forEach((b) =>
    b.addEventListener('click', () => {
      view = b.dataset.view as 'monthly' | 'yearly';
      store.savePrefs({ scheduleView: view });
      renderTable();
    }),
  );
  $$<HTMLButtonElement>('[data-preset]').forEach((b) =>
    b.addEventListener('click', () => {
      const p = presets[+b.dataset.preset!];
      applyInputs({ ...state, extraMonthly: 0, lumpSum: 0, ...p.values });
    }),
  );

  $('#btn-share').addEventListener('click', shareLink);

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      openSaveDialog();
    }
  });
}

export function initCalculator() {
  const prefs = store.loadPrefs();
  tenureUnit = prefs.tenureUnit === 'years' ? 'years' : 'months';
  view = prefs.scheduleView === 'yearly' ? 'yearly' : 'monthly';

  const shared = fromQuery(location.search);
  if (shared) {
    state = sanitize(shared);
    history.replaceState(null, '', location.pathname);
  } else {
    state = sanitize(store.loadLast());
  }

  setupInputs();
  setupTheme();
  setupExportMenu();
  setupDialogs();
  setupMobileBar();
  updateSavedCount();
  applyInputs(state);

  let w = window.innerWidth;
  addEventListener('resize', () => {
    if (window.innerWidth !== w) {
      w = window.innerWidth;
      renderChart();
    }
  });

  if (shared) toast('Loaded a shared calculation');
  if (!store.storageAvailable()) toast('Storage is blocked in this browser, so saving is turned off');
}
