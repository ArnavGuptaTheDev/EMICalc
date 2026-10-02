/** CSV, PNG summary card and file download helpers — all client-side. */
import type { LoanInputs, LoanResult } from '../lib/emi';
import { money, money0, monthYear, percent, tenureLabel } from '../lib/format';

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const baseName = (i: LoanInputs) => `emi-${Math.round(i.principal)}-${String(i.annualRate).replace('.', '_')}pct-${i.tenureMonths}m`;

export function downloadCsv(r: LoanResult, i: LoanInputs) {
  const f = (v: number) => v.toFixed(2);
  const rows = [
    ['Instalment', 'Date', 'Opening balance (INR)', 'Payment (INR)', 'Principal (INR)', 'Interest (INR)', 'GST (INR)', 'Prepayment (INR)', 'One-time charges (INR)', 'Closing balance (INR)'],
    ...r.schedule.map((s) => [String(s.n), s.date, f(s.opening), f(s.payment), f(s.principal), f(s.interest), f(s.gst), f(s.prepayment), f(s.oneTime), f(s.closing)]),
    [],
    ['Total', '', '', f(r.schedule.reduce((a, s) => a + s.payment, 0)), f(r.schedule.reduce((a, s) => a + s.principal, 0)), f(r.totalInterest), f(r.totalGst), f(r.totalPrepaid), f(r.schedule.reduce((a, s) => a + s.oneTime, 0)), ''],
  ];
  const csv = rows.map((row) => row.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\r\n');
  // BOM so Excel opens it as UTF-8.
  saveBlob(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), `${baseName(i)}.csv`);
}

export async function downloadImage(r: LoanResult, i: LoanInputs) {
  const W = 1200;
  const H = 630;
  const S = 2;
  const display = '"Fraunces", Georgia, serif';
  const text = '"Instrument Sans", "Rupee", system-ui, sans-serif';
  await Promise.all([document.fonts.load(`600 40px ${display}`), document.fonts.load(`600 40px ${text}`), document.fonts.load(`400 40px "Rupee"`)]).catch(() => {});

  const c = document.createElement('canvas');
  c.width = W * S;
  c.height = H * S;
  const ctx = c.getContext('2d')!;
  ctx.scale(S, S);

  const C = { bg: '#f5f1e8', card: '#fffdf8', ink: '#1b1a17', ink2: '#4d4a43', ink3: '#6b665c', line: '#e3dccd', p: '#2a78d6', i: '#eb6834', g: '#1baf7a' };
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = C.card;
  ctx.beginPath();
  ctx.roundRect(32, 32, W - 64, H - 64, 24);
  ctx.fill();
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1;
  ctx.stroke();

  const L = 80;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.ink;
  ctx.font = `700 30px ${display}`;
  ctx.fillText('EMICalc', L, 104);
  ctx.textAlign = 'right';
  ctx.font = `500 20px ${text}`;
  ctx.fillStyle = C.ink3;
  ctx.fillText(new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date()), W - L, 102);
  ctx.textAlign = 'left';

  ctx.font = `600 22px ${text}`;
  ctx.fillStyle = C.ink2;
  ctx.fillText('Monthly EMI', L, 176);
  ctx.font = `650 92px ${text}`;
  ctx.fillStyle = C.ink;
  const emiText = money(r.emi);
  ctx.fillText(emiText, L, 264);
  const ew = ctx.measureText(emiText).width;
  ctx.font = `500 28px ${text}`;
  ctx.fillStyle = C.ink3;
  ctx.fillText('/month', L + ew + 14, 264);

  ctx.font = `500 24px ${text}`;
  ctx.fillStyle = C.ink2;
  const desc = [`${money0(i.principal)} at ${i.annualRate}% p.a. for ${tenureLabel(r.months)}`];
  if (i.applyGst) desc.push(`GST ${i.gstRate}%`);
  ctx.fillText(desc.join(' · '), L, 310);

  // stacked bar, 2px surface gaps
  const other = r.totalGst + r.processingFee;
  const parts = [
    { v: i.principal, c: C.p, label: 'Principal' },
    { v: r.totalInterest, c: C.i, label: 'Interest' },
    { v: other, c: C.g, label: r.processingFee > 0 ? 'GST & fees' : 'GST' },
  ].filter((p) => p.v > 0);
  const total = parts.reduce((a, p) => a + p.v, 0);
  const barW = W - 2 * L;
  const gap = 3;
  let bx = L;
  const by = 356;
  parts.forEach((p, k) => {
    const w = (p.v / total) * (barW - gap * (parts.length - 1));
    ctx.fillStyle = p.c;
    ctx.beginPath();
    const rad = [k === 0 ? 5 : 0, k === parts.length - 1 ? 5 : 0, k === parts.length - 1 ? 5 : 0, k === 0 ? 5 : 0];
    ctx.roundRect(bx, by, Math.max(w, 1), 18, rad);
    ctx.fill();
    bx += w + gap;
  });

  // legend
  let lx = L;
  const ly = 420;
  for (const p of parts) {
    ctx.fillStyle = p.c;
    ctx.beginPath();
    ctx.roundRect(lx, ly - 14, 14, 14, 3);
    ctx.fill();
    ctx.fillStyle = C.ink3;
    ctx.font = `500 20px ${text}`;
    ctx.fillText(p.label, lx + 24, ly);
    ctx.fillStyle = C.ink;
    ctx.font = `600 26px ${text}`;
    ctx.fillText(money0(p.v), lx + 24, ly + 36);
    lx += 270;
  }
  ctx.textAlign = 'right';
  ctx.fillStyle = C.ink3;
  ctx.font = `500 20px ${text}`;
  ctx.fillText('Total payable', W - L, ly);
  ctx.fillStyle = C.ink;
  ctx.font = `700 30px ${text}`;
  ctx.fillText(money0(r.totalPayable), W - L, ly + 38);
  ctx.textAlign = 'left';

  ctx.strokeStyle = C.line;
  ctx.beginPath();
  ctx.moveTo(L, 500);
  ctx.lineTo(W - L, 500);
  ctx.stroke();
  ctx.font = `500 20px ${text}`;
  ctx.fillStyle = C.ink2;
  const last = r.schedule[r.schedule.length - 1];
  ctx.fillText(`Effective rate ${percent(Math.round(r.effectiveRate * 100) / 100)}   ·   ${r.months} instalments   ·   last EMI ${monthYear(last.date)}`, L, 542);

  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'));
  if (!blob) return;
  const file = new File([blob], `${baseName(i)}.png`, { type: 'image/png' });
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'EMI summary' });
      return;
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return;
    }
  }
  saveBlob(blob, file.name);
}
