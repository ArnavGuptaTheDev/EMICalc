/**
 * Outstanding-balance area chart, hand-rolled SVG. Colours come from CSS
 * custom properties, so theme switches restyle it without a re-render.
 */
import type { LoanResult } from '../lib/emi';
import { money, moneyShort, monthYear } from '../lib/format';

const NS = 'http://www.w3.org/2000/svg';
const shortDate = new Intl.DateTimeFormat('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' });
const fmtShort = (iso: string) => shortDate.format(new Date(iso + 'T00:00:00Z')).replace(' ', ' ’');

function niceStep(range: number, maxTicks: number): number {
  const raw = range / maxTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * mag >= raw) return m * mag;
  return 10 * mag;
}

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  parent?.appendChild(node);
  return node;
}

let cleanup: (() => void) | null = null;

export function renderBalanceChart(
  host: HTMLElement,
  tip: HTMLElement,
  legend: HTMLElement,
  r: LoanResult,
  base: LoanResult | null,
  principal: number,
) {
  cleanup?.();
  host.textContent = '';
  tip.hidden = true;

  const main = [principal, ...r.schedule.map((s) => s.closing)];
  const alt = base ? [principal, ...base.schedule.map((s) => s.closing)] : null;
  const dates = (base ?? r).schedule.map((s) => s.date);
  const n = Math.max(main.length, alt?.length ?? 0) - 1;

  legend.innerHTML = alt
    ? `<span><i style="background:var(--s-principal)"></i>With prepayments</span><span><i style="background:var(--s-muted)"></i>Without prepayments</span>`
    : '';
  legend.hidden = !alt;
  if (n < 1) return;

  const W = Math.max(280, host.clientWidth || 600);
  const H = W < 520 ? 190 : 250;
  const m = { t: 10, r: 14, b: 26, l: W < 520 ? 48 : 58 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const x = (k: number) => m.l + (k / n) * pw;
  const y = (v: number) => m.t + (1 - v / principal) * ph;

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': `Outstanding balance falls from ${money(principal)} to zero over ${r.months} months` });

  // grid + y axis
  const axis = el('g', { class: 'axis' }, svg);
  const yStep = niceStep(principal, W < 520 ? 3 : 4);
  for (let v = 0; v <= principal + 1e-6; v += yStep) {
    el('line', { class: 'gridline', x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }, axis);
    const t = el('text', { x: m.l - 8, y: y(v) + 4, 'text-anchor': 'end' }, axis);
    t.textContent = moneyShort(v);
  }

  // x ticks: pick a month step that gives at most ~5 labels
  const maxX = W < 520 ? 3 : 6;
  const steps = [1, 2, 3, 6, 12, 24, 36, 60, 120];
  const xStep = steps.find((s) => n / s <= maxX) ?? 120;
  for (let k = xStep; k <= n; k += xStep) {
    const t = el('text', { x: x(k), y: H - 6, 'text-anchor': k === n ? 'end' : 'middle' }, axis);
    t.textContent = fmtShort(dates[k - 1]);
  }
  const t0 = el('text', { x: m.l, y: H - 6, 'text-anchor': 'start' }, axis);
  t0.textContent = 'Start';

  const pathFor = (pts: number[]) => pts.map((v, k) => `${k ? 'L' : 'M'}${x(k).toFixed(1)},${y(v).toFixed(1)}`).join('');

  if (alt) el('path', { d: pathFor(alt), fill: 'none', style: 'stroke: var(--s-muted)', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
  const lastX = x(main.length - 1).toFixed(1);
  el('path', { d: `${pathFor(main)}L${lastX},${y(0)}L${x(0)},${y(0)}Z`, style: 'fill: var(--s-principal); fill-opacity: 0.1' }, svg);
  el('path', { d: pathFor(main), fill: 'none', style: 'stroke: var(--s-principal)', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
  el('line', { x1: m.l, x2: W - m.r, y1: y(0), y2: y(0), style: 'stroke: var(--line-strong)', 'stroke-width': 1 }, svg);

  // hover layer
  const hover = el('g', { style: 'display:none' }, svg);
  const cross = el('line', { y1: m.t, y2: m.t + ph, style: 'stroke: var(--ink-3)', 'stroke-width': 1 }, hover);
  const dotAlt = alt ? el('circle', { r: 4.5, style: 'fill: var(--s-muted); stroke: var(--surface)', 'stroke-width': 2 }, hover) : null;
  const dot = el('circle', { r: 4.5, style: 'fill: var(--s-principal); stroke: var(--surface)', 'stroke-width': 2 }, hover);
  const hit = el('rect', { x: m.l, y: 0, width: pw, height: H, fill: 'transparent' }, svg);

  host.appendChild(svg);

  const show = (clientX: number) => {
    const box = svg.getBoundingClientRect();
    const px = ((clientX - box.left) / box.width) * W;
    const k = Math.round(Math.min(n, Math.max(0, ((px - m.l) / pw) * n)));
    const cx = x(k);
    hover.style.display = '';
    cross.setAttribute('x1', String(cx));
    cross.setAttribute('x2', String(cx));
    const mv = main[Math.min(k, main.length - 1)];
    dot.setAttribute('cx', String(cx));
    dot.setAttribute('cy', String(y(mv)));
    if (dotAlt && alt) {
      dotAlt.setAttribute('cx', String(cx));
      dotAlt.setAttribute('cy', String(y(alt[Math.min(k, alt.length - 1)])));
    }
    const row = k > 0 ? r.schedule[k - 1] : undefined;
    const title = k === 0 ? 'At start' : `EMI ${k} · ${monthYear(dates[k - 1])}`;
    let html = `<b>${title}</b><div class="row"><span><i style="background:var(--s-principal)"></i>Balance</span><span>${money(mv)}</span></div>`;
    if (alt) html += `<div class="row"><span><i style="background:var(--s-muted)"></i>Without prepay</span><span>${money(alt[Math.min(k, alt.length - 1)])}</span></div>`;
    if (row) {
      html += `<div class="row"><span>Principal paid</span><span>${money(row.principal + row.prepayment)}</span></div>`;
      html += `<div class="row"><span>Interest paid</span><span>${money(row.interest)}</span></div>`;
    }
    tip.innerHTML = html;
    tip.hidden = false;
    const scale = box.width / W;
    const tw = tip.offsetWidth;
    const left = cx * scale + 14 + tw > box.width ? cx * scale - tw - 14 : cx * scale + 14;
    tip.style.transform = `translate(${Math.max(0, left)}px, ${host.offsetTop + m.t}px)`;
  };
  const hide = () => {
    hover.style.display = 'none';
    tip.hidden = true;
  };
  const onMove = (e: PointerEvent) => show(e.clientX);
  hit.addEventListener('pointermove', onMove);
  hit.addEventListener('pointerdown', onMove);
  hit.addEventListener('pointerleave', hide);
  const onScroll = () => hide();
  addEventListener('scroll', onScroll, { passive: true });
  cleanup = () => removeEventListener('scroll', onScroll);
}
