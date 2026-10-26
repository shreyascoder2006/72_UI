/* Builds Cascade-Intelligence-Provenance.docx — the short form of PROVENANCE.md.

     node tools/doc/provenance_doc.js [out.docx]

   Self-contained: no screenshots, no figures, no external assets. Typography and
   colour follow the prototype's own tokens (src/css/tokens.css), so the document and
   the product read as one thing. Fonts are Barlow and IBM Plex Mono; without them
   installed the layout holds and the typeface falls back.

   PROVENANCE.md is the source of truth. This file is the printable summary of it and
   has to be edited alongside it — neither is generated from the other. */
const fs = require('fs');
const path = require('path');
const d = require('docx');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, ImageRun,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle, PageBreak,
  Header, Footer, PageNumber, LevelFormat, convertInchesToTwip,
} = d;

const img = (p) => fs.readFileSync(p);

// ── Palette and geometry ───────────────────────────────────────────────────
// The prototype's own tokens (src/css/tokens.css), carried into print. The accent and
// the risk scale are the interface colours exactly; each also has a darker twin for
// text, because #79a7e3 and #3fb27f are legible on #090b0e but not on white.
const PANEL = '0D0F12';      // --panel-solid: section bands and table heads
const ACC_UI = '79A7E3';     // --accent: fills, bars, rules on dark
const ACC = '2F5F94';        // the same hue at text weight on white
const INK = '14181D', MUT = '55616F', LINE = 'C9D2DC', SOFT = 'EEF3F8';
const OK_UI = '3FB27F', WATCH_UI = 'E2B93B', HIGH_UI = 'EE8A2A', CRIT_UI = 'E5484D';
const OK = '27754F', WARN = '8A6A12', CR = 'B7343A';
const UI = 'Barlow', MONO = 'IBM Plex Mono';
const MARGIN = convertInchesToTwip(0.6);
const PAGE_W = 11906, CONTENT = PAGE_W - 2 * MARGIN;  // A4 portrait
const PX = Math.round((CONTENT / 1440) * 96);          // content width in px at 96 dpi

const noBorder = { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } };
const hair = (c = LINE) => ({ style: BorderStyle.SINGLE, size: 4, color: c });

// ── Text helpers ───────────────────────────────────────────────────────────
const P = (text, o = {}) => new Paragraph({
  spacing: { before: o.before ?? 0, after: o.after ?? 78, line: o.line ?? 238 },
  alignment: o.align, indent: o.indent, border: o.border,
  children: runs(text, o),
});
// Inline markup: **bold**, //italic//
function runs(text, o = {}) {
  if (Array.isArray(text)) return text;
  const out = [];
  const re = /(\*\*[^*]+\*\*|\/\/[^/]+\/\/)/g;
  let last = 0, m;
  const mk = (t, extra) => new TextRun({ text: t, size: o.size ?? 19, color: o.color ?? INK, font: o.font ?? UI, ...extra });
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(mk(text.slice(last, m.index)));
    const tok = m[0];
    if (tok.startsWith('**')) out.push(mk(tok.slice(2, -2), { bold: true }));
    else out.push(mk(tok.slice(2, -2), { italics: true }));
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(mk(text.slice(last)));
  return out.length ? out : [mk(text)];
}
// A dark band with a mono section number, the way the interface titles its panels.
const H1 = (t, n) => new Paragraph({
  heading: HeadingLevel.HEADING_1, spacing: { before: 132, after: 94 },
  shading: { type: ShadingType.CLEAR, fill: PANEL, color: 'auto' },
  indent: { left: 110, right: 110 },
  border: { left: { style: BorderStyle.SINGLE, size: 16, color: ACC_UI, space: 4 } },
  children: [
    ...(n ? [new TextRun({ text: n + '   ', bold: true, size: 22, color: ACC_UI, font: MONO })] : []),
    new TextRun({ text: t.toUpperCase(), bold: true, size: 23, color: 'FFFFFF', font: UI, characterSpacing: 30 }),
  ],
});
const H2 = (t) => new Paragraph({
  heading: HeadingLevel.HEADING_2, spacing: { before: 112, after: 56 },
  children: [new TextRun({ text: t, bold: true, size: 21, color: INK, font: UI })],
});
const KICK = (t) => new Paragraph({
  spacing: { before: 0, after: 55 },
  children: [new TextRun({ text: t.toUpperCase(), bold: true, size: 15, color: MUT, font: UI, characterSpacing: 24 })],
});
const CAP = (t) => new Paragraph({
  spacing: { before: 40, after: 130 },
  children: [new TextRun({ text: t, size: 15.5 * 2 / 2, color: MUT, italics: true, font: UI })],
});
const BR = () => new Paragraph({ children: [new PageBreak()] });

