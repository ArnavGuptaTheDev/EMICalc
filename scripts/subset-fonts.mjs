// Subsets the Fontsource variable fonts down to the glyphs this site actually
// uses and writes them to public/fonts/. Run via `npm run fonts` (also runs
// automatically before `npm run build`).
//
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import subsetFont from 'subset-font';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'fonts');
const fs = (pkg, file) => join(root, 'node_modules', '@fontsource-variable', pkg, 'files', file);

// Basic Latin plus every non-ASCII character used anywhere in src/, so new
// copy with curly quotes, dashes or symbols is picked up automatically.
// Add characters to EXTRA_CHARS for text that only appears at runtime.
const EXTRA_CHARS = ' –—‘’“”•·×…−≈÷ⁿ↑↓';

async function charsUsedIn(dir) {
  const found = new Set();
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) for (const c of await charsUsedIn(p)) found.add(c);
    else if (/\.(astro|ts|css|md|mjs)$/.test(entry.name))
      for (const c of await readFile(p, 'utf8')) if (c.codePointAt(0) > 0x7e && c !== '₹') found.add(c);
  }
  return found;
}

let ascii = '';
for (let c = 0x20; c <= 0x7e; c++) ascii += String.fromCharCode(c);
const TEXT = ascii + EXTRA_CHARS + [...(await charsUsedIn(join(root, 'src')))].join('');

const jobs = [
  {
    // Display face: pin optical size + playful axes, keep a 400–700 weight range.
    src: fs('fraunces', 'fraunces-latin-full-normal.woff2'),
    out: 'fraunces-subset.woff2',
    text: TEXT,
    variationAxes: { SOFT: 50, WONK: 0, opsz: 48, wght: { min: 400, max: 700, default: 600 } },
  },
  {
    // Text face: weight axis only (the file already has just wght).
    src: fs('instrument-sans', 'instrument-sans-latin-wght-normal.woff2'),
    out: 'instrument-sans-subset.woff2',
    text: TEXT,
  },
  {
    // Instrument Sans has no ₹ glyph; borrow Fraunces' as a one-glyph fallback.
    src: fs('fraunces', 'fraunces-latin-ext-full-normal.woff2'),
    out: 'rupee-subset.woff2',
    text: '₹',
    variationAxes: { SOFT: 50, WONK: 0, opsz: 24 },
  },
];

await mkdir(outDir, { recursive: true });

for (const job of jobs) {
  const input = await readFile(job.src);
  const output = await subsetFont(input, job.text, {
    targetFormat: 'woff2',
    variationAxes: job.variationAxes,
  });
  const dest = join(outDir, job.out);
  await writeFile(dest, output);
  const before = (await stat(job.src)).size;
  console.log(
    `fonts: ${job.out.padEnd(28)} ${(before / 1024).toFixed(1).padStart(6)} KB -> ${(output.length / 1024).toFixed(1).padStart(5)} KB`,
  );
}
