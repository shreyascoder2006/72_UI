/* Warnings at #/warnings: the warning-preparation workspace.

   An operator picks a crisis from the alert queue, checks its alert area on a 2D map,
   reviews the alert's CAP grading and timing, and prepares the public message, the CAP
   1.2 payload and the responder situation report, all from one screen.

   Every product comes from comms.js at the issue time (sms, segments, cap, sitrep,
   grade, footprint), so a warning shown for T+30 in a replay is exactly what could have
   been prepared at T+30. Nothing here connects to a gateway: all products are marked
   EXERCISE, the review steps are a local exercise workflow, and no delivery, recipient
   or approval is ever claimed. Independent of the 3D twin: the coverage map is SVG. */
(function (root) {
  const T = root.TWIN;
  const C = T.core, S = T.site, V = T.crisisView;
  const { fmtT, stateOf } = C;
  const { esc } = S;
  const $ = (id) => document.getElementById(id);
  const SEV_RANK = { Extreme: 3, Severe: 2, Moderate: 1 };
  const SEV_CLS = { Extreme: 'r-critical', Severe: 'r-high', Moderate: 'r-watch' };
  const FOOT_M = 700; // the CAP polygon's radius around each member (comms.cap)

  let token = 0, L = null, M = null;
  // UI state; products are rebuilt from the engine whenever city, scenario or time change.
  let ctxKey = '', selId = null, lang = null, channel = 'sms', pview = 'banner', query = '', fSev = 'all', fUrg = 'all', zoom = 'alert';
  const drafts = new Map();   // `${crisis}|${k}|${lang}` → operator's edited text (local only)
  const workflow = new Map(); // `${crisis}|${k}` → { reviewed, ready, simulated } (local exercise workflow)
  let sitrepText = null, sitrepKey = '', sitrepJob = 0;
  // Issue-time playback: the page can step through every half hour the twin has issued
  // (up to the simulated now; the whole 72 h in replay) without leaving the page.
  let kMax = 0, playing = false, playRaf = 0, speed = 2, studioAt = 0;
  let hist = [], histKey = '', histJob = 0; // per step: { Extreme, Severe, Moderate } counts
  let view = null, viewAnim = 0, lastDrawn = '', hoverK = null; // map viewBox and the footprint last drawn in
  const shown = new Map();  // tile → number last shown, for counting up to the new value
  const BACK = 6;           // "new" and "escalated" compare with the issue 3 h (6 steps) earlier

  // ── Model ──────────────────────────────────────────────────────────────
  function model(L) {
    const { e, an, k } = L, comms = T.comms, cfg = comms.cityCfg(L.geo);
    const reg = an.crises(k), cr = an.cascadeR(k);
    const kb = Math.max(0, k - BACK), before = new Map(an.crises(kb).list.map((c) => [c.id, comms.grade(c, kb * e.DT).severity]));
    const alerts = reg.list.map((c) => {
      const g = comms.grade(c, L.t);
      const inEffect = c.observed && c.maxR >= 0.55;
      const onsetT = c.observed ? Math.min(L.t, c.since) : c.since;
      const sms = Object.fromEntries(cfg.langs.map((l) => [l, comms.sms(L.geo, e.t0, c, L.t, l)]));
      const was = before.get(c.id);
      const change = k === kb ? null : !was ? 'new' : SEV_RANK[g.severity] > SEV_RANK[was] ? `up:${was}` : SEV_RANK[g.severity] < SEV_RANK[was] ? `down:${was}` : null;
      return { c, g, inEffect, onsetT, expiresT: L.t + 12, sms, change, ring: comms.footprint(c.members.map((i) => e.F[i].lngLat), FOOT_M) };
    }).sort((a, b) => SEV_RANK[b.g.severity] - SEV_RANK[a.g.severity] || a.g.eta - b.g.eta);
    return { cfg, reg, cr, alerts, before: k === kb ? null : { t: kb * e.DT, n: before.size, gone: [...before.keys()].filter((id) => !reg.list.some((c) => c.id === id)) } };
  }
  const selected = () => M.alerts.find((a) => a.c.id === selId) || null;
  const wfKey = (a) => `${a.c.id}|${L.k}`;
  const wfOf = (a) => workflow.get(wfKey(a)) || { reviewed: false, ready: false, simulated: false };
  function wfLabel(a) {
    const w = wfOf(a);
    return w.simulated ? 'Simulated issue (exercise)' : w.ready ? 'Exercise-ready' : w.reviewed ? 'Reviewed' : 'Generated · awaiting review';
  }
  const stamp = (t) => T.comms.stamp(L.e.t0, t, L.geo.tz);
  const people = (n) => (n == null ? 'not modeled' : n >= 1e6 ? `≈${(n / 1e6).toFixed(2)} million` : `≈${Math.round(n / 1000).toLocaleString('en-US')},000`);

  // ── Page ───────────────────────────────────────────────────────────────
  async function render(ctx) {
    const my = ++token, alive = () => my === token;
    stopPlay();
    S.header('/warnings');
    try { L = await S.load(ctx, S.busy); } catch (err) { S.fail(err); return; }
    if (!alive()) return;
    S.settle(L); S.header('/warnings', L);
    M = model(L);
    // A new city or scenario starts clean; a new time keeps the selection if it still exists.
    const key = `${L.geo.id}|${L.scen.id}`;
    if (key !== ctxKey) { ctxKey = key; selId = null; lang = null; query = ''; fSev = 'all'; fUrg = 'all'; zoom = 'alert'; shown.clear(); }
    if (!lang || !M.cfg.langs.includes(lang)) lang = M.cfg.langs[0];
    if (ctx.c && M.alerts.some((a) => a.c.id === ctx.c)) selId = ctx.c;
    if (!selected()) selId = M.alerts[0] ? M.alerts[0].c.id : null;
    sitrepText = null; view = null; lastDrawn = '';
    kMax = L.e.kOf(L.nowT);
    const hk = `${key}|${L.mode}`;
    if (hk !== histKey) { histKey = hk; hist = []; }

    $('page').innerHTML = `
      <div class="pg-wrap wn-wrap">
        <header class="wn-head">
          <div>
            <p class="pg-kicker">${esc(L.scen.label)} · <span>${esc(L.scen.provenance ? L.scen.provenance.label : 'Simulation')}</span></p>
            <h1>Warnings &amp; public communication</h1>
            <p class="wn-lede">Select an alert, check its area, then review the public message, CAP payload and situation report generated from what the twin knew at the issue time.</p>
          </div>
          <p class="wn-asof" id="wnAsof"></p>
        </header>
        <p class="warn-exercise" role="note"><b>EXERCISE</b> All products are marked EXERCISE. This is a simulation and must not be sent to a real alerting gateway; this page has no connection to one.</p>
        <div class="wn-sum" id="wnSum"></div>
        <section class="bd-card wn-tl" id="wnTL" aria-label="Issue time"></section>
        <div class="wn-grid">
          <section class="bd-card wn-queue" aria-labelledby="wnQh" id="wnQueue"></section>
          <section class="bd-card wn-cov" aria-labelledby="wnCh" id="wnCov"></section>
          <aside class="bd-card wn-insp" aria-labelledby="wnIh" id="wnInsp" aria-live="polite"></aside>
        </div>
        <div class="wn-lower">
          <section class="bd-card wn-studio" aria-labelledby="wnSh" id="wnStudio"></section>
          <aside class="bd-card wn-flow" aria-labelledby="wnFh" id="wnFlow"></aside>
        </div>
        <p class="wn-foot">${esc(S.provenance(L))} CAP severity follows the number of critical members and the residents in the footprint; urgency, how soon the next facility is forecast to go critical; certainty, whether the crisis is observed or forecast. Advice is per hazard family in ${M.cfg.langs.map((l) => T.comms.LANG_NAME[l]).join(', ')}, with ${esc(L.geo.city)}'s helpline ${M.cfg.help} and ambulance number ${M.cfg.ems}.</p>
      </div>`;
    wire();
    drawAll();
    buildHistory(my);
    await buildSitrep();
  }
  // The situation report includes the planner's recommendation, which takes a moment.
  async function buildSitrep() {
    const my = ++sitrepJob, k = L.k, mine = () => my === sitrepJob && L && L.k === k;
    await S.nextFrame();
    if (!mine()) return;
    const plan = await T.services.recommended(L.e, L.k, 5);
    if (!mine()) return;
    const p = T.services.planner(L.e);
    const pop = T.services.population(L.geo.id);
    sitrepText = T.comms.sitrep(null, L.e, L.k, {
      number: Math.max(1, Math.round(L.t / 3)), cr: M.cr, crises: M.reg, redTeam: false,
      people: pop.modeled ? pop.atRisk(L.e.stateAt(L.k).risk) : { high: 0, crit: 0 },
      plan: plan.ids.length ? { ids: plan.ids, catalog: p.CATALOG, result: plan.result, deadline: p.deadline(L.k, plan.ids) } : null,
    });
    sitrepKey = `${ctxKey}|${L.k}`;
    drawReady();
    if (!playing) drawStudio();
  }
  function drawAll() { drawAsof(); drawSummary(); drawTimeline(); drawQueue(); drawCoverage(); drawInspector(); drawStudio(); drawFlow(); }
  function drawAsof() {
    $('wnAsof').innerHTML = `As issuable at ${V.at(L, L.t)}${L.mode === 'historical' ? ' · replay' : L.follow ? '' : ` · ${(L.nowT - L.t).toFixed(1)} h before the simulated now`}<br><span class="faint">by the ${esc(M.cfg.desk)} · ${M.alerts.length} alertable crisis${M.alerts.length === 1 ? '' : 'es'}</span>`;
  }

  // ── Issue time ─────────────────────────────────────────────────────────
  // Move the page to another issue time. Everything is rebuilt from the engine at that
  // step; only steps the twin has issued (≤ the simulated now) are reachable.
  function setK(k, { commit = !playing } = {}) {
    k = Math.max(0, Math.min(kMax, Math.round(k)));
    if (k === L.k) { if (commit) commitT(); return; }
    L = { ...L, k, t: k * L.e.DT, follow: k >= kMax };
    M = model(L);
    if (!selected()) selId = M.alerts[0] ? M.alerts[0].c.id : null;
    sitrepText = null;
    drawAsof(); drawSummary(); drawTimeHead(); drawQueue(); drawCoverage(); drawInspector(); drawFlow();
    // The studio holds the editor and the CAP; while playing it refreshes a few times a second.
    const busy = document.activeElement && document.activeElement.id === 'wnDraft';
    if (!busy && (!playing || performance.now() - studioAt > 700)) { studioAt = performance.now(); drawStudio(); }
    if (commit) commitT();
  }
  // Keep the address and the site header in step with the page (no reload).
  function commitT() {
    T.store.set({ t: L.follow ? null : L.t, c: selId });
    S.header('/warnings', L);
    drawStudio();
    buildSitrep();
  }
  function play() {
    if (playing) { stopPlay(); commitT(); drawTimeHead(); return; }
    if (L.k >= kMax) setK(0, { commit: false });
    playing = true; drawTimeHead();
    let last = performance.now(), acc = 0;
    const step = (now) => {
      if (!playing) return;
      acc += ((now - last) / 1000) * speed * 2; last = now; // speed in scenario hours per second
      if (acc >= 1) { const n = Math.floor(acc); acc -= n; setK(L.k + n, { commit: false }); }
      if (L.k >= kMax) { stopPlay(); commitT(); drawTimeHead(); return; }
      playRaf = requestAnimationFrame(step);
    };
    playRaf = requestAnimationFrame(step);
  }
  function stopPlay() { playing = false; cancelAnimationFrame(playRaf); }

  // How many alerts were alertable at each step, built in small slices after the page
  // shows (each step runs the engine's crisis registry once, then it is cached).
  function buildHistory(my) {
    const job = ++histJob, e = L.e, an = L.an;
    const run = () => {
      if (my !== token || job !== histJob) return;
      const t0 = performance.now();
      while (hist.length <= kMax && performance.now() - t0 < 12) {
        const k = hist.length, n = { Extreme: 0, Severe: 0, Moderate: 0 };
        for (const c of an.crises(k).list) n[T.comms.grade(c, k * e.DT).severity]++;
        hist.push(n);
      }
      drawTimeBars();
      if (hist.length <= kMax) setTimeout(run, 0);
    };
    setTimeout(run, 0);
  }
  const TL = { W: 1000, H: 74, padL: 34, padR: 10, top: 8, bot: 18 };
  const tx = (k) => TL.padL + (k / (L.e.K - 1)) * (TL.W - TL.padL - TL.padR);
  function drawTimeline() {
    const live = L.mode !== 'historical';
    $('wnTL').innerHTML = `
      <div class="wn-tl-row">
        <button type="button" class="wn-play" data-play aria-label="Play"></button>
        <div class="wn-tl-read"><b class="num" id="wnTLt"></b><span id="wnTLs"></span></div>
        <div class="seg wn-speed" role="group" aria-label="Playback speed">${[1, 2, 4].map((s) => `<button type="button" data-speed="${s}" aria-pressed="${s === speed}">${s} h/s</button>`).join('')}</div>
        <span class="wn-tl-hint faint" id="wnTLh" aria-live="off" data-def="${live ? 'Drag or play through every issue up to the simulated now. Later hours are not known yet.' : 'Replay: every issue over the 72 h window.'}"></span>
        <button type="button" class="btn wn-tl-now" data-tnow>${live ? 'Back to now' : 'Go to end'}</button>
      </div>
      <svg id="wnTLsvg" class="wn-tl-svg" viewBox="0 0 ${TL.W} ${TL.H}" preserveAspectRatio="none" role="slider" tabindex="0" aria-label="Issue time"
        aria-valuemin="0" aria-valuemax="${(kMax * L.e.DT).toFixed(1)}">
        <defs><pattern id="wnHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" class="wn-hatch"/></pattern></defs>
        <g id="wnTLbars"></g>
        ${kMax < L.e.K - 1 ? `<rect x="${tx(kMax + 0.5)}" y="${TL.top}" width="${TL.W - TL.padR - tx(kMax + 0.5)}" height="${TL.H - TL.top - TL.bot}" fill="url(#wnHatch)" class="wn-tl-future"/><text x="${(tx(kMax) + TL.W - TL.padR) / 2}" y="${(TL.H - TL.bot + TL.top) / 2 + 4}" text-anchor="middle" class="wn-tl-ft">not yet known</text>` : ''}
        ${[0, 12, 24, 36, 48, 60, 72].map((h) => `<text x="${tx(h / L.e.DT)}" y="${TL.H - 4}" text-anchor="middle" class="wn-tl-tick">T+${h}</text>`).join('')}
        <line id="wnTLnow" x1="${tx(kMax)}" x2="${tx(kMax)}" y1="${TL.top - 4}" y2="${TL.H - TL.bot}" class="wn-tl-nowl"/>
        <line id="wnTLhov" y1="${TL.top}" y2="${TL.H - TL.bot}" class="wn-tl-hov" visibility="hidden"/>
        <g id="wnTLhead"><line y1="${TL.top - 6}" y2="${TL.H - TL.bot + 2}" class="wn-tl-headl"/><circle r="5" cy="${TL.top - 4}" class="wn-tl-knob"/></g>
      </svg>`;
    $('wnTLh').textContent = $('wnTLh').dataset.def;
    drawTimeBars(); drawTimeHead();
  }
  function drawTimeBars() {
    const g = $('wnTLbars');
    if (!g) return;
    const max = Math.max(3, ...hist.map((n) => n.Extreme + n.Severe + n.Moderate));
    const h = TL.H - TL.top - TL.bot, w = Math.max(1.5, tx(1) - tx(0) - 1.2);
    g.innerHTML = `<text x="${TL.padL - 6}" y="${TL.top + 6}" text-anchor="end" class="wn-tl-tick">${max}</text><text x="${TL.padL - 6}" y="${TL.H - TL.bot}" text-anchor="end" class="wn-tl-tick">0</text>`
      + hist.map((n, k) => {
        let y = TL.H - TL.bot;
        return ['Moderate', 'Severe', 'Extreme'].map((s) => { if (!n[s]) return ''; const bh = (n[s] / max) * h; y -= bh; return `<rect x="${(tx(k) - w / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${bh.toFixed(1)}" class="wn-tlb ${SEV_CLS[s]}"/>`; }).join('');
      }).join('')
      + (hist.length <= kMax ? `<text x="${tx(hist.length)}" y="${TL.H - TL.bot - 4}" class="wn-tl-ft">building…</text>` : '');
  }
  function drawTimeHead() {
    const head = $('wnTLhead');
    if (!head) return;
    head.setAttribute('transform', `translate(${tx(L.k)},0)`);
    const svg = $('wnTLsvg'), n = M.alerts.length;
    svg.setAttribute('aria-valuenow', L.t.toFixed(1));
    svg.setAttribute('aria-valuetext', `${fmtT(L.t)}, ${n} alert${n === 1 ? '' : 's'}`);
    $('wnTLt').textContent = fmtT(L.t);
    $('wnTLs').textContent = `${stamp(L.t)} · ${n} alert${n === 1 ? '' : 's'}${L.follow && L.mode !== 'historical' ? ' · simulated now' : ''}`;
    const b = $('wnTL').querySelector('[data-play]');
    b.innerHTML = playing ? T.icons.UI.pause || '❚❚' : T.icons.UI.play || '▶';
    b.setAttribute('aria-label', playing ? 'Pause' : 'Play the issues');
    b.setAttribute('aria-pressed', String(playing));
    $('wnTL').classList.toggle('playing', playing);
  }
  const kAt = (ev) => { const svg = $('wnTLsvg'), r = svg.getBoundingClientRect(); const x = ((ev.clientX - r.left) / r.width) * TL.W; return Math.round(((x - TL.padL) / (TL.W - TL.padL - TL.padR)) * (L.e.K - 1)); };
  function select(id) {
    selId = id;
    T.store.set({ c: id }); // kept in the link; links to Crises and City twin carry it
    drawQueue(); drawCoverage(); drawInspector(); drawStudio(); drawFlow();
  }

  // ── Summary ────────────────────────────────────────────────────────────
  function drawSummary() {
    const a = M.alerts, n = { Extreme: 0, Severe: 0, Moderate: 0 };
    for (const x of a) n[x.g.severity]++;
    const ppl = a.every((x) => x.c.people != null) ? a.reduce((s, x) => s + x.c.people, 0) : null;
    const dists = new Set(a.flatMap((x) => x.c.districts));
    const total = Math.max(1, a.length), B = M.before;
    // Change against the issue 3 h earlier: new alerts, escalations, alerts that ended.
    const nNew = a.filter((x) => x.change === 'new').length, nUp = a.filter((x) => x.change && x.change.startsWith('up')).length;
    const delta = !B ? '<span class="wn-delta">first issues of the scenario</span>'
      : nNew || nUp || B.gone.length ? `<span class="wn-delta">${[nNew && `<em class="up">+${nNew} new</em>`, nUp && `<em class="up">▲ ${nUp} escalated</em>`, B.gone.length && `<em class="dn">${B.gone.length} ended</em>`].filter(Boolean).join(' · ')} <span>since ${fmtT(B.t)}</span></span>`
      : `<span class="wn-delta">no change since ${fmtT(B.t)}</span>`;
    const crit = a.reduce((s, x) => s + x.c.nCrit, 0), mem = a.reduce((s, x) => s + x.c.members.length, 0);
    $('wnSum').innerHTML = `
      <div class="wn-tile"><span class="wn-tk">Alertable crises</span><b data-count="alerts" data-to="${a.length}">${a.length}</b><span class="faint">${a.length ? `${a.filter((x) => x.inEffect).length} in effect now · ${a.filter((x) => !x.inEffect).length} expected` : `none at ${fmtT(L.t)}`}</span>${delta}</div>
      <div class="wn-tile"><span class="wn-tk">CAP severity</span><b class="wn-sevtxt">${['Extreme', 'Severe', 'Moderate'].map((s) => `<span class="${SEV_CLS[s]}">${n[s]} ${s}</span>`).join(' · ')}</b>
        <span class="wn-sevbar" aria-hidden="true">${['Extreme', 'Severe', 'Moderate'].map((s) => `<i class="${SEV_CLS[s]}" style="width:${(100 * n[s] / total).toFixed(1)}%"></i>`).join('')}</span></div>
      <div class="wn-tile"><span class="wn-tk">Residents in alert footprints</span><b ${ppl != null && a.length ? `data-count="ppl" data-to="${ppl}"` : ''}>${!a.length ? 'none' : ppl == null ? 'not modeled' : people(ppl)}</b><span class="faint">${a.length ? `modeled · across ${dists.size} area${dists.size === 1 ? '' : 's'}` : 'no alert footprint at this time'}</span></div>
      <div class="wn-tile"><span class="wn-tk">Facilities in alerts</span><b><span data-count="mem" data-to="${mem}">${mem}</span> <small>· <span class="r-critical wn-crit" data-count="crit" data-to="${crit}">${crit}</span> critical</small></b><span class="faint">${M.cfg.langs.length} SMS · CAP 1.2 · SITREP per alert · previews only; no gateway is connected</span></div>`;
    countUp();
  }
  // Numbers count from what was shown to the new value, so a change of issue time reads as one.
  function countUp() {
    for (const el of $('wnSum').querySelectorAll('[data-count]')) {
      const id = el.dataset.count, to = +el.dataset.to, from = shown.has(id) ? shown.get(id) : to;
      shown.set(id, to);
      const fmt = id === 'ppl' ? people : (v) => String(Math.round(v));
      if (from === to) continue;
      el.classList.add(to > from ? 'rise' : 'fall');
      const t0 = performance.now(), dur = playing ? 260 : 600;
      const step = (now) => {
        if (!el.isConnected) return;
        const p = Math.min(1, (now - t0) / dur), v = from + (to - from) * (1 - Math.pow(1 - p, 3));
        el.textContent = fmt(v);
        if (p < 1) requestAnimationFrame(step); else el.textContent = fmt(to);
      };
      requestAnimationFrame(step);
    }
  }

  // ── Alert queue ────────────────────────────────────────────────────────
  function drawQueue() {
    const q = query.trim().toLowerCase();
    const urgs = ['Immediate', 'Expected', 'Future'];
    const list = M.alerts.filter((a) => (fSev === 'all' || a.g.severity === fSev) && (fUrg === 'all' || a.g.urgency === fUrg)
      && (!q || [a.c.id, a.c.type, ...a.c.districts].join(' ').toLowerCase().includes(q)));
    const chip = (kind, val, label, count) => `<button type="button" class="wn-chip" data-${kind}="${val}" aria-pressed="${(kind === 'sev' ? fSev : fUrg) === val}">${label}${count != null ? ` <span>${count}</span>` : ''}</button>`;
    $('wnQueue').innerHTML = `
      <div class="bd-h"><h2 id="wnQh">Alert queue <span class="faint">${M.alerts.length}</span></h2></div>
      ${M.alerts.length ? `<div class="wn-qtop">
      <label class="bd-search"><span aria-hidden="true">${T.icons.UI.search}</span><input id="wnSearch" type="search" value="${esc(query)}" placeholder="Search crises, areas" autocomplete="off" aria-label="Search alerts"></label>
      <div class="wn-chips" role="group" aria-label="Filter by severity">${chip('sev', 'all', 'All', M.alerts.length)}${['Extreme', 'Severe', 'Moderate'].filter((s) => M.alerts.some((a) => a.g.severity === s)).map((s) => chip('sev', s, s, M.alerts.filter((a) => a.g.severity === s).length)).join('')}</div>
      <div class="wn-chips" role="group" aria-label="Filter by urgency">${chip('urg', 'all', 'Any timing')}${urgs.filter((u) => M.alerts.some((a) => a.g.urgency === u)).map((u) => chip('urg', u, u, M.alerts.filter((a) => a.g.urgency === u).length)).join('')}</div>
      <ul class="wn-q">${list.map((a) => `<li><button type="button" class="wn-qi ${SEV_CLS[a.g.severity]}${a.c.id === selId ? ' on' : ''}" data-alert="${esc(a.c.id)}" aria-pressed="${a.c.id === selId}">
          <span class="wn-qi-top"><b class="num">${esc(a.c.id)}</b>${badge(a)}<span class="wn-sev ${SEV_CLS[a.g.severity]}">${a.g.severity}</span></span>
          <span class="wn-qi-type">${esc(a.c.type)}</span>
          <span class="wn-qi-area">${esc(V.places(a.c.districts, 2))}</span>
          <span class="wn-qi-meta">${a.g.urgency} · ${a.g.certainty} · ${a.inEffect ? 'in effect now (observed)' : `expected ${esc(stamp(a.onsetT))} (forecast)`}</span>
          <span class="wn-qi-st">${esc(wfLabel(a))}</span></button></li>`).join('') || '<li class="ni-empty">No alert matches the filters.</li>'}</ul></div>
      ${windows()}`
      : `<p class="ni-empty">No crisis is in the registry at ${fmtT(L.t)}, so there is no public alert to prepare. The situation report is still available below.</p>`}
      <div class="wn-rd" id="wnReady"></div>`;
    drawReady();
    const s = $('wnSearch');
    if (s && document.activeElement && document.activeElement.id === 'wnSearch') s.focus();
  }

  // Readiness of every product the page generates, across all alerts in the queue:
  // per language, how many alerts fit one SMS segment; the CAP payloads; the SITREP.
  function drawReady() {
    const el = $('wnReady'); if (!el) return;
    const A = M.alerts, n = A.length;
    const rows = M.cfg.langs.map((l) => {
      const ss = A.map((a) => a.sms[l]), fit = ss.filter(segOk).length, worst = ss.reduce((m, x) => Math.max(m, x.segments), 0);
      const enc = ss.length ? [...new Set(ss.map((x) => x.encoding))].join('/') : '—';
      return `<li><b lang="${l}">${esc(T.comms.LANG_NAME[l])}</b><span class="faint">${enc}</span><span class="${!n ? 'faint' : fit === n ? 'ok' : 'warn'}">${!n ? 'no alert' : fit === n ? `✓ ${n === 1 ? 'one segment' : `all ${n} fit one segment`}` : `! ${n - fit} of ${n} need up to ${worst} segments`}</span></li>`;
    }).join('');
    el.innerHTML = `<h4>Communication readiness <span class="faint">all alerts at ${fmtT(L.t)}</span></h4>
      <ul class="wn-rdl">${rows}
        <li><b>CAP 1.2</b><span class="faint">${M.cfg.langs.length} info block${M.cfg.langs.length > 1 ? 's' : ''} each</span><span class="${n ? 'ok' : 'faint'}">${n ? `✓ ${n} payload${n > 1 ? 's' : ''} · Exercise` : 'none to issue'}</span></li>
        <li><b>SITREP</b><span class="faint">responders</span><span class="${sitrepText ? 'ok' : 'faint'}">${sitrepText ? '✓ generated' : 'building…'}</span></li></ul>`;
  }
  function badge(a) {
    if (!a.change || !M.before) return '';
    const since = fmtT(M.before.t);
    if (a.change === 'new') return `<span class="wn-badge new" title="Not in the registry at ${since}">New</span>`;
    const [dir, was] = a.change.split(':');
    return `<span class="wn-badge ${dir}" title="${was} at ${since}">${dir === 'up' ? '▲' : '▼'} from ${was}</span>`;
  }
  // When each alert applies: onset (observed or forecast) to the generator's expiry, on
  // the scenario's 72 h clock, with the issue time marked.
  function windows() {
    const H = L.e.HOURS, list = M.alerts.slice(0, 8), rowH = 20, W = 300, padL = 92;
    const x = (t) => padL + Math.max(0, Math.min(1, t / H)) * (W - padL - 6);
    const rows = list.map((a, n) => `<g class="${SEV_CLS[a.g.severity]}${a.c.id === selId ? ' on' : ''}" data-alert="${esc(a.c.id)}"><text x="0" y="${20 + n * rowH + 11}" class="wn-wl">${esc(a.c.id)}</text>
      <rect x="${x(a.onsetT)}" y="${20 + n * rowH + 2}" width="${Math.max(2, x(a.expiresT) - x(a.onsetT))}" height="11" rx="2" class="wn-wb"><title>${esc(a.c.id)}: from ${fmtT(a.onsetT)} (${a.inEffect ? 'observed' : 'forecast'}) to ${fmtT(a.expiresT)}</title></rect></g>`).join('');
    const ticks = [0, 24, 48, 72].map((t) => `<text x="${x(t)}" y="12" text-anchor="middle" class="wn-wt">${fmtT(t).replace('.0h', '')}</text>`).join('');
    const hgt = 24 + list.length * rowH;
    return `<div class="wn-win wn-sub"><h4>Alert windows <span class="faint">onset → generated expiry</span></h4>
      <svg viewBox="0 0 ${W} ${hgt}" role="img" aria-label="When each alert applies">${ticks}${rows}<line x1="${x(L.t)}" x2="${x(L.t)}" y1="14" y2="${hgt}" class="wn-wnow"/></svg></div>`;
  }

  // ── Coverage map (SVG; no map engine) ──────────────────────────────────
  // The basemap is drawn once per page; the alert layer and the extent follow the
  // selection and the issue time. Wheel or the buttons zoom, dragging pans.
  function drawCoverage() {
    const a = selected(), geo = L.geo, F = L.e.F;
    $('wnCov').parentElement.classList.toggle('none', !M.alerts.length); // no alert: panels size to their content
    if (!a) { lastDrawn = ''; $('wnCov').innerHTML = `<div class="bd-h"><h2 id="wnCh">Alert coverage</h2></div><p class="ni-empty">No alert area to show at ${fmtT(L.t)}.</p>`; return; }
    const P = S.projector(geo);
    if (!$('wnMap')) mapShell();
    $('wnCovId').textContent = a.c.id;
    for (const b of $('wnCov').querySelectorAll('[data-zoom]')) b.setAttribute('aria-pressed', String(b.dataset.zoom === zoom));
    const box = zoom === 'free' && view ? view : fit(a);
    const sc = box[2] / 600;
    const pts = (ring) => ring.map(P).map((p) => p.map((v) => Math.round(v)).join(',')).join(' ');
    const R = L.e.now.subarray(L.k * L.e.N, (L.k + 1) * L.e.N);
    const mem = new Set(a.c.members), inAny = new Set(M.alerts.flatMap((x) => x.c.members));
    // Every facility of the city, faint, so the alert reads against the whole network.
    const ctx = F.map((f, i) => { if (mem.has(i)) return ''; const [x, y] = P(f.lngLat); return `<circle cx="${Math.round(x)}" cy="${Math.round(y)}" r="${1.5 * sc}" class="wn-ctx r-${stateOf(R[i]).key}${inAny.has(i) ? ' in' : ''}" data-fac="${i}"/>`; }).join('');
    const others = M.alerts.filter((x) => x !== a).map((x) => `<polygon points="${pts(x.ring)}" class="wn-foot-o ${SEV_CLS[x.g.severity]}" data-alert="${esc(x.c.id)}" tabindex="0" role="button" aria-label="Select ${esc(x.c.id)}"/>`).join('');
    // The selected area draws itself in when the selection changes, not on every step.
    const fresh = lastDrawn !== a.c.id; lastDrawn = a.c.id;
    const own = `<polygon points="${pts(a.ring)}" pathLength="1" class="wn-foot-s ${SEV_CLS[a.g.severity]}${fresh ? ' draw' : ''}" data-area="${esc(a.c.id)}"/>`;
    const phase = `animation-delay:-${Math.round(performance.now() % 1800)}ms`; // pulses stay in step across redraws
    const dots = a.c.members.map((i) => {
      const [x, y] = P(F[i].lngLat), st = stateOf(R[i]).key, r = (F[i].tier === 1 ? 3.4 : 2.6) * sc;
      return `${st === 'critical' ? `<circle cx="${Math.round(x)}" cy="${Math.round(y)}" r="${r}" class="wn-pulse" style="${phase}"/>` : ''}<circle cx="${Math.round(x)}" cy="${Math.round(y)}" r="${r}" class="wn-fac r-${st}" data-fac="${i}"/>`;
    }).join('');
    // Locality labels: the city's district names inside the view; one in an alert selects it.
    const inView = (p) => p[0] >= box[0] && p[0] <= box[0] + box[2] && p[1] >= box[1] && p[1] <= box[1] + box[3];
    const labels = (geo.districts || []).map((d) => {
      const p = P(d.lngLat);
      if (!inView(p)) return '';
      const hit = M.alerts.find((x) => x.c.districts.some((n) => n.toLowerCase() === d.name.toLowerCase()));
      return `<text x="${Math.round(p[0])}" y="${Math.round(p[1])}" font-size="${10 * sc}" text-anchor="middle" class="wn-loc${hit ? ' hit' : ''}"${hit ? ` data-alert="${esc(hit.c.id)}"` : ''}>${esc(d.name)}</text>`;
    }).join('');
    $('wnMapL').innerHTML = ctx + others + own + dots + labels;
    $('wnMap').setAttribute('aria-label', `Alert area of ${a.c.id} with ${a.c.members.length} member facilities`);
    $('wnCovLg').className = `wn-lg sel ${SEV_CLS[a.g.severity]}`;
    goTo(box, playing ? 0 : 380);
  }
  function mapShell() {
    const geo = L.geo, a = selected();
    view = view || fit(a);
    $('wnCov').innerHTML = `
      <div class="bd-h"><h2 id="wnCh">Alert coverage <span class="faint" id="wnCovId"></span></h2>
        <div class="seg" role="group" aria-label="Map extent"><button type="button" data-zoom="alert">Fit alert</button><button type="button" data-zoom="city">Whole city</button></div></div>
      <div class="wn-mapwrap">
        <svg class="wn-map" id="wnMap" viewBox="${view.map((v) => Math.round(v)).join(' ')}" preserveAspectRatio="xMidYMid meet" role="group">${S.basemap(geo).svg}<g id="wnMapL"></g></svg>
        <div class="wn-zoom"><button type="button" data-mapzoom="in" aria-label="Zoom in">${T.icons.UI.plus}</button><button type="button" data-mapzoom="out" aria-label="Zoom out">${T.icons.UI.minus}</button></div>
        <div class="wn-tip" id="wnTip" hidden></div>
      </div>
      <p class="bd-legend"><i class="wn-lg sel" id="wnCovLg"></i>Alert area (selected) <i class="wn-lg oth"></i>Other alerts <i class="wn-lg dot"></i>Member facilities by state <i class="wn-lg ctx"></i>Other facilities <span>The area is approximate: about ${FOOT_M} m around each member facility, the polygon sent in the CAP alert. It is not a modeled flood or plume boundary. Scroll to zoom, drag to pan, hover for details.</span></p>`;
    mapInput($('wnMap'));
  }
  function cityBox() {
    const geo = L.geo, P = S.projector(geo);
    const [x0, y1] = P([geo.extent[0], geo.extent[1]]), [x1, y0] = P([geo.extent[2], geo.extent[3]]);
    return [x0, y0, x1 - x0, y1 - y0];
  }
  function fit(a) {
    if (zoom === 'city' || !a) return cityBox();
    const ring = a.ring.map(S.projector(L.geo)), xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
    const svg = $('wnMap'), r = svg && svg.getBoundingClientRect(), ar = r && r.width > 0 ? r.height / r.width : 0.78; // fill the map's own shape
    let w = Math.max(5000, (Math.max(...xs) - Math.min(...xs)) * 1.3), h = Math.max(w * ar, (Math.max(...ys) - Math.min(...ys)) * 1.3);
    w = Math.max(w, h / ar);
    return [cx - w / 2, cy - h / 2, w, h];
  }
  // Ease the map's extent to a box.
  function goTo(box, dur) {
    cancelAnimationFrame(viewAnim);
    const svg = $('wnMap'); if (!svg) return;
    const from = view || box, t0 = performance.now(), set = (b) => { view = b; svg.setAttribute('viewBox', b.map((v) => v.toFixed(1)).join(' ')); };
    const same = from.every((v, i) => Math.abs(v - box[i]) < 1);
    if (!dur || same) { set(box); return; }
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      set(from.map((v, i) => v + (box[i] - v) * e));
      if (p < 1) viewAnim = requestAnimationFrame(step); else { set(box); if (Math.abs(from[2] - box[2]) > 1) drawCoverage(); }
    };
    viewAnim = requestAnimationFrame(step);
  }
  function zoomBy(f, cx, cy) {
    const b = view; if (!b) return;
    const city = cityBox(), w = Math.max(1200, Math.min(city[2] * 1.6, b[2] * f)), h = w * (b[3] / b[2]);
    cx = cx == null ? b[0] + b[2] / 2 : cx; cy = cy == null ? b[1] + b[3] / 2 : cy;
    const nb = [cx - (cx - b[0]) * (w / b[2]), cy - (cy - b[1]) * (h / b[3]), w, h];
    zoom = 'free'; view = nb;
    $('wnMap').setAttribute('viewBox', nb.map((v) => v.toFixed(1)).join(' '));
    clearTimeout(zoomBy.t); zoomBy.t = setTimeout(drawCoverage, 160); // labels and dot sizes follow the new scale
    for (const x of $('wnCov').querySelectorAll('[data-zoom]')) x.setAttribute('aria-pressed', 'false');
  }
  function mapInput(svg) {
    const toMap = (ev) => { const r = svg.getBoundingClientRect(), b = view, s = Math.max(b[2] / r.width, b[3] / r.height); return [b[0] + b[2] / 2 + (ev.clientX - r.left - r.width / 2) * s, b[1] + b[3] / 2 + (ev.clientY - r.top - r.height / 2) * s, s]; };
    svg.addEventListener('wheel', (ev) => { ev.preventDefault(); const [x, y] = toMap(ev); zoomBy(ev.deltaY > 0 ? 1.18 : 1 / 1.18, x, y); }, { passive: false });
    let drag = null;
    svg.addEventListener('pointerdown', (ev) => { if (ev.button !== 0) return; drag = { x: ev.clientX, y: ev.clientY, b: view.slice(), moved: false, s: toMap(ev)[2] }; });
    svg.addEventListener('pointermove', (ev) => {
      if (drag) {
        const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) > 4) { drag.moved = true; svg.setPointerCapture(ev.pointerId); svg.classList.add('panning'); hideTip(); }
        if (drag.moved) { zoom = 'free'; view = [drag.b[0] - dx * drag.s, drag.b[1] - dy * drag.s, drag.b[2], drag.b[3]]; svg.setAttribute('viewBox', view.map((v) => v.toFixed(1)).join(' ')); }
        return;
      }
      tip(ev);
    });
    const end = () => { if (drag && drag.moved) { svg.classList.remove('panning'); for (const x of $('wnCov').querySelectorAll('[data-zoom]')) x.setAttribute('aria-pressed', 'false'); drawCoverage(); svg.addEventListener('click', (e) => e.stopPropagation(), { capture: true, once: true }); } drag = null; };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
    svg.addEventListener('pointerleave', () => { if (!drag) hideTip(); });
  }
  // Hover details: a facility's modeled risk and state, or an alert area's grading.
  function tip(ev) {
    const el = ev.target.closest && ev.target.closest('[data-fac],[data-alert],[data-area]'), box = $('wnTip');
    if (!el || !box) { hideTip(); return; }
    const R = L.e.now.subarray(L.k * L.e.N, (L.k + 1) * L.e.N);
    let html;
    if (el.dataset.fac != null) {
      const i = +el.dataset.fac, f = L.e.F[i], st = stateOf(R[i]), alert = M.alerts.find((x) => x.c.members.includes(i));
      html = `<b>${esc(f.name)}</b><span>${esc(f.subtype || C.TYPES[f.type].label)} · ${esc(f.district || '')}</span><span class="r-${st.key} wn-tip-st">${st.label} · modeled risk ${Math.round(R[i] * 100)}%</span>${alert ? `<span>in ${esc(alert.c.id)}</span>` : '<span class="faint">in no alert</span>'}`;
    } else {
      const x = M.alerts.find((q) => q.c.id === (el.dataset.alert || el.dataset.area));
      if (!x) { hideTip(); return; }
      html = `<b>${esc(x.c.id)} · ${esc(x.c.type)}</b><span class="${SEV_CLS[x.g.severity]} wn-tip-st">${x.g.severity} · ${x.g.urgency} · ${x.g.certainty}</span><span>${x.c.members.length} facilities · ${x.c.nCrit} critical · ${people(x.c.people)} residents (modeled)</span>${el.dataset.alert ? '<span class="faint">click to select</span>' : ''}`;
    }
    const wrap = box.parentElement.getBoundingClientRect();
    box.innerHTML = html; box.hidden = false;
    const x = ev.clientX - wrap.left + 14, y = ev.clientY - wrap.top + 14;
    box.style.left = `${Math.min(x, wrap.width - box.offsetWidth - 6)}px`;
    box.style.top = `${Math.min(y, wrap.height - box.offsetHeight - 6)}px`;
  }
  function hideTip() { const b = $('wnTip'); if (b) b.hidden = true; }
  // Pointing at an alert in the queue, or a facility in the inspector, lights it on the map.
  function spot(el, on) {
    const L2 = $('wnMapL'); if (!L2) return;
    for (const x of L2.querySelectorAll('.spot')) x.classList.remove('spot');
    if (!on || !el) return;
    const sel = el.dataset.fac != null ? `[data-fac="${el.dataset.fac}"]` : `[data-alert="${el.dataset.alert}"],[data-area="${el.dataset.alert}"]`;
    for (const x of L2.querySelectorAll(sel)) x.classList.add('spot');
  }

  // ── Selected alert ─────────────────────────────────────────────────────
  const URG_HELP = { Immediate: 'act now: the next facility is forecast critical within 6 h, or it already is', Expected: 'act soon: within 24 h, or already observed', Future: 'more than 24 h away' };
  const CERT_HELP = { Observed: 'facilities have already crossed HIGH RISK', Likely: 'the forecast gives the next crossing 60% or more', Possible: 'the forecast gives it less than 60%' };
  function drawInspector() {
    const a = selected();
    if (!a) { $('wnInsp').innerHTML = `<div class="bd-h"><h2 id="wnIh">Selected alert</h2><span class="ni-tag pruned">exercise</span></div><p class="ni-empty">Nothing to inspect at ${fmtT(L.t)}.</p>`; return; }
    const c = a.c, F = L.e.F, R = L.e.now.subarray(L.k * L.e.N, (L.k + 1) * L.e.N);
    const top = c.members.slice().sort((x, y) => R[y] - R[x]).slice(0, 3);
    const advice = T.comms.TXT[lang][c.family][1].replace('{ems}', M.cfg.ems);
    $('wnInsp').innerHTML = `
      <div class="bd-h"><h2 id="wnIh">Selected alert</h2><span class="ni-tag pruned">exercise</span></div>
      <div class="wn-ibody">
      <h3 class="wn-ih"><span class="num">${esc(c.id)}</span> ${esc(c.type)} <span class="wn-sev ${SEV_CLS[a.g.severity]}">${a.g.severity}</span></h3>
      <p class="wn-iarea">${esc(V.places(c.districts, 4))}, ${esc(L.geo.city)}</p>
      <dl class="wn-dl">
        <div><dt>Urgency</dt><dd>${a.g.urgency}<span>${URG_HELP[a.g.urgency]}</span></dd></div>
        <div><dt>Certainty</dt><dd>${a.g.certainty}<span>${CERT_HELP[a.g.certainty]}</span></dd></div>
        <div><dt>Onset</dt><dd>${a.inEffect ? 'In effect now' : `~${fmtT(a.onsetT)}`}<span>${a.inEffect ? 'observed' : 'forecast'} · ${esc(stamp(a.onsetT))}</span></dd></div>
        <div><dt>Expires</dt><dd>${fmtT(a.expiresT)}<span>${esc(stamp(a.expiresT))} · set by the generator: issue + 12 h</span></dd></div>
        <div><dt>Residents in area</dt><dd>${people(c.people)}<span>modeled population</span></dd></div>
        <div><dt>Next CRITICAL</dt><dd>${c.nextCrit ? esc(F[c.nextCrit.i].name) : 'none forecast'}<span>${c.nextCrit ? `~${fmtT(c.nextCrit.t)} · ${Math.round(c.nextCrit.prob * 100)}% of ensemble` : ''}</span></dd></div>
      </dl>
      <h4>Risk so far <span class="faint">peak modeled risk among the alert's facilities, T+0 → ${fmtT(L.t)}</span></h4>
      ${trend(c)}
      <h4>Most stressed facilities <span class="faint">${c.members.length} in the alert · point to find on the map</span></h4>
      <ul class="wn-facs">${top.map((i) => `<li data-fac="${i}"><span class="dot r-${stateOf(R[i]).key}"></span>${esc(F[i].name)}<span class="wn-facbar"><i class="r-${stateOf(R[i]).key}" style="width:${Math.round(R[i] * 100)}%"></i></span><span>${stateOf(R[i]).label}</span></li>`).join('')}</ul>
      <h4>Public guidance <span class="faint">${esc(T.comms.LANG_NAME[lang])}</span></h4>
      <p class="wn-guid" lang="${lang}">${esc(advice)}</p>
      <h4>Message readiness</h4>
      <ul class="wn-ready">${M.cfg.langs.map((l) => { const s = a.sms[l]; const ok = segOk(s); return `<li><button type="button" data-lang="${l}" aria-pressed="${l === lang}">${esc(T.comms.LANG_NAME[l])}</button><span class="${ok ? 'ok' : 'warn'}">${ok ? '✓ one message' : `! ${s.segments} messages`} · ${s.encoding} · ${s.chars} chars · ${s.segments} segment${s.segments > 1 ? 's' : ''}</span></li>`; }).join('')}</ul>
      <p class="wn-links"><a href="${esc(V.crisisHref(c.id))}">Crisis detail</a> · <a href="${esc(S.href('/crises', { c: c.id }))}">Crises board</a> · <a href="${esc(S.href('/twin', { c: c.id, a: null }))}">City twin</a></p></div>`;
  }

  // The twin's analysis for the alert's current members at every issued step up to now,
  // against the HIGH RISK and CRITICAL thresholds. Only the past: no forecast is drawn.
  function trend(c) {
    const e = L.e, N = e.N, W = 300, H = 64, pad = 4;
    const ys = []; for (let k = 0; k <= L.k; k++) { let m = 0; for (const i of c.members) m = Math.max(m, e.now[k * N + i]); ys.push(m); }
    const x = (k) => pad + (k / Math.max(1, L.k)) * (W - 2 * pad), y = (r) => H - pad - r * (H - 2 * pad);
    const line = ys.map((r, k) => `${k ? 'L' : 'M'}${x(k).toFixed(1)},${y(r).toFixed(1)}`).join('');
    const last = ys[ys.length - 1];
    return `<svg class="wn-trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="Peak risk ${Math.round(last * 100)}% at ${fmtT(L.t)}">
      <line x1="${pad}" x2="${W - pad}" y1="${y(0.75)}" y2="${y(0.75)}" class="wn-thr r-critical"/><line x1="${pad}" x2="${W - pad}" y1="${y(0.55)}" y2="${y(0.55)}" class="wn-thr r-high"/>
      <text x="${pad + 2}" y="${y(0.75) - 3}" class="wn-thr-t">critical 75%</text><text x="${pad + 2}" y="${y(0.55) + 10}" class="wn-thr-t">high risk 55%</text>
      <path d="${line}L${x(ys.length - 1).toFixed(1)},${H - pad}L${x(0)},${H - pad}Z" class="wn-trend-a"/><path d="${line}" class="wn-trend-l"/>
      <circle cx="${x(ys.length - 1).toFixed(1)}" cy="${y(last).toFixed(1)}" r="3.5" class="wn-trend-d r-${stateOf(last).key}"/></svg>`;
  }

  // ── Message studio ─────────────────────────────────────────────────────
  function drawStudio() {
    const a = selected(), cfg = M.cfg;
    const tabs = [['sms', 'Cell broadcast / SMS'], ['cap', 'CAP 1.2 payload'], ['sitrep', 'Situation report']];
    const head = `<div class="bd-h"><h2 id="wnSh">Public message studio</h2>
      <div class="wn-tabs" role="tablist" aria-label="Product">${tabs.map(([k, t]) => `<button type="button" role="tab" data-channel="${k}" aria-selected="${channel === k}">${t}</button>`).join('')}</div></div>`;
    let body = '';
    if (channel === 'sms') {
      if (!a) body = '<p class="ni-empty">No public alert to prepare at this time.</p>';
      else {
        const s = a.sms[lang], dk = `${a.c.id}|${L.k}|${lang}`, draft = drafts.get(dk);
        const ds = draft != null ? T.comms.segments(draft) : null;
        const edited = draft != null && draft !== s.text;
        body = `
          <div class="wn-sbar">
            <div class="wn-lpicks" role="tablist" aria-label="Language" style="--n:${cfg.langs.length}">${cfg.langs.map((l) => { const x = a.sms[l]; return `<button type="button" role="tab" class="wn-lpick" data-lang="${l}" aria-selected="${l === lang}"><b lang="${l}">${esc(T.comms.LANG_NAME[l])}</b><span class="wn-seg${x.segments > 1 ? ' tight' : ''}">${x.encoding} · ${x.chars} chars · ${x.segments} segment${x.segments > 1 ? 's' : ''}</span></button>`; }).join('')}</div>
            <div class="seg wn-pv" role="group" aria-label="Preview style"><button type="button" data-pview="banner" aria-pressed="${pview === 'banner'}">Notification</button><button type="button" data-pview="full" aria-pressed="${pview === 'full'}">Full-screen alert</button></div>
          </div>
          <div class="wn-sms-grid">
            <div class="wn-phonecol">${phone(a, lang)}</div>
            <div class="wn-edit">
              <div class="wn-ed-h"><h4>Generated message <span class="faint">canonical · ${esc(T.comms.LANG_NAME[lang])}</span></h4><span class="wn-src canon">Used in the CAP</span></div>
              <pre class="wn-canon" id="wnCanon" lang="${lang}">${esc(s.text)}</pre>
              <p class="wn-val ${segOk(s) ? 'ok' : 'warn'}">${s.encoding} · ${s.chars} characters · ${s.segments} SMS segment${s.segments > 1 ? 's' : ''}${segOk(s) ? ' · fits one message' : ` · over one ${s.encoding === 'GSM-7' ? 'GSM-7 (160)' : 'UCS-2 (70)'} message`}</p>
              <div class="wn-ed-h"><h4>Local draft <span class="faint">not approved · does not change the CAP</span></h4><span class="wn-src${edited ? ' edit' : ''}" id="wnSrc">${edited ? 'Edited locally' : 'Same as generated'}</span></div>
              <textarea id="wnDraft" rows="3" lang="${lang}" aria-label="Edit a local draft of the message">${esc(draft != null ? draft : s.text)}</textarea>
              <p class="wn-val ${ds ? (segOk(ds) ? 'ok' : 'warn') : ''}" id="wnDraftVal">${ds ? `${draft === s.text ? 'Same as generated' : 'Edited'} · ${ds.encoding} · ${ds.chars} characters · ${ds.segments} segment${ds.segments > 1 ? 's' : ''}` : 'Unchanged from the generated message'}</p>
            </div>
          </div>
          <div class="wn-actbar">
            <span class="wn-actl">Message</span>
            <button type="button" class="btn primary" data-copy="wnCanon">Copy message</button>
            <button type="button" class="btn" data-copy="wnDraft">Copy draft</button>
            <button type="button" class="btn" data-reset-draft ${draft != null ? '' : 'disabled'}>Reset draft</button>
            <button type="button" class="btn" data-pview="${pview === 'full' ? 'banner' : 'full'}">${pview === 'full' ? 'Back to notification' : 'Preview alert'}</button>
            <span class="wn-actsep" aria-hidden="true"></span>
            <span class="wn-actl">Products</span>
            <button type="button" class="btn" data-channel="cap">Inspect CAP 1.2</button>
            <button type="button" class="btn" data-copy="wnSitrep" ${sitrepText ? '' : 'disabled'}>Copy SITREP</button>
          </div>`;
      }
    } else if (channel === 'cap') {
      if (!a) body = '<p class="ni-empty">No CAP alert without a crisis.</p>';
      else {
        const xml = T.comms.cap(null, L.e, a.c, L.k, { cascadeR: M.cr.r });
        const blocks = (xml.match(/<info>/g) || []).length, pts = (xml.match(/<polygon>([^<]*)<\/polygon>/) || ['', ''])[1].trim().split(/\s+/).length;
        body = `<div class="wn-capbar"><span>status <b>Exercise</b> · msgType Alert · ${blocks} info block${blocks > 1 ? 's' : ''} (${cfg.langs.map((l) => cfg.locale[l]).join(', ')}) · polygon ${pts} points · ${(xml.length / 1024).toFixed(1)} KB</span>
            <span class="wn-actions"><button type="button" class="btn" data-copy="wnCap">Copy CAP</button><button type="button" class="btn" data-download="cap">Download .xml</button></span></div>
          <div class="wn-cap"><pre class="wn-pre" id="wnCap">${esc(xml)}</pre></div>`;
      }
    } else {
      body = `<div class="wn-capbar"><span>Plain text for responders · all crises at ${fmtT(L.t)} · includes the planner's recommendation</span>
          <span class="wn-actions"><button type="button" class="btn" data-copy="wnSitrep" ${sitrepText ? '' : 'disabled'}>Copy report</button><button type="button" class="btn" data-download="sitrep" ${sitrepText ? '' : 'disabled'}>Download .txt</button></span></div>
        <pre class="wn-pre" id="wnSitrep">${sitrepText ? esc(sitrepText) : 'Building: the report waits for the planner\'s recommendation…'}</pre>`;
    }
    // The CAP and SITREP stay in the document (hidden) so every product of the selection exists.
    const hiddenCap = channel !== 'cap' && a ? `<div class="wn-cap" hidden><pre class="wn-pre">${esc(T.comms.cap(null, L.e, a.c, L.k, { cascadeR: M.cr.r }))}</pre></div>` : '';
    const hiddenSit = channel !== 'sitrep' ? `<pre id="wnSitrep" hidden>${sitrepText ? esc(sitrepText) : ''}</pre>` : '';
    $('wnStudio').innerHTML = head + body + hiddenCap + hiddenSit + '<p class="wn-status" id="wnStatus" role="status" aria-live="polite"></p>';
  }
  const segOk = (s) => s.segments === 1;
  // One realistic handset preview of the selected language: a lock-screen notification,
  // or the full-screen presentation phones use for emergency alerts.
  function phone(a, l) {
    const s = a.sms[l], ck = C.clockAt(L.e.t0, L.t);
    const body = `<p class="wn-sms" lang="${l}">${esc(s.text)}</p>`;
    return `<figure class="wn-phone ${pview}" aria-label="${esc(T.comms.LANG_NAME[l])} preview">
      <div class="wn-screen">
        <div class="wn-phone-top"><span>${ck.time}</span><span class="wn-notch" aria-hidden="true"></span><span>${esc(L.geo.city)}</span></div>
        ${pview === 'full' ? `<div class="wn-full"><span class="wn-full-i" aria-hidden="true">⚠</span><b>Emergency alert</b><span class="wn-full-x">EXERCISE · ${esc(a.g.severity)}</span>${body}<span class="wn-full-ok">OK</span></div>`
        : `<div class="wn-lock"><b>${ck.time}</b><span>${esc(ck.day)}</span></div>
        <div class="wn-bubble"><span class="wn-bh">⚠ Emergency alert · EXERCISE</span>${body}</div>`}
      </div>
      <figcaption class="wn-seg${s.segments > 1 ? ' tight' : ''}">${s.encoding} · ${s.chars} chars · ${s.segments} segment${s.segments > 1 ? 's' : ''}</figcaption></figure>`;
  }

  // ── Local exercise workflow ────────────────────────────────────────────
  function drawFlow() {
    const a = selected();
    if (!a) { $('wnFlow').innerHTML = `<div class="bd-h"><h2 id="wnFh">Alert workflow</h2></div><p class="ni-empty">No alert selected.</p>`; return; }
    const w = wfOf(a);
    const steps = [
      ['Generated', true, `Built from the twin at ${fmtT(L.t)}`],
      ['Reviewed', w.reviewed, 'Content and area checked by the operator'],
      ['Exercise-ready', w.ready, 'All languages and the CAP prepared'],
      ['Simulated issue', w.simulated, w.simulated ? `Recorded locally at scenario time ${fmtT(L.t)}; nothing was sent` : 'A local exercise step; nothing is sent'],
    ];
    const next = !w.reviewed ? ['reviewed', 'Mark reviewed'] : !w.ready ? ['ready', 'Mark exercise-ready'] : !w.simulated ? ['simulated', 'Simulate issue (exercise)'] : null;
    $('wnFlow').innerHTML = `
      <div class="bd-h"><h2 id="wnFh">Alert workflow</h2><span class="ni-tag pruned">local exercise</span></div>
      <ol class="wn-steps">${steps.map(([t, done, d], n) => { const cur = !done && steps.findIndex((x) => !x[1]) === n; return `<li class="${done ? 'done' : cur ? 'cur' : ''}"${cur ? ' aria-current="step"' : ''}><span class="wn-stepdot" aria-hidden="true">${done ? '✓' : n + 1}</span><div><b>${t}${cur ? ' · next' : ''}</b><span>${d}</span></div><span class="sr-only">${done ? 'done' : cur ? 'next step' : 'not done'}</span></li>`; }).join('')}</ol>
      <div class="wn-actions">${next ? `<button type="button" class="btn primary" data-wf="${next[0]}">${next[1]}</button>` : ''}${w.reviewed ? '<button type="button" class="btn" data-wf="reset">Reset workflow</button>' : ''}</div>
      <p class="bd-note">Kept in this browser tab only. No approval identity, transmission or delivery is recorded, and the EXERCISE marking stays on every product.</p>`;
  }

  // ── Input ──────────────────────────────────────────────────────────────
  function wire() {
    const page = $('page');
    page.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-pview],[data-alert],[data-sev],[data-urg],[data-zoom],[data-lang],[data-channel],[data-copy],[data-download],[data-wf],[data-reset-draft],[data-play],[data-speed],[data-tnow],[data-mapzoom]');
      if (!b) return;
      const d = b.dataset;
      if (d.play != null) { play(); return; }
      if (d.speed) { speed = +d.speed; for (const x of page.querySelectorAll('[data-speed]')) x.setAttribute('aria-pressed', String(+x.dataset.speed === speed)); return; }
      if (d.tnow != null) { stopPlay(); setK(kMax, { commit: true }); drawTimeHead(); return; }
      if (d.mapzoom) { zoomBy(d.mapzoom === 'in' ? 1 / 1.5 : 1.5); return; }
      if (d.alert) { select(d.alert); return; }
      if (d.sev) { fSev = d.sev; drawQueue(); return; }
      if (d.urg) { fUrg = d.urg; drawQueue(); return; }
      if (d.zoom) { zoom = d.zoom; drawCoverage(); return; }
      if (d.lang) { lang = d.lang; drawInspector(); drawStudio(); return; }
      if (d.channel) { channel = d.channel; drawStudio(); return; }
      if (d.pview) { pview = d.pview; drawStudio(); return; }
      if (d.copy) { copy(d.copy, b); return; }
      if (d.download) { download(d.download); return; }
      if (d.resetDraft != null) { const a = selected(); if (a) drafts.delete(`${a.c.id}|${L.k}|${lang}`); drawStudio(); return; }
      if (d.wf) {
        const a = selected(); if (!a) return;
        const w = { ...wfOf(a) };
        if (d.wf === 'reset') workflow.delete(wfKey(a)); else { w[d.wf] = true; workflow.set(wfKey(a), w); }
        drawFlow(); drawQueue();
      }
    });
    // The issue-time strip: click or drag to move, arrows step half an hour (Shift: 3 h).
    let scrub = false;
    page.addEventListener('pointerdown', (ev) => {
      const svg = ev.target.closest && ev.target.closest('#wnTLsvg');
      if (!svg || ev.button !== 0) return;
      scrub = true; stopPlay(); svg.setPointerCapture(ev.pointerId); svg.focus();
      setK(kAt(ev), { commit: false }); drawTimeHead();
    });
    page.addEventListener('pointermove', (ev) => {
      const svg = ev.target.closest && ev.target.closest('#wnTLsvg');
      if (scrub) { setK(kAt(ev), { commit: false }); return; }
      const hov = $('wnTLhov'); if (!hov) return;
      if (!svg) { if (hoverK != null) { hov.setAttribute('visibility', 'hidden'); hoverK = null; $('wnTLh').textContent = $('wnTLh').dataset.def; } return; }
      const k = kAt(ev);
      if (k < 0 || k >= L.e.K) return;
      hoverK = k; hov.setAttribute('x1', tx(k)); hov.setAttribute('x2', tx(k)); hov.setAttribute('visibility', 'visible');
      const n = hist[k];
      $('wnTLh').textContent = k > kMax ? `${fmtT(k * L.e.DT)}: after the simulated now, not issued yet` : n ? `${fmtT(k * L.e.DT)}: ${n.Extreme + n.Severe + n.Moderate} alerts (${n.Extreme} Extreme · ${n.Severe} Severe · ${n.Moderate} Moderate)` : fmtT(k * L.e.DT);
    });
    const endScrub = () => { if (scrub) { scrub = false; commitT(); drawTimeHead(); } };
    page.addEventListener('pointerup', endScrub);
    page.addEventListener('pointercancel', endScrub);
    page.addEventListener('keydown', (ev) => {
      if (ev.target.id === 'wnTLsvg') {
        const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[ev.key];
        if (step) { ev.preventDefault(); stopPlay(); setK(L.k + step * (ev.shiftKey ? BACK : 1)); drawTimeHead(); return; }
        if (ev.key === 'Home' || ev.key === 'End') { ev.preventDefault(); stopPlay(); setK(ev.key === 'Home' ? 0 : kMax); drawTimeHead(); return; }
        if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); play(); return; }
      }
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      const el = ev.target.closest && ev.target.closest('[data-alert][role=button],[data-lang][role=button]');
      if (el && el.tagName !== 'BUTTON') { ev.preventDefault(); el.click(); }
    });
    page.addEventListener('pointerover', (ev) => {
      const el = ev.target.closest && ev.target.closest('.wn-qi[data-alert],.wn-win g[data-alert],.wn-facs [data-fac]');
      spot(el, !!el);
    });
    page.addEventListener('input', (ev) => {
      if (ev.target.id === 'wnSearch') { query = ev.target.value; drawQueue(); const s = $('wnSearch'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
      if (ev.target.id === 'wnDraft') {
        const a = selected(); if (!a) return;
        const txt = ev.target.value, s = a.sms[lang];
        drafts.set(`${a.c.id}|${L.k}|${lang}`, txt);
        const ds = T.comms.segments(txt), val = $('wnDraftVal');
        val.className = `wn-val ${segOk(ds) ? 'ok' : 'warn'}`;
        val.textContent = `${txt === s.text ? 'Same as generated' : 'Edited'} · ${ds.encoding} · ${ds.chars} characters · ${ds.segments} segment${ds.segments > 1 ? 's' : ''}`;
        const r = page.querySelector('[data-reset-draft]'); if (r) r.disabled = false;
        const src = $('wnSrc'); if (src) { src.textContent = txt === s.text ? 'Same as generated' : 'Edited locally'; src.classList.toggle('edit', txt !== s.text); }
      }
    });
  }
  // Copy, with a visible fallback when the clipboard is refused: the text is selected.
  function copy(id, btn) {
    const el = $(id);
    if (!el) return;
    const text = el.value != null && el.tagName === 'TEXTAREA' ? el.value : el.textContent;
    const say = (msg) => { const st = $('wnStatus'); if (st) st.textContent = msg; const t = btn.textContent; btn.textContent = msg.split('.')[0]; setTimeout(() => (btn.textContent = t), 1600); };
    const fallback = () => { selectText(el); say('Clipboard not available here. The text is selected: press Ctrl+C to copy.'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => say('Copied. Exercise content only.'), fallback);
    else fallback();
  }
  function selectText(el) {
    if (el.tagName === 'TEXTAREA') { el.focus(); el.select(); return; }
    const r = document.createRange(); r.selectNodeContents(el);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  }
  function download(kind) {
    const a = selected();
    const text = kind === 'cap' ? (a ? T.comms.cap(null, L.e, a.c, L.k, { cascadeR: M.cr.r }) : null) : sitrepText;
    if (!text) return;
    const name = kind === 'cap' ? `EXERCISE-CAP-${a.c.id}-T${L.t.toFixed(1)}.xml` : `EXERCISE-SITREP-${L.geo.id}-T${L.t.toFixed(1)}.txt`;
    const url = URL.createObjectURL(new Blob([text], { type: kind === 'cap' ? 'application/cap+xml' : 'text/plain;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    const st = $('wnStatus'); if (st) st.textContent = `Saved ${name}.`;
  }

  T.router.register('/warnings', {
    title: 'Warnings',
    mount(ctx) { S.show(); render(ctx); },
    unmount() { token++; stopPlay(); cancelAnimationFrame(viewAnim); },
    update(ctx, changed) { if (!(changed.length === 1 && changed[0] === 'c' && ctx.c === selId)) render(ctx); },
  });
})(typeof window !== 'undefined' ? window : globalThis);