// Mono runs, for every number and identifier — the interface sets all of them in
// IBM Plex Mono with tabular figures, and the document should read the same way.
const M = (t, o = {}) => new TextRun({ text: t, font: MONO, size: o.size ?? 17, color: o.color ?? INK, bold: o.bold });
// A risk chip, drawn the way the pills in the interface are.
const chip = (t, fill) => new TextRun({ text: ' ' + t.toUpperCase() + ' ', font: UI, size: 15, bold: true, color: 'FFFFFF', shading: { type: ShadingType.CLEAR, fill, color: 'auto' }, characterSpacing: 14 });

// Bullet list without a numbering config (keeps control of indents).
const LI = (text, o = {}) => new Paragraph({
  spacing: { before: 0, after: 46, line: 232 },
  indent: { left: 200, hanging: 150 },
  children: [new TextRun({ text: '— ', size: 19, color: ACC, bold: true, font: UI }), ...runs(text, o)],
});

// ── Image helpers ──────────────────────────────────────────────────────────
// A4 content box is about 678 x 1007 px at 96 dpi. A tall portrait capture sized to
// the column width would run past a whole page, so height is capped first and the
// width follows from it.
const MAX_H = 392;
function pic(file, w, h, o = {}) {
  let width = o.width ?? Math.round(PX * 0.92);
  let height = Math.round((h / w) * width);
  const cap = o.maxH ?? MAX_H;
  if (height > cap) { height = cap; width = Math.round((w / h) * cap); }
  return new Paragraph({
    spacing: { before: o.before ?? 50, after: o.after ?? 25 },
    alignment: AlignmentType.CENTER,
    children: [new ImageRun({ type: file.endsWith('.jpg') ? 'jpg' : 'png', data: img(file), transformation: { width, height } })],
  });
}
const figure = (name, w, h, caption) => [pic(path.join(FIG, name + '.png'), w, h, { maxH: 548 }), CAP(caption)];
// Screenshots come from the current capture; names not in it fall back to the older
// set (the hero model renders and the sidebar states, which have not changed).
const shot = (name, caption, width, maxH) => {
  let p = path.join(SHOTS, name + '.jpg');
  if (!fs.existsSync(p)) p = path.join(OLDSHOTS, name + '.png');
  const dim = imgSize(p);
  return [pic(p, dim[0], dim[1], { width, maxH }), CAP(caption)];
};
function pngSize(p) {
  const b = fs.readFileSync(p);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}
// Pixel dimensions of a PNG or a baseline/progressive JPEG.
function imgSize(p) {
  if (p.endsWith('.png')) return pngSize(p);
  const b = fs.readFileSync(p);
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
    i += 2 + b.readUInt16BE(i + 2);
  }
  throw new Error('no JPEG frame header in ' + p);
}

