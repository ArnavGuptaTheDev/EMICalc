# EMICalc

A fast, private EMI calculator for Indian loans and credit-card EMIs. It is a static Astro site with one small vanilla TypeScript island, so there is no backend and no framework runtime. Saved calculations live in the browser's `localStorage`.

## Features

- **Live EMI** as you type or drag. Amount, rate and tenure each have a slider and a number field. The amount slider is logarithmic (₹10K – ₹1 Cr) and the amount is also shown in words ("5 lakh").
- **Tenure in months or years**, plus quick presets (phone on card, personal, car and home loan).
- **Card charges.** GST on interest (rate is configurable, default 18%), processing fee (with GST), and *first EMI on statement date*. The last option adds broken-period interest for the days between purchase and the first statement.
- **Prepayments.** Set an extra amount every month and/or a one-time part-payment. Shows the interest saved and how many months earlier the loan ends.
- **Effective rate (IRR)** including GST, fees and broken-period interest. Use it to spot "no-cost EMI" offers that aren't free.
- **Schedule.** Monthly or yearly view with dated instalments, a sticky header and totals. The balance-over-time chart has a hover/tap tooltip.
- **Save / load / rename / delete** up to 50 calculations, with undo. A JSON **backup export/import** is included, and the last-used inputs are restored on return.
- **Share link.** The inputs are encoded in the URL, with no server involved.
- **Export:** CSV (Excel-friendly), a PNG summary card, and Print / Save as PDF (print stylesheet).
- Light/dark theme (follows the system, with a toggle). Responsive from 320px phones to desktops. Works offline after the first visit (service worker).

## Requirements

- Node.js **22.12+** (Astro 7 requirement)
- npm 9.6+

## Local development

```bash
npm install
npm run dev        # http://localhost:4321 with hot reload
```

Other scripts:

| Command           | What it does                                                        |
| ----------------- | ------------------------------------------------------------------- |
| `npm run build`   | Subsets the fonts, then builds the static site into `dist/`          |
| `npm run preview` | Serves `dist/` locally, the same way production will                 |
| `npm test`        | Unit tests for the EMI engine (Vitest)                               |
| `npm run check`   | Type-checks `.astro` and `.ts` files                                 |
| `npm run fonts`   | Re-generates the subset fonts in `public/fonts/` only                |

## Deploy to Cloudflare Pages

**Option A: Git integration (recommended)**

1. Push this folder to GitHub or GitLab. If it lives inside a larger repo, set the root directory to `EmiCalc`.
2. In the Cloudflare dashboard, go to **Workers & Pages → Create → Pages → Connect to Git** and pick the repo.
3. Build settings:
   - Framework preset: **Astro**
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Root directory: `EmiCalc` (only if it's in a sub-folder)
   - Environment variable: `NODE_VERSION` = `22` (or newer)
4. Click **Save and Deploy**. Every push to the main branch deploys, and other branches get preview URLs.

**Option B: Direct upload with Wrangler**

```bash
npm run build
npx wrangler pages deploy dist --project-name emicalc
```

After the first deploy, set your real domain in `astro.config.mjs` (`site`) and in `src/content/site.ts` (`url`). These are used for the canonical URL.

`public/_headers` sets long-lived caching for hashed assets and fonts, plus basic security headers. Cloudflare Pages picks it up automatically.

## Where to edit things

| You want to change…                                   | Edit                                   |
| ------------------------------------------------------ | -------------------------------------- |
| Headline, intro text, footer, page title/description   | `src/content/site.ts` → `site`         |
| Starting values (amount, rate, tenure, GST…)           | `src/content/site.ts` → `defaults`     |
| Slider ranges                                          | `src/content/site.ts` → `sliders`      |
| Preset chips                                           | `src/content/site.ts` → `presets`      |
| "How the numbers are worked out" cards                 | `src/content/site.ts` → `formula`      |
| FAQ                                                    | `src/content/site.ts` → `faq`          |
| Colours, spacing, typography                           | `src/styles/global.css` (tokens at the top under `:root`, dark theme right below) |
| Calculation logic / validation limits                  | `src/lib/emi.ts` (covered by `src/lib/emi.test.ts`) |
| Form and results markup                                | `src/components/Calculator.astro`      |
| Page structure (header, sections, footer)              | `src/pages/index.astro`                |
| Interactivity (live calc, save, share, export)         | `src/scripts/app.ts`, `charts.ts`, `exports.ts` |

## Fonts

- **Fraunces** (display) and **Instrument Sans** (text) come from Fontsource (`@fontsource-variable/*`, dev dependencies).
- `scripts/subset-fonts.mjs` runs before every build. It subsets each font to Basic Latin plus every non-ASCII character found in `src/`. Fraunces is pinned to one optical size, which brings it down to about 28 KB. Output goes to `public/fonts/`.
- Instrument Sans has no ₹ glyph, so a 1 KB ₹-only face cut from Fraunces is included as a per-glyph fallback (`unicode-range: U+20B9`).
- All faces use `font-display: swap`, and the two main files are preloaded.

## Project layout

```
EmiCalc/
├─ public/              static files copied as-is (fonts, favicon, sw.js, _headers, manifest)
├─ scripts/             build helpers (font subsetting)
└─ src/
   ├─ content/site.ts   ← all editable copy & defaults
   ├─ lib/              pure logic: emi engine, formatting, storage, share-link codec (+ tests)
   ├─ scripts/          the browser island: app.ts, charts.ts, exports.ts
   ├─ components/       Calculator.astro, Icon.astro
   ├─ layouts/          Base.astro (head, theme bootstrapping, SW registration)
   ├─ pages/index.astro
   └─ styles/global.css
```

## How the maths works

- `r = annual rate / 12 / 100`, `EMI = P·r·(1+r)ⁿ / ((1+r)ⁿ − 1)`, and `P/n` when `r = 0`.
- Each month: `interest = balance × r`, `principal = EMI − interest`, and `GST = interest × GST rate`.
- Broken-period interest (when the first EMI moves to the statement date) is `P × annual rate × days / 365`. The gap is capped at 60 days, and the amount is added to the first bill along with the processing fee and the GST on both. Unlike the original Flutter app, it is **included in the totals**.
- Prepayments reduce principal and keep the EMI the same, so the loan ends early.
- Effective rate: the monthly IRR of (+P, −payment₁…ₙ) found by bisection, then × 12.

## Privacy & storage

Everything is computed in the browser. Data is stored under `localStorage` keys prefixed `emicalc:v1:`:

- `saved`: saved calculations
- `last`: last-used inputs
- `prefs`: theme, tenure unit and schedule view

If storage is blocked (some private modes), the calculator still works and saving is disabled with a notice.