// ── Table helper ───────────────────────────────────────────────────────────
function table(cols, rows, o = {}) {
  const widths = cols.map((c) => Math.round(CONTENT * c.w));
  widths[0] += CONTENT - widths.reduce((a, b) => a + b, 0);
  const cell = (txt, i, head, zebra) => new TableCell({
    width: { size: widths[i], type: WidthType.DXA },
    margins: { top: 46, bottom: 46, left: 92, right: 92 },
    shading: { type: ShadingType.CLEAR, fill: head ? ACC : zebra ? SOFT : 'FFFFFF', color: 'auto' },
    borders: { top: hair(), bottom: hair(), left: hair(), right: hair() },
    children: [new Paragraph({
      spacing: { before: 0, after: 0, line: 226 },
      alignment: cols[i].align,
      children: runs(String(txt), { size: o.size ?? 17, color: head ? 'FFFFFF' : INK }).map((r) => {
        if (head) { r.root.forEach && 0; }
        return r;
      }),
    })],
  });
  const headRow = new TableRow({
    tableHeader: true, cantSplit: true,
    children: cols.map((c, i) => new TableCell({
      width: { size: widths[i], type: WidthType.DXA },
      margins: { top: 46, bottom: 46, left: 92, right: 92 },
      shading: { type: ShadingType.CLEAR, fill: PANEL, color: 'auto' },
      borders: { top: hair(PANEL), bottom: hair(PANEL), left: hair(PANEL), right: hair(PANEL) },
      children: [new Paragraph({
        spacing: { before: 0, after: 0, line: 226 }, alignment: c.align,
        children: [new TextRun({ text: c.t.toUpperCase(), bold: true, size: (o.size ?? 17) - 2, color: ACC_UI, font: UI, characterSpacing: 16 })],
      })],
    })),
  });
  return new Table({
    columnWidths: widths,
    width: { size: CONTENT, type: WidthType.DXA },
    rows: [headRow, ...rows.map((r, n) => new TableRow({ cantSplit: true, children: r.map((v, i) => cell(v, i, false, n % 2 === 1)) }))],
  });
}

// Callout box
function note(title, body, color = ACC) {
  return new Table({
    columnWidths: [CONTENT],
    width: { size: CONTENT, type: WidthType.DXA },
    rows: [new TableRow({
      children: [new TableCell({
        width: { size: CONTENT, type: WidthType.DXA },
        margins: { top: 90, bottom: 90, left: 130, right: 130 },
        shading: { type: ShadingType.CLEAR, fill: SOFT, color: 'auto' },
        borders: { top: hair(color), bottom: hair(color), left: { style: BorderStyle.SINGLE, size: 18, color }, right: hair(color) },
        children: [
          new Paragraph({ spacing: { after: 45 }, children: [new TextRun({ text: title, bold: true, size: 19, color, font: UI })] }),
          new Paragraph({ spacing: { after: 0, line: 245 }, children: runs(body, { size: 18 }) }),
        ],
      })],
    })],
  });
}
const GAP = (h = 90) => new Paragraph({ spacing: { before: 0, after: h }, children: [new TextRun({ text: '', size: 2 })] });

// Two-column side-by-side block of paragraphs
function duo(leftChildren, rightChildren) {
  const w = Math.floor(CONTENT / 2);
  const c = (kids) => new TableCell({
    width: { size: w, type: WidthType.DXA }, borders: noBorder,
    margins: { top: 0, bottom: 0, left: 0, right: 150 }, children: kids,
  });
  return new Table({ columnWidths: [w, CONTENT - w], width: { size: CONTENT, type: WidthType.DXA }, borders: noBorder, rows: [new TableRow({ children: [c(leftChildren), c(rightChildren)] })] });
}


// ═══════════════════════════════════════════════════════════════════════════
const body = [];
const add = (...x) => x.forEach((y) => (Array.isArray(y) ? body.push(...y) : body.push(y)));
// Monospace block, for rules quoted verbatim from the source.
const CODE = (lines) => new Table({
  columnWidths: [CONTENT], width: { size: CONTENT, type: WidthType.DXA },
  rows: [new TableRow({ children: [new TableCell({
    width: { size: CONTENT, type: WidthType.DXA }, margins: { top: 70, bottom: 70, left: 120, right: 100 },
    shading: { type: ShadingType.CLEAR, fill: PANEL, color: 'auto' },
    borders: { top: hair(PANEL), bottom: hair(PANEL), left: { style: BorderStyle.SINGLE, size: 14, color: ACC_UI }, right: hair(PANEL) },
    children: lines.map((l) => new Paragraph({ spacing: { before: 0, after: 0, line: 220 },
      children: [new TextRun({ text: l, font: MONO, size: 15, color: 'D8E2EE' })] })),
  })] })],
});

add(new Paragraph({ spacing: { after: 50 }, children: [new TextRun({ text: 'Where every number comes from', bold: true, size: 44, color: ACC, font: UI })] }));
add(new Paragraph({ spacing: { after: 100 }, border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: ACC, space: 6 } },
  children: [new TextRun({ text: 'The rules, definitions and thresholds behind every figure Cascade Intelligence displays', size: 22, color: INK, font: UI })] }));
add(P('This is the provenance record for the prototype. For each number the interface shows, it gives the definition, the file that computes it, the rule that governs it, what backs that choice and where it stops being reliable. **Every constant quoted appears verbatim in the source at the path given.** The full version is PROVENANCE.md in the repository; this is the short form.', { size: 19, after: 120 }));

add(KICK('The six rules the system obeys'));
add(table([{ t: 'Rule', w: 0.26 }, { t: 'What it means, and where it is enforced', w: 0.74 }], [
  ['Nothing uncomputed is shown', 'No figure is typed in, read from a fixture or interpolated. If the engine does not produce it, the product does not display it — which is why there is no cost, no vehicle count and no travel time anywhere.'],
  ['Issue-time isolation', 'Every page is a pure function of (city, scenario, issue time). A time later than the simulated now is clamped back to it, in pages.js load(). Scrubbing the clock rebuilds every product from the evidence available then.'],
  ['One state, one answer', 'Exactly one engine instance per city|scenario, shared by every page (services.js). Two screens contradicting each other is impossible by construction, not by discipline.'],
  ['Measurement is not inference', 'Feed, analysis and trust are kept in three separate columns. A 42% trust score is never rendered as a 42% physical reading.'],
  ['Uncertainty is carried', 'No internal single-number forecast exists. "73% chance" means 146 of 200 ensemble members crossed — not a band drawn round a point estimate.'],
  ['Simulated data is labelled', 'A SIMULATION badge and a provenance line on every page. Geography is real OpenStreetMap; every sensor reading and outcome is generated.'],
], { size: 17 }));
add(GAP(100));

add(KICK('The foundation — what “risk” means'));
add(P('Every facility carries one number in [0,1] at every half-hour step: **how far this asset is from failing at its own job.** A drainage gauge at 0.8 is near overtopping; a hospital at 0.8 is near diversion. The scale is normalised per asset by its own capacity, set in tools/spec*.py.'));
add(duo([CODE([
  'src/js/core.js   STATES',
  '  NORMAL     0.00 - 0.35',
  '  WATCH      0.35 - 0.55',
  '  HIGH RISK  0.55 - 0.75   HIGH = 0.55',
  '  CRITICAL   0.75 - 1.00   CRIT = 0.75',
])], [CODE([
  'src/js/engine/engine.js',
  '  DT    = 0.5    half-hour steps',
  '  HOURS = 72     forecast horizon',
  '  K     = 145    steps, T+0.0 ... T+72.0',
  '  M     = 200    ensemble members',
])]));
add(GAP(50));
add(note('Why one scale across asset classes', 'Because the cascade crosses them. A threshold in metres of river stage cannot be compared with one in bed occupancy, and the handoff between the two is the entire problem. **0.75 is a modelling convention applied uniformly, not a calibrated physical constant** — it is stated here so that anyone reading a CRITICAL label knows exactly what was asserted.'));

add(H1('Every metric, and the rule behind it', '01'));
add(table([{ t: 'Metric', w: 0.17 }, { t: 'Exact definition', w: 0.44 }, { t: 'The rule, and what backs it', w: 0.39 }], [
  ['Cascade-R · analytics.js', 'Stress arriving through learned dependency links ÷ stress arriving directly from the hazard, summed over the city and split by system.', 'At or above 1 the cascade is self-sustaining: stopping the hazard no longer stops it. Borrowed from the reproduction number in epidemiology; the threshold falls out of the ratio, it is not tuned.'],
  ['Facility risk · engine.js now[]', 'Weighted ensemble mean, corrected toward the observation by a gain whose observation variance is inflated by distrust: gain = sd²/(sd²+so²), where so = SIGMA/max(0.05, trust).', 'A sensor the model does not believe moves the estimate less. A distrusted stream stops steering the forecast rather than breaking it.'],
  ['Sensor trust · engine.js', 'res = |obs − one-step prediction| / √(SIGMA² + priorSd²); EWMA at 0.85/0.15; target = exp(−max(0, resid−1.6)/1.1), ×0.25 on a flatline of 4+ steps; trust moves at gain 0.25, clamped to [0.03, 0.99].', 'Normalised by **total predictive spread**, so disagreeing with an uncertain forecast is not evidence of failure. A separate flatline test catches frozen gauges, which no residual test can. Below 0.5 trust, forgetting triples (0.985 → 0.82).'],
  ['P(crossing) and time to critical', 'Over 200 members: the share that cross at all, and the weighted **median** hour among those that do. Listed only if p ≥ 0.3.', 'Median not mean, because crossing times are strongly right-skewed. p = 0.50 at T+43.5 and p = 1.00 at T+43.5 are very different situations, so both numbers are always shown together.'],
  ['Crisis membership · analytics.js', 'A facility joins the stressed set when observed ≥ 0.35 having reached HIGH RISK, or forecast to cross HIGH RISK within 24 h with p ≥ 0.5. Two join the same crisis when a live learned link (not pruned, mean ≥ 0.06, flow ≥ 0.02) runs between them.', 'The crisis count is a property of the **learned graph at that issue time**, not a fixed partition. The same city an hour later can show two crises instead of four because a link has started carrying stress.'],
  ['Edge status · engine.js', 'learned = ev/(1+ev). Confirmed: mean ≥ 0.08 and mean/sd ≥ 2.5 and learned > 0.5. Pruned: mean < 0.05 and learned > 0.6. Candidate: everything else.', 'A configured graph has no concept of a pruned edge. **Seven decoy links per city carry a true weight of zero** with the same starting prior and equally plausible names; the learner is scored on pruning them.'],
  ['Critical facility-hours', 'Sum over facilities and steps at or above CRITICAL, weighted by tierW = 4 − tier (weather excluded).', 'Unweighted, twenty flooded gauges outrank one diverting hospital — which inverts what matters. The tier is a hand-set judgement in the city spec, not a measurement.'],
  ['Reduction %', '1 − withPlan.critHours / baseline.critHours, from re-simulating the city twice on the 32 members best matching the evidence so far.', 'A **difference between two simulations, not a stored effectiveness rating.** The same action therefore scores differently in a cloudburst and in a dam release.'],
  ['Side effects', 'Any facility whose expected peak rises by more than 0.03 — three points — because of the plan; top five reported.', 'A closure that keeps one corridor dry loads the next. The threshold is deliberately below what an operator would notice by eye: a system reporting only benefits would be an advocacy tool.'],
  ['Cascade broken', 'Baseline P(any hospital critical) > 0.4 and with-plan < 0.3.', 'Deliberately conservative: asserted only when the probability falls from likely to unlikely. Defined here so the label cannot be misread.'],
  ['Recommended plan', 'Greedy: repeatedly add the action with the best marginal reduction in critical facility-hours per crew, while that gain exceeds 0.05.', 'Greedy is **not optimal** — it can miss a pair that only helps together. The 0.05 floor makes the planner stop rather than spend crews on something negligible, which is why some scenarios return less than the budget.'],
  ['Decision deadline — “act by”', 'The plan re-run with crews starting 0, 2, 4 … 24 h later, deciding on the **same information**. actBy = the last start keeping at least 80% of the act-now benefit; half = the first start worth under 50%.', 'Only the response is delayed, never the knowledge. **80% is a stated convention, not a derived optimum** — the whole decay curve is drawn beside it so a different line can be read off by eye.'],
  ['Hours bought on a crossing', 'tPlan − tBase from the two returned trajectories, reported only above 0.4 h. “Kept below CRITICAL” only when the baseline crosses and the plan does not.', 'Reading the plan trajectory alone credits the plan for facilities that never would have crossed. On Raleigh that was three rows of four before it was fixed; a probe now re-derives it from the engine and fails if any mark is unearned.'],
  ['CAP grading · comms.js', 'Extreme if nCrit ≥ 3 or people > 250,000; Severe if nCrit ≥ 1 or next p ≥ 0.6. Immediate if observed and maxR ≥ 0.75, or eta ≤ 6 h. Observed / Likely (p ≥ 0.6) / Possible.', 'Derived from the registry, never written by hand. The alert polygon **is** the crisis footprint object, so the area warned and the area analysed cannot drift apart.'],
  ['SMS segments', 'GSM-7: one segment up to 160 characters, then ⌈n/153⌉. UCS-2: one up to 70, then ⌈n/67⌉.', 'GSM 03.38 — the encoding the carrier actually bills on. Devanagari forces UCS-2, so the same warning costs three segments in Hindi and one in English.'],
  ['Residents in a footprint', 'A modelled residential grid, each cell tied to its nearest exposed facility within 1.5 km, influence decaying at 900 m.', '**Modelled, not counted.** No diurnal movement: a business district has the same population at 3 a.m. as at 3 p.m. The weakest number in the system, and labelled as modelled wherever shown.'],
], { size: 15.5 }));

add(H1('The mechanisms underneath', '02'));
add(duo([
  H2('Only excess stress propagates'),
  CODE(['gThr(r, thr) =', '  r > thr ? ((r-thr)/(1-thr))^1.15 : 0']),
  P('An asset inside its design limit passes **nothing** downstream. A substation at 60% does not endanger a hospital; the same substation at 94% does. The exponent makes propagation mildly convex — stress accelerates near failure.', { size: 18 }),
  H2('Observation noise is not uniform'),
  CODE(['SIGMA  hospital 0.02   power 0.035', '       ems 0.035      telecom 0.04', '       drainage 0.04   pump 0.05', '       weather 0.06    traffic 0.07']),
  P('Administrative feeds — bed census, CAD, SCADA — are precise. **Camera-derived traffic is the noisiest thing in the system.** Treating them as equally reliable is the easiest way to get a cascade forecast wrong.', { size: 18 }),
], [
  H2('The assimilation loop, at every one of 145 steps'),
  CODE(['LAMBDA    = 0.985   about 23 h of memory', 'ESS_FLOOR = 0.12    keep 12% effective', 'lambda -> 0.82      if trust < 0.5']),
  LI('**Localisation** — weights are per facility. Being wrong about a pump in the north does not discredit a member’s view of a hospital in the south. Without it, one bad gauge discredits correct futures city-wide.'),
  LI('**Forgetting** — without decay the filter locks onto the start of the event. With it, the posterior tracks a situation that is itself changing.'),
  LI('**Tempering** — if fewer than 12% of members carry real weight the update is softened, so the ensemble can never collapse onto one confident future.'),
  LI('**Quarantine** — a suspect stream is forgotten three times faster, so a frozen gauge stops dominating the posterior.'),
  H2('Dependency learning'),
  P('Sparse Bayesian learning with automatic relevance determination: zero-mean priors with a per-edge precision re-estimated by EM, so an edge the data stops supporting decays toward zero instead of sitting there as a configured constant.', { size: 18 }),
]));
add(GAP(70));
add(KICK('What is deliberately not computed'));
add(table([{ t: 'Not shown', w: 0.26 }, { t: 'Why', w: 0.74 }], [
  ['Monetary cost or saving', 'No cost model exists. A rupee figure would be a guess carrying two decimal places.'],
  ['Vehicle, pump or crew counts', 'The model’s only resource unit is an abstract crew. There is no fleet inventory.'],
  ['Travel time, crew locations', 'No routing engine and no AVL feed.'],
  ['Residents protected', 'Requires an exposure-to-harm model the system does not have.'],
  ['Per-intervention timelines', 'The planner evaluates outcomes, not deployment schedules.'],
  ['Casualty or damage estimates', 'No vulnerability model.'],
], { size: 16 }));

add(H1('Provenance, testing and limits', '03'));
add(duo([
  KICK('What is real, what is simulated'),
  table([{ t: 'Layer', w: 0.52 }, { t: 'Status', w: 0.48 }], [
    ['Facilities, streets, rivers, buildings', 'Real — OpenStreetMap'],
    ['Rainfall forecast, My area only', 'Real and live — Open-Meteo'],
    ['Chronos-Bolt second opinion', 'Real model, precomputed offline'],
    ['Rainfall timing, 23 Sep 2023 only', 'IMD-reported figures'],
    ['Every sensor reading and outcome', 'Simulated — scenarios.js'],
  ], { size: 15.5 }),
], [
  KICK('How the claims are tested — executable, not reviewed'),
  table([{ t: 'Check', w: 0.4 }, { t: 'What it establishes', w: 0.6 }], [
    ['regress.sh', 'Six engine baselines byte-identical'],
    ['scenario_matrix.js', 'All 31 runs distinguishable; fails if two match'],
    ['response_probe.js', '20 checks, including that no “kept below CRITICAL” mark is unearned'],
    ['board_probe.js · routes.js', '14 + 25 checks on the board, routing and issue-time isolation'],
    ['Replay mode', 'Lead time, detection rate, false-alarm ratio, calibration'],
    ['second.js vs Chronos-Bolt', 'A pretrained model as a control, same issue times'],
  ], { size: 15.5 }),
]));
add(GAP(70));
add(note('Known limits, stated rather than discovered',
  '**1.** The ensemble is over-dispersed: its 80% band contains the truth 92–93% of the time — too humble rather than overconfident, but a calibration error. **2.** The simulated truth and the ensemble share a model family, so structural model error is zero by construction; a real deployment would face error this test cannot show. **This is the most important caveat here.** **3.** A real edge starts with its prior upper bound at twice its true weight, so the learner begins in the right neighbourhood; reality offers no such head start. **4.** Raleigh’s city model has no telecom facilities, so no Raleigh scenario can show a telecom failure. **5.** The intervention catalogue has nothing that materially helps a heat dome or a snowstorm. **6.** Roughly 200–300 facilities before the browser ensemble gets heavy. **7.** No live ingestion, no persistence, no audit trail, no multi-user state — the modelling is real and validated, the data plumbing is not built.', CR));
add(GAP(80));

add(KICK('Every threshold in one place'));
add(P('Each of these is a number someone chose. They are collected here so a reviewer can disagree with any one of them without reading the source.', { size: 18 }));
add(table([{ t: 'Constant', w: 0.18 }, { t: 'Value', w: 0.17 }, { t: 'Governs', w: 0.33 }, { t: 'Status', w: 0.32 }], [
  ['CRIT', '0.75', 'Where an asset stops delivering its function', 'Modelling convention, applied uniformly'],
  ['HIGH', '0.55', 'Entry to the stressed set and the registry', 'Convention'],
  ['WATCH', '0.35', 'Lower bound of “still stressed” when observed', 'Convention'],
  ['M', '200 members', 'Ensemble size', 'Chosen for browser performance; more would be better'],
  ['DT · K', '0.5 h · 145', 'Step length and horizon, T+0 to T+72', 'Set by the problem statement'],
  ['LAMBDA', '0.985', 'Forgetting per step, about 23 h of memory', 'Tuned so the filter tracks drift without thrashing'],
  ['Quarantine', '0.82', 'Forgetting when trust is below 0.5', 'Tuned; roughly three times faster'],
  ['ESS_FLOOR', '0.12', 'Minimum effective sample size before tempering', 'Standard practice in particle filtering'],
  ['gThr exponent', '1.15', 'Convexity of propagation above threshold', 'Chosen so stress accelerates near failure'],
  ['Edge confirmed', 'mean ≥ 0.08, mean/sd ≥ 2.5, learned > 0.5', 'When a learned link is asserted as real', 'Posterior significance at about 2.5 sigma'],
  ['Edge pruned', 'mean < 0.05, learned > 0.6', 'When a link is discarded', 'Requires the evidence to be mostly data, not prior'],
  ['Crisis join', 'mean ≥ 0.06, flow ≥ 0.02', 'When two stressed facilities form one crisis', 'Convention; low, so grouping is generous'],
  ['Crisis forecast', 'p ≥ 0.5 within 24 h', 'When a not-yet-stressed facility counts', 'Convention'],
  ['Cascade listing', 'p ≥ 0.3', 'When a crossing is listed at all', 'Convention; below this it is noise'],
  ['Side effect', 'peak rise > 0.03', 'When a plan’s cost elsewhere is reported', 'Deliberately below what an operator notices'],
  ['Planner floor', 'gain > 0.05', 'When the planner stops adding actions', 'Stops crews being spent on the negligible'],
  ['Deadline', '80% of benefit', 'The act-by hour', 'Stated convention; the full curve is drawn beside it'],
  ['Shift reported', '> 0.4 h', 'When a plan is said to have bought time', 'Just under one step, so a one-step shift counts'],
  ['Cascade broken', '0.4 down to under 0.3', 'P(any hospital critical) likely to unlikely', 'Deliberately conservative'],
  ['CAP Extreme', 'nCrit ≥ 3, or people > 250,000', 'Top alert severity', 'Convention; the population figure is modelled'],
], { size: 15.5 }));
add(GAP(60));
add(P('//Figures are quoted from the source at the paths given. If the code changes, this document is wrong until it is updated; it is not generated automatically. The full version is PROVENANCE.md in the repository.//', { size: 17 }));

const doc = new Document({
  creator: 'Cascade Intelligence',
  title: 'Cascade Intelligence — The 72-Hour Warning',
  description: 'Urban digital twin for crisis cascade prediction: problem, approach, technical design, impact and viability.',
  styles: {
    default: { document: { run: { font: UI, size: 19, color: INK } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 26, bold: true, color: ACC, font: UI } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 21, bold: true, color: INK, font: UI } },
    ],
  },
  sections: [{
    properties: {
      page: { margin: { top: MARGIN, right: MARGIN, bottom: convertInchesToTwip(0.45), left: MARGIN } },
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          spacing: { after: 70 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: LINE, space: 2 } },
          children: [
            new TextRun({ text: 'CASCADE INTELLIGENCE', bold: true, size: 13, color: MUT, font: UI, characterSpacing: 40 }),
            new TextRun({ text: ' · The 72-Hour Warning · Nagpur & Raleigh', size: 13, color: MUT, font: UI }),
          ],
        })],
      }),
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [
            new TextRun({ text: 'Page ', size: 14, color: MUT, font: UI }),
            new TextRun({ children: [PageNumber.CURRENT], size: 14, color: MUT, bold: true, font: UI }),
            new TextRun({ text: ' of ', size: 14, color: MUT, font: UI }),
            new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 14, color: MUT, font: UI }),
          ],
        })],
      }),
    },
    children: body,
  }],
});

Packer.toBuffer(doc).then((buf) => {
  const out = process.argv[2] || path.join(__dirname, 'Cascade-Intelligence.docx');
  fs.writeFileSync(out, buf);
  console.log('wrote', out, (buf.length / 1024 / 1024).toFixed(1) + ' MB');
});
