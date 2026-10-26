/* Response at #/plan: an independent decision workspace. No map, no renderer, no
   dependency on the 3D twin — every figure comes from the planner and the engine at the
   shared issue time.

   The question this page answers is not "how bad is it" but "with the crews I have, what
   do I do, what does it cost me elsewhere, and by when must I start". So the page is
   built around four calculations, all from src/js/engine/interventions.js:

     evaluate(k, ids)    the counterfactual: the plan re-simulated from the decision step
                         on the ensemble members that best match the evidence so far.
     trajectory(k, ids)  the same two futures over time, so the comparison is the engine's
                         own output rather than a drawn curve.
     deadline(k, ids)    the plan re-run with the crews starting later, deciding on the
                         same information. This is what turns "act soon" into a time.
     recommend(k, b)     a greedy plan within the crew budget.

   Nothing on this page is money, vehicles, travel time, crew locations or residents
   protected: the model does not compute them, so the page does not show them. */
(function (root) {
  const T = root.TWIN;
  const C = T.core, S = T.site, A = T.analytics, V = T.crisisView;
  const { stateOf, fmtT } = C;
  const { esc } = S;
  const $ = (id) => document.getElementById(id);
  const pct = (p) => Math.round(p * 100) + '%';
  const sign = (x) => (x >= 0 ? '−' : '+') + Math.abs(Math.round(x * 100)) + '%';
  const BUDGETS = [3, 5, 7, 10];
  const SYS_SHORT = { drainage: 'Drainage', traffic: 'Roads', power: 'Power', telecom: 'Telecom', ems: 'EMS', hospital: 'Hospitals' };

  let token = 0, job = 0, L = null, P = null, M = null;
  // Session state. Plans are compared within this visit only; nothing is persisted.
  const st = {
    chosen: new Set(), budget: 5, filter: 'all', query: '', sort: 'gain', selFac: null, delay: 0,
    singles: new Map(), res: null, traj: null, dl: null, pending: {}, compare: [], key: '',
  };

  // ── Model ──────────────────────────────────────────────────────────────
  // Each action's target facilities and the system it acts on are derived from the mods
  // the planner itself applies; nothing here is a second catalogue.
  function meta(e, k) {
    return P.CATALOG.map((a) => {
      const mods = a.mods(e, k);
      const facs = new Set(), sysCount = {};
      for (const m of mods) {
        if (m.kind === 'fac' && e.F[m.i]) { facs.add(m.i); bump(sysCount, A.group(e.kinds[m.i])); }
        if (m.kind === 'edge' && m.e >= 0) { const ed = e.E[m.e]; facs.add(ed.to); bump(sysCount, A.group(e.kinds[ed.to])); }
      }
      const sys = Object.entries(sysCount).sort((x, y) => y[1] - x[1])[0];
      return { ...a, targets: [...facs], sys: sys ? sys[0] : null, nMods: mods.length };
    });
  }
  const bump = (o, k2) => { o[k2] = (o[k2] || 0) + 1; };

  function model(L) {
    const e = L.e, k = L.k;
    P = T.services.planner(e);
    const cat = meta(e, k);
    const reg = L.an.crises(k);
    const crisis = T.store.ctx.c ? reg.list.find((c) => c.id === T.store.ctx.c) : null;
    return { e, k, cat, reg, crisis, systems: [...new Set(cat.map((a) => a.sys).filter(Boolean))] };
  }

  // ── Compute pipeline ───────────────────────────────────────────────────
  // evaluate is fast enough to run inline; the trajectory and the deadline are not, so
  // they are deferred and the panels say so while they run.
  async function compute() {
    const my = ++job, alive = () => my === job && token === myToken;
    const myToken = token;
    const ids = [...st.chosen];
    st.traj = null; st.dl = null;
    if (!ids.length) { st.res = null; st.pending = {}; drawAll(); return; }
    st.pending = { res: true, traj: true, dl: true };
    drawAll();
    await S.nextFrame();
    if (!alive()) return;
    st.res = P.evaluate(M.k, ids);
    st.pending.res = false;
    drawAll();
    await S.nextFrame();
    if (!alive()) return;
    st.traj = P.trajectory(M.k, ids);
    st.pending.traj = false;
    drawCounterfactual(); drawTimeline(); drawFacilities();
    await S.nextFrame();
    if (!alive()) return;
    st.dl = P.deadline(M.k, ids);
    st.pending.dl = false;
    drawDeadline();
    T.nav.render('/plan', L);
  }
  // What each action is worth on its own, filled in one per frame so the table is usable
  // immediately and the numbers arrive as they are computed.
  async function computeSingles() {
    const my = token;
    for (const a of M.cat) {
      if (st.singles.has(a.id)) continue;
      await S.nextFrame();
      if (my !== token) return;
      st.singles.set(a.id, P.evaluate(M.k, [a.id], 24));
      drawBuilder();
    }
  }

  // ── Page ───────────────────────────────────────────────────────────────
  async function render(ctx) {
    const my = ++token, alive = () => my === token;
    S.header('/plan');
    try { L = await S.load(ctx, S.busy); } catch (err) { S.fail(err); return; }
    if (!alive()) return;
    S.settle(L); S.header('/plan', L);
    M = model(L);
    // A change of city, scenario or issue time invalidates every calculation.
    const key = `${L.geo.id}|${L.scen.id}|${L.k}`;
    if (st.key !== key) {
      st.key = key; st.singles = new Map(); st.chosen = new Set();
      st.res = null; st.traj = null; st.dl = null; st.compare = []; st.selFac = null; st.delay = 0;
    }
    const replayEnd = L.mode === 'historical' && L.k >= L.e.K - 2;
    $('page').innerHTML = shell(replayEnd);
    wire();
    if (replayEnd) return;
    drawAll();
    computeSingles();
    // Open on the planner's own recommendation so the page states something immediately.
    if (!st.chosen.size) {
      const plan = await T.services.recommended(L.e, L.k, st.budget);
      if (!alive() || st.chosen.size) return;
      for (const id of plan.ids) st.chosen.add(id);
      drawBuilder();
      compute();
    } else compute();
  }

  function shell(replayEnd) {
    const c = M.crisis;
    return `
      <div class="pg-wrap rp-wrap">
        <header class="pg-head rp-head">
          <div class="rp-head-main">
            <h1>Response</h1>
            <p class="pg-lede">Build a plan against the crews you have, compare it with doing nothing, and see by when it has to start. Every figure is the planner re-simulating this scenario from ${fmtT(L.t)} on the ensemble members that best match the evidence so far.</p>
            <p class="pg-asof">${c ? `Active crisis <a href="${esc(V.crisisHref(c.id))}" class="num">${esc(c.id)}</a> · ${esc(c.type)} · ${esc(V.places(c.districts, 3))} · ` : ''}Deciding at ${V.at(L, L.t)} · ${esc(L.scen.label)} · ${esc(L.scen.provenance ? L.scen.provenance.label : 'Simulation')}</p>
          </div>
          <div class="rp-head-ctl">
            <label class="rp-budget"><span>Crews</span>
              <span class="seg" id="rpBudget">${BUDGETS.map((b) => `<button type="button" data-b="${b}" aria-pressed="${b === st.budget}">${b}</button>`).join('')}</span></label>
            <div class="rp-btns">
              <button class="btn primary-btn" id="rpRec">Recommend within budget</button>
              <button class="btn" id="rpClear">Clear plan</button>
              <button class="btn" id="rpSave">Save for comparison</button>
            </div>
          </div>
        </header>
        ${replayEnd ? '<p class="empty">The replay has reached the end of the window, so there is nothing left to plan for. Switch to Now to plan at the simulated now.</p>' : `
        <section class="rp-tiles" id="rpTiles" aria-label="Expected outcome"></section>
        <div class="rp-row rp-main">
          <section class="rp-card" id="rpBuild" aria-labelledby="rpBuildH"></section>
          <section class="rp-card" id="rpCf" aria-labelledby="rpCfH"></section>
        </div>
        <div class="rp-row rp-two">
          <section class="rp-card" id="rpDl" aria-labelledby="rpDlH"></section>
          <section class="rp-card" id="rpTl" aria-labelledby="rpTlH"></section>
        </div>
        <div class="rp-row rp-three">
          <section class="rp-card" id="rpFac" aria-labelledby="rpFacH"></section>
          <section class="rp-card" id="rpSys" aria-labelledby="rpSysH"></section>
          <section class="rp-card" id="rpCrew" aria-labelledby="rpCrewH"></section>
        </div>
        <section class="rp-card" id="rpCmp" aria-labelledby="rpCmpH"></section>
        <section class="pg-sec prov">
          <h2>What this page does not show</h2>
          <p>The model computes risk, not logistics. There are no costs, vehicle counts, crew locations, travel times or residents-protected figures here, because the planner does not calculate them and inventing them would make the plan look more certain than it is. A crew is an abstract unit of capacity; the catalogue's crew numbers are the only resource constraint the model carries.</p>
          <p>${esc(S.provenance(L))}</p>
        </section>`}
      </div>`;
  }

  // A chosen plan whose first evaluation has not landed yet: pending, not absent.
  const waiting = () => st.chosen.size > 0 && !st.res;
  const busyCard = (h, what) => `${h}<div class="loading-bar"><i></i></div><p class="rp-note">${what}</p>`;

  function drawAll() { drawTiles(); drawBuilder(); drawCounterfactual(); drawDeadline(); drawTimeline(); drawFacilities(); drawSystems(); drawCrew(); drawCompare(); }

  // ── Outcome tiles ──────────────────────────────────────────────────────
  function drawTiles() {
    const el = $('rpTiles');
    if (!el) return;
    const r = st.res, used = [...st.chosen].reduce((s, id) => s + (M.cat.find((a) => a.id === id) || { cost: 0 }).cost, 0);
    const pend = !r || st.pending.res;
    const tile = (k, v, was, d, note) => `<div class="rp-tile"><div class="k">${k}</div>
      <div class="v num${pend ? ' pend' : ''}">${pend ? '—' : v}</div>
      <div class="d ${pend || d == null ? '' : d > 0.005 ? 'good' : d < -0.005 ? 'bad' : ''}">${pend ? 'recalculating…' : was == null ? note || '' : `${d == null ? '' : sign(d) + ' · '}was ${was}`}</div></div>`;
    if (!st.chosen.size) {
      el.innerHTML = `<div class="rp-tile wide"><div class="k">No plan selected</div><div class="v">Doing nothing</div>
        <div class="d">Pick actions below, or let the planner recommend a set within ${st.budget} crews. The figures here are the baseline the plan is measured against.</div></div>`;
      return;
    }
    const over = used > st.budget;
    el.innerHTML = [
      // Every value is read behind `pend`, which is true whenever there is no result yet.
      tile('Critical facility-hours', pend ? '' : r.with.critHours.toFixed(0), pend ? null : r.base.critHours.toFixed(0), pend ? null : r.reduction),
      tile('Hospital & EMS critical hours', pend ? '' : r.with.careHours.toFixed(1), pend ? null : r.base.careHours.toFixed(1), pend ? null : r.careReduction),
      tile('P(a hospital goes critical)', pend ? '' : pct(r.with.hospCrit), pend ? null : pct(r.base.hospCrit), pend ? null : r.base.hospCrit ? 1 - r.with.hospCrit / r.base.hospCrit : null),
      tile('Facilities reaching CRITICAL', pend ? '' : r.with.nCrit.toFixed(1), pend ? null : r.base.nCrit.toFixed(1), pend ? null : r.base.nCrit ? 1 - r.with.nCrit / r.base.nCrit : null),
      `<div class="rp-tile${over ? ' over' : ''}"><div class="k">Crews committed</div><div class="v num">${used} <span class="faint">/ ${st.budget}</span></div>
        <div class="d ${over ? 'bad' : ''}">${over ? `over budget by ${used - st.budget}` : `${st.budget - used} spare`}</div></div>`,
    ].join('');
  }

  // ── Intervention builder ───────────────────────────────────────────────
  function drawBuilder() {
    const el = $('rpBuild');
    if (!el) return;
    const q = st.query.trim().toLowerCase();
    let list = M.cat.filter((a) => (st.filter === 'all' || a.sys === st.filter)
      && (!q || `${a.label} ${a.detail} ${a.targets.map((i) => M.e.F[i].name).join(' ')}`.toLowerCase().includes(q)));
    const gain = (a) => { const s = st.singles.get(a.id); return s ? s.reduction : -Infinity; };
    list = list.slice().sort((a, b) => (st.sort === 'gain' ? gain(b) - gain(a) : st.sort === 'cost' ? a.cost - b.cost : a.label.localeCompare(b.label)));
    const counts = { all: M.cat.length };
    for (const a of M.cat) if (a.sys) bump(counts, a.sys);
    el.innerHTML = `
      <div class="rp-h"><h2 id="rpBuildH">Intervention builder <span class="faint">(${M.cat.length})</span></h2>
        <label class="rp-sort"><span class="sr-only">Sort by</span>
          <select id="rpSort"><option value="gain"${st.sort === 'gain' ? ' selected' : ''}>Most effective alone</option><option value="cost"${st.sort === 'cost' ? ' selected' : ''}>Fewest crews</option><option value="name"${st.sort === 'name' ? ' selected' : ''}>Name</option></select></label></div>
      <div class="rp-filters" role="group" aria-label="Filter by system">
        ${['all', ...M.systems].map((s2) => `<button type="button" class="rp-chip${st.filter === s2 ? ' on' : ''}" data-filter="${s2}" aria-pressed="${st.filter === s2}">${s2 === 'all' ? 'All' : SYS_SHORT[s2] || s2} <span class="faint">${counts[s2] || 0}</span></button>`).join('')}
      </div>
      <label class="rp-search"><span aria-hidden="true">${T.icons.UI.search}</span>
        <input id="rpQ" type="search" value="${esc(st.query)}" placeholder="Search actions and targets" autocomplete="off" aria-label="Search the catalogue"></label>
      <div class="tbl-wrap rp-tbl-wrap"><table class="rp-tbl"><thead><tr>
        <th><span class="sr-only">In plan</span></th><th>Action</th><th>Target</th><th>Crews</th>
        <th title="Expected reduction in critical facility-hours if this action is taken on its own">Alone</th><th>Side effect</th></tr></thead><tbody>
        ${list.map((a) => {
          const s2 = st.singles.get(a.id), on = st.chosen.has(a.id);
          const tgt = a.targets.length ? M.e.F[a.targets[0]].name + (a.targets.length > 1 ? ` +${a.targets.length - 1}` : '') : '—';
          return `<tr class="${on ? 'on' : ''}" data-act="${esc(a.id)}">
            <td><input type="checkbox" ${on ? 'checked' : ''} data-act="${esc(a.id)}" aria-label="${esc(a.label)}"></td>
            <td><b>${esc(a.label)}</b><div class="faint">${esc(a.detail)}</div></td>
            <td>${esc(tgt)}<div class="faint">${a.sys ? SYS_SHORT[a.sys] || a.sys : ''}</div></td>
            <td class="num">${a.cost}</td>
            <td class="num ${s2 ? (s2.reduction > 0.02 ? 'good' : s2.reduction < -0.005 ? 'bad' : '') : 'pend'}">${s2 ? sign(s2.reduction) : '…'}</td>
            <td>${a.side ? `<span class="rp-side">${esc(a.side)}</span>` : '<span class="faint">none modeled</span>'}</td></tr>`;
        }).join('') || '<tr><td colspan="6" class="faint">No action matches.</td></tr>'}
      </tbody></table></div>
      <p class="rp-note">“Alone” is each action re-simulated by itself from ${fmtT(L.t)}; selected actions are evaluated together, and the combination is not the sum of its parts.</p>`;
  }

  // ── Counterfactual ─────────────────────────────────────────────────────
  function drawCounterfactual() {
    const el = $('rpCf');
    if (!el) return;
    const r = st.res;
    const cfHead = '<div class="rp-h"><h2 id="rpCfH">Plan versus doing nothing</h2></div>';
    if (waiting()) { el.innerHTML = busyCard(cfHead, 'Re-simulating the plan against the do-nothing baseline…'); return; }
    if (!r) { el.innerHTML = cfHead + '<p class="rp-empty">Select actions to compare them with the baseline.</p>'; return; }
    const bars = [
      ['Critical facility-hours', r.base.critHours, r.with.critHours, (x) => x.toFixed(0)],
      ['Hospital & EMS hours', r.base.careHours, r.with.careHours, (x) => x.toFixed(1)],
      ['Facilities reaching CRITICAL', r.base.nCrit, r.with.nCrit, (x) => x.toFixed(1)],
      ['P(hospital critical)', r.base.hospCrit, r.with.hospCrit, (x) => pct(x)],
    ];
    const mx = (b, w) => Math.max(b, w, 1e-6);
    el.innerHTML = `
      <div class="rp-h"><h2 id="rpCfH">Plan versus doing nothing</h2>
        <span class="pill ${r.cascadeBroken ? 'r-normal' : r.reduction > 0.08 ? 'r-watch' : 'r-high'}"><span class="dot"></span>${r.cascadeBroken ? 'Cascade broken' : r.reduction > 0.08 ? 'Mitigated' : 'Marginal'}</span></div>
      ${st.pending.traj ? '<div class="loading-bar"><i></i></div><p class="rp-note">Re-simulating both futures on 24 members…</p>'
        : st.traj ? trajChart(st.traj) : ''}
      <div class="rp-bars">${bars.map(([k, b, w, f]) => `<div class="rp-bar">
        <div class="rp-bar-k">${k}</div>
        <div class="rp-bar-t"><i class="base" style="width:${(b / mx(b, w) * 100).toFixed(1)}%"></i><i class="plan" style="width:${(w / mx(b, w) * 100).toFixed(1)}%"></i></div>
        <div class="rp-bar-v num"><span class="faint">${f(b)}</span> → <b>${f(w)}</b></div></div>`).join('')}</div>
      <p class="rp-legend"><i class="rp-sw base"></i>Doing nothing <i class="rp-sw plan"></i>With the plan
        <span>Decision at ${fmtT(L.t)} on ${32} ensemble members; the two futures differ only by the plan.</span></p>
      ${r.sideEffects.length ? `<p class="rp-note"><b>What it costs elsewhere.</b> ${r.sideEffects.map((x) => `${esc(M.e.F[x.i].name)} peaks ${Math.round(x.delta * 100)} points higher`).join('; ')}.</p>`
        : '<p class="rp-note">No facility is expected to peak more than 3 points higher because of this plan.</p>'}`;
  }
  // The engine returns both futures; this draws them, it does not model anything.
  function trajChart(tr) {
    const e = M.e, W = 560, H = 150, padL = 30, padR = 10, top = 12, bot = 24;
    const k0 = tr.k0, x = (t) => padL + ((t - k0 * e.DT) / (e.HOURS - k0 * e.DT)) * (W - padL - padR);
    let peak = 0;
    for (let kk = k0; kk < e.K; kk++) peak = Math.max(peak, tr.nBase[kk], tr.nPlan[kk]);
    const ymax = Math.max(1, Math.ceil(peak));
    const y = (n) => top + (H - top - bot) * (1 - n / ymax);
    const path = (arr) => { let d = ''; for (let kk = k0; kk < e.K; kk++) d += `${d ? 'L' : 'M'}${x(kk * e.DT).toFixed(1)} ${y(arr[kk]).toFixed(1)}`; return d; };
    let g = '';
    for (let n = 0; n <= ymax; n += Math.max(1, Math.round(ymax / 3))) g += `<line x1="${padL}" x2="${W - padR}" y1="${y(n)}" y2="${y(n)}" class="rp-grid"/><text x="${padL - 5}" y="${y(n) + 3}" text-anchor="end" class="rp-ax">${n}</text>`;
    for (let t = Math.ceil(k0 * e.DT / 12) * 12; t <= e.HOURS; t += 12) {
      const end = t > e.HOURS - 6;  // the last label would run past the viewBox if centred
      g += `<text x="${x(t).toFixed(1)}" y="${H - 8}" text-anchor="${end ? 'end' : 'middle'}" class="rp-ax">${fmtT(t)}</text>`;
    }
    // The gap between the two lines is the plan's effect, so it is filled.
    const band = [];
    for (let kk = k0; kk < e.K; kk++) band.push(`${x(kk * e.DT).toFixed(1)},${y(tr.nBase[kk]).toFixed(1)}`);
    for (let kk = e.K - 1; kk >= k0; kk--) band.push(`${x(kk * e.DT).toFixed(1)},${y(tr.nPlan[kk]).toFixed(1)}`);
    g += `<polygon points="${band.join(' ')}" class="rp-gap"/>`;
    g += `<path d="${path(tr.nBase)}" class="rp-ln base"/><path d="${path(tr.nPlan)}" class="rp-ln plan"/>`;
    return `<svg class="rp-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Expected facilities at CRITICAL over time, with and without the plan">${g}</svg>
      <p class="rp-note">Expected facilities at CRITICAL from ${fmtT(k0 * e.DT)} onward, weighted over the members. Both lines are returned by the engine; the shaded gap is the plan's effect.</p>`;
  }

  // ── Decision deadline ──────────────────────────────────────────────────
  function drawDeadline() {
    const el = $('rpDl');
    if (!el) return;
    const head = `<div class="rp-h"><h2 id="rpDlH">Decision deadline</h2></div>`;
    if (waiting()) { el.innerHTML = busyCard(head, 'Waiting on the plan’s own outcome first…'); return; }
    if (!st.res) { el.innerHTML = head + '<p class="rp-empty">Select a plan to see how long it keeps its value.</p>'; return; }
    if (st.pending.dl || !st.dl) { el.innerHTML = head + '<div class="loading-bar"><i></i></div><p class="rp-note">Re-running the plan with the crews starting 0, 2, 4 … 24 h later…</p>'; return; }
    const d = st.dl;
    if (!d.pts.length || d.r0 <= 0.02) { el.innerHTML = head + '<p class="rp-empty">This plan does not reduce expected critical facility-hours enough for a start time to matter.</p>'; return; }
    const W = 540, H = 150, padL = 36, padR = 12, top = 14, bot = 26;
    const maxH = d.pts[d.pts.length - 1].h;
    const ymax = Math.max(0.05, Math.ceil(d.r0 * 20) / 20);
    const x = (h) => padL + (h / maxH) * (W - padL - padR);
    const y = (r) => top + (H - top - bot) * (1 - Math.max(0, Math.min(r, ymax)) / ymax);
    let g = '';
    for (let h = 0; h <= maxH; h += 4) g += `<line x1="${x(h)}" x2="${x(h)}" y1="${top}" y2="${H - bot}" class="rp-grid"/><text x="${x(h)}" y="${H - 9}" text-anchor="middle" class="rp-ax">+${h}h</text>`;
    for (let q = 0; q <= 2; q++) { const r = (ymax * q) / 2; g += `<text x="${padL - 5}" y="${y(r) + 3}" text-anchor="end" class="rp-ax">${Math.round(r * 100)}%</text>`; }
    g += `<line x1="${padL}" x2="${W - padR}" y1="${y(d.r0 * 0.8)}" y2="${y(d.r0 * 0.8)}" class="rp-thr"/><text x="${padL + 4}" y="${y(d.r0 * 0.8) - 4}" class="rp-ax">80% of acting now</text>`;
    g += `<path d="M${padL} ${H - bot}L${d.pts.map((p) => `${x(p.h).toFixed(1)} ${y(p.reduction).toFixed(1)}`).join('L')}L${x(maxH)} ${H - bot}Z" class="rp-fill"/>`;
    g += `<path d="M${d.pts.map((p) => `${x(p.h).toFixed(1)} ${y(p.reduction).toFixed(1)}`).join('L')}" class="rp-ln plan"/>`;
    for (const p of d.pts) g += `<circle cx="${x(p.h)}" cy="${y(p.reduction)}" r="${st.delay === p.h ? 5 : 3}" class="rp-pt${st.delay === p.h ? ' on' : ''}" data-delay="${p.h}" tabindex="0" role="button" aria-label="Start ${p.h} hours later: ${pct(p.reduction)}"><title>Start +${p.h} h → ${pct(p.reduction)} fewer critical facility-hours</title></circle>`;
    if (d.actBy) g += `<line x1="${x(d.actBy)}" x2="${x(d.actBy)}" y1="${top - 4}" y2="${H - bot}" class="rp-now"/><text x="${x(d.actBy) + 4}" y="${top + 4}" class="rp-nowl">ACT BY ${fmtT(L.t + d.actBy)}</text>`;
    const at = d.pts.find((p) => p.h === st.delay) || d.pts[0];
    const line = d.actBy == null || d.actBy === 0
      ? `<b>The crews have to move now.</b> Two hours of delay already costs more than a fifth of this plan's value${d.half != null ? `, and by ${fmtT(L.t + d.half)} it is worth less than half` : ''}.`
      : d.actBy >= maxH ? `This plan keeps 80% of its value even if the crews start ${maxH} h late, so it is not the urgent decision.`
      : `Start by <b>${fmtT(L.t + d.actBy)}</b> — ${d.actBy} h from the decision — to keep 80% of the benefit${d.half != null ? `; by ${fmtT(L.t + d.half)} it is worth less than half` : ''}.`;
    el.innerHTML = head + `<p class="rp-dl-line">${line}</p>
      <svg class="rp-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Benefit against how late the crews start">${g}</svg>
      <p class="rp-note">Selected start <b>+${at.h} h</b> (${esc(S.clockShort(M.e, L.t + at.h))}): <b>${pct(at.reduction)}</b> fewer critical facility-hours${at.h ? `, against ${pct(d.r0)} by starting now` : ', the most this plan can achieve'}. The decision still uses only what was known at ${fmtT(L.t)}; only the response is delayed. This curve is re-simulated on 16 members at each start time, so it sits a point or two from the 32-member figure in the tiles above.</p>`;
  }

  // ── Forecast crossings ─────────────────────────────────────────────────
  // The crossings cluster inside a few hours, so a 72 h axis would stack them on top of
  // one another. One row per facility, over only the window the crossings fall in, keeps
  // every one legible and makes the shift the plan buys visible at the same scale.
  const CROSS_MAX = 10;
  function crossings() {
    const e = M.e, set = M.crisis ? M.crisis.set : null;
    const seq = e.cascade(M.k).filter((s2) => s2.level === 'CRITICAL' && (!set || set.has(s2.i)));
    const past = seq.filter((s2) => s2.observed).length;
    const fut = seq.filter((s2) => !s2.observed && s2.t >= L.t && s2.prob >= 0.5);
    return { past, n: fut.length, rows: fut.slice(0, CROSS_MAX).map((s2) => ({ ...s2, moved: movedTo(s2) })) };
  }
  // What the plan does to this facility's crossing, measured as the difference between
  // the two trajectories the engine returns — never from the plan's alone, which would
  // credit the plan for a facility whose mean forecast never reached CRITICAL anyway.
  //   number    the hours the plan buys, applied to the forecast crossing
  //   'removed' the mean does cross without the plan and does not with it
  //   null      no measurable change; undefined before the trajectory lands
  function movedTo(s2) {
    if (!st.traj) return undefined;
    const tr = st.traj, e = M.e, N = e.N, k0 = Math.max(tr.k0, M.k);
    const cross = (arr) => { for (let kk = k0; kk < e.K; kk++) if (arr[kk * N + s2.i] >= C.CRIT) return kk * e.DT; return null; };
    const tb = cross(tr.base);
    if (tb == null) return null;              // below CRITICAL in the mean either way
    const tp = cross(tr.plan);
    if (tp == null) return 'removed';
    return tp - tb > 0.4 ? tp - tb : null;
  }

  function drawTimeline() {
    const el = $('rpTl');
    if (!el) return;
    const e = M.e, cr = crossings();
    const head = `<div class="rp-h"><h2 id="rpTlH">Forecast crossings${M.crisis ? ` <span class="faint">in ${esc(M.crisis.id)}</span>` : ''}</h2>
      ${cr.n > CROSS_MAX ? `<span class="faint">${CROSS_MAX} soonest of ${cr.n}</span>` : ''}</div>`;
    if (!cr.rows.length) {
      el.innerHTML = head + `<p class="rp-empty">No facility is forecast to reach CRITICAL after ${fmtT(L.t)}.${cr.past ? ` ${cr.past} crossed before the decision; the plan is measured on what is still ahead.` : ''}</p>`;
      return;
    }
    const R = cr.rows, rowH = 18, labW = 196, W = 560, padR = 44, top = 26, bot = 20;
    const H = top + R.length * rowH + bot;
    const last = R.reduce((m, r) => Math.max(m, typeof r.moved === 'number' ? r.moved : r.t), L.t);
    const t1 = Math.min(e.HOURS, Math.max(last + 1, L.t + 4));
    const x = (t) => labW + ((t - L.t) / (t1 - L.t)) * (W - labW - padR);
    // At most six hour labels, or they run into one another on a short window.
    const span = t1 - L.t, step = [1, 2, 3, 6, 12].find((n) => span / n <= 6) || 24;
    let g = '';
    for (let t = Math.ceil(L.t / step) * step; t <= t1; t += step) {
      const end = x(t) > W - padR - 22;  // the last label would run under the probability column
      g += `<line x1="${x(t).toFixed(1)}" x2="${x(t).toFixed(1)}" y1="${top - 8}" y2="${H - bot}" class="rp-grid"/><text x="${x(t).toFixed(1)}" y="${H - 6}" text-anchor="${end ? 'end' : 'middle'}" class="rp-ax">${fmtT(t)}</text>`;
    }
    g += `<line x1="${x(L.t)}" x2="${x(L.t)}" y1="${top - 14}" y2="${H - bot}" class="rp-now"/><text x="${x(L.t) + 4}" y="${top - 16}" class="rp-nowl">DECIDE ${fmtT(L.t)}</text>`;
    R.forEach((r, n) => {
      const yy = top + n * rowH + rowH / 2;
      const gone = r.moved === 'removed', shifted = typeof r.moved === 'number';
      const to = shifted ? Math.min(t1, r.t + r.moved) : 0;
      g += `<g class="rp-ev${sel(r.i) ? ' on' : ''}${gone ? ' gone' : ''}" data-fac="${r.i}" tabindex="0" role="button" aria-label="${esc(e.F[r.i].name)} reaches CRITICAL at ${fmtT(r.t)}${gone ? ', kept below CRITICAL by the plan' : shifted ? `, delayed to ${fmtT(r.moved)} by the plan` : ''}">
        <rect x="0" y="${yy - rowH / 2}" width="${W}" height="${rowH}" class="rp-evbg"/>
        <text x="0" y="${yy + 3.5}" class="rp-evl">${esc(clip(e.F[r.i].name))}</text>
        ${shifted ? `<text x="${labW - 8}" y="${yy + 3.5}" text-anchor="end" class="rp-evd">+${r.moved.toFixed(1)}h</text>` : ''}
        <line x1="${labW}" x2="${(W - padR).toFixed(1)}" y1="${yy}" y2="${yy}" class="rp-evt"/>
        ${shifted ? `<line x1="${x(r.t).toFixed(1)}" x2="${x(to).toFixed(1)}" y1="${yy}" y2="${yy}" class="rp-shift"/><circle cx="${x(to).toFixed(1)}" cy="${yy}" r="3.4" class="rp-after"/>` : ''}
        <circle cx="${x(r.t).toFixed(1)}" cy="${yy}" r="3.4"/>
        <text x="${W - 6}" y="${yy + 3.5}" text-anchor="end" class="rp-evp">${pct(r.prob)}</text>
        <title>${esc(e.F[r.i].name)} · CRITICAL ~${fmtT(r.t)} · ${pct(r.prob)}${gone ? ' · the plan keeps the expected risk below CRITICAL' : shifted ? ` · the plan buys ${r.moved.toFixed(1)} h, to ~${fmtT(to)}` : st.traj ? ' · the plan does not move it' : ''}</title></g>`;
    });
    el.innerHTML = head + `<svg class="rp-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Forecast CRITICAL crossings and how the plan moves them">${g}</svg>
      <p class="rp-legend"><i class="dotk r-critical"></i>Forecast CRITICAL ${st.traj ? '<i class="dotk after"></i>Hours the plan buys <i class="dotk gone"></i>Kept below CRITICAL' : ''}
        <span>${cr.past ? `${cr.past} facilit${cr.past === 1 ? 'y has' : 'ies have'} already crossed; those are past the decision. ` : ''}${st.traj ? 'The dot is the ensemble median crossing time and the figure beside it the share of members that cross at all. The hours bought are the difference between the two trajectories the engine returns, so a facility whose expected risk never reaches CRITICAL either way is left unmarked rather than credited to the plan.' : 'Select a plan to see how it moves these crossings.'}</span></p>`;
  }
  const clip = (s2) => (s2.length > 28 ? s2.slice(0, 27) + '…' : s2);

  const sel = (i) => st.selFac === i;

  // ── Supporting panels ──────────────────────────────────────────────────
  function drawFacilities() {
    const el = $('rpFac');
    if (!el) return;
    const head = `<div class="rp-h"><h2 id="rpFacH">Facilities the plan changes</h2></div>`;
    if (waiting()) { el.innerHTML = busyCard(head, 'Comparing expected peaks…'); return; }
    if (!st.res) { el.innerHTML = head + '<p class="rp-empty">Select a plan to see which facilities it moves.</p>'; return; }
    const e = M.e, r = st.res;
    const rows = e.F.map((f, i) => ({ i, d: r.with.peaks[i] - r.base.peaks[i], b: r.base.peaks[i] }))
      .filter((x) => e.kinds[x.i] !== 'weather' && Math.abs(x.d) >= 0.01)
      .sort((a, b) => a.d - b.d).slice(0, 8);
    el.innerHTML = head + (rows.length ? `<div class="tbl-wrap"><table class="rp-tbl sm"><thead><tr><th>Facility</th><th>Peak without</th><th>With plan</th><th>Change</th></tr></thead><tbody>
      ${rows.map((x) => { const sb = stateOf(x.b), sw = stateOf(x.b + x.d); return `<tr class="${sel(x.i) ? 'on' : ''}" data-fac="${x.i}" tabindex="0">
        <td>${esc(e.F[x.i].name)}<div class="faint">${SYS_SHORT[A.group(e.kinds[x.i])] || ''}</div></td>
        <td><span class="pill r-${sb.key}"><span class="dot"></span>${pct(x.b)}</span></td>
        <td><span class="pill r-${sw.key}"><span class="dot"></span>${pct(x.b + x.d)}</span></td>
        <td class="num ${x.d < 0 ? 'good' : 'bad'}">${x.d < 0 ? '' : '+'}${Math.round(x.d * 100)} pts</td></tr>`; }).join('')}
      </tbody></table></div><p class="rp-note">Expected peak risk over the rest of the window, with and without the plan. Only facilities moved by at least one point are listed.</p>`
      : '<p class="rp-empty">This plan does not move any facility\'s expected peak by a measurable amount.</p>');
  }

  function drawSystems() {
    const el = $('rpSys');
    if (!el) return;
    const head = `<div class="rp-h"><h2 id="rpSysH">By system</h2></div>`;
    if (waiting()) { el.innerHTML = busyCard(head, 'Comparing expected peaks…'); return; }
    if (!st.res) { el.innerHTML = head + '<p class="rp-empty">Select a plan.</p>'; return; }
    const e = M.e, r = st.res, by = {};
    for (let i = 0; i < e.N; i++) {
      if (e.kinds[i] === 'weather') continue;
      const g = A.group(e.kinds[i]);
      const o = by[g] || (by[g] = { b: 0, w: 0, n: 0, lower: 0 });
      o.b = Math.max(o.b, r.base.peaks[i]); o.w = Math.max(o.w, r.with.peaks[i]); o.n++;
      if (r.with.peaks[i] < r.base.peaks[i] - 0.01) o.lower++;
    }
    const rows = Object.entries(by).sort((a, b) => b[1].b - a[1].b);
    el.innerHTML = head + `<div class="rp-sys">${rows.map(([g, o]) => {
      const sw = stateOf(o.w), moved = o.w < o.b - 0.005;
      return `<div class="rp-sys-row"><span class="k">${SYS_SHORT[g] || g}</span>
        <span class="rp-sys-bar"><i class="base" style="width:${(o.b * 100).toFixed(0)}%"></i><i class="plan r-${sw.key}" style="width:${(o.w * 100).toFixed(0)}%"></i></span>
        <span class="v num"><b class="${moved ? 'good' : ''}">${pct(o.b)}${moved ? ` → ${pct(o.w)}` : ''}</b>
          <span class="faint">${o.lower ? `${o.lower} of ${o.n} lower` : `none of ${o.n} lower`}</span></span></div>`;
    }).join('')}</div><p class="rp-note">The bar is the worst expected peak in the system: grey without the plan, coloured with it. A system can keep its worst case and still have facilities the plan lowers, so the count beside it is how many of its facilities move.</p>`;
  }

  function drawCrew() {
    const el = $('rpCrew');
    if (!el) return;
    const used = [...st.chosen].map((id) => M.cat.find((a) => a.id === id)).filter(Boolean);
    const spent = used.reduce((s, a) => s + a.cost, 0);
    el.innerHTML = `<div class="rp-h"><h2 id="rpCrewH">Crews committed</h2></div>
      <div class="rp-pips" role="img" aria-label="${spent} of ${st.budget} crews committed">${Array.from({ length: Math.max(st.budget, spent) }, (_, n) => `<i class="${n < spent ? (spent > st.budget ? 'over' : 'used') : ''}"></i>`).join('')}</div>
      <p class="rp-crew-n num">${spent} <span class="faint">of ${st.budget}</span></p>
      ${used.length ? `<ul class="rp-crew-list">${used.sort((a, b) => b.cost - a.cost).map((a) => `<li><span>${esc(a.label)}</span><b class="num">${a.cost}</b></li>`).join('')}</ul>`
        : '<p class="rp-empty">No action selected.</p>'}
      <p class="rp-note">A crew is the model's only resource constraint — an abstract unit of capacity, not a named team, vehicle or cost.</p>`;
  }

  // ── Plan comparison (this visit only) ──────────────────────────────────
  function drawCompare() {
    const el = $('rpCmp');
    if (!el) return;
    const head = `<div class="rp-h"><h2 id="rpCmpH">Plan comparison <span class="faint">(${st.compare.length})</span></h2>
      ${st.compare.length ? '<button class="btn" id="rpCmpClear">Clear all</button>' : ''}</div>`;
    if (!st.compare.length) { el.innerHTML = head + `<p class="rp-empty">Build a plan and choose <b>Save for comparison</b> to hold it here beside others. Comparisons last for this visit only — nothing is stored.</p>`; return; }
    el.innerHTML = head + `<div class="tbl-wrap"><table class="rp-tbl"><thead><tr>
      <th>Plan</th><th>Crews</th><th>Critical facility-hours</th><th>Hosp & EMS hours</th><th>P(hosp critical)</th><th>Reaching CRITICAL</th><th>Act by</th><th></th></tr></thead><tbody>
      ${st.compare.map((p, n) => `<tr><td><b>${esc(p.name)}</b><div class="faint">${p.ids.map((id) => esc((M.cat.find((a) => a.id === id) || {}).label || id)).join(' · ')}</div></td>
        <td class="num">${p.cost}</td>
        <td class="num">${p.r.with.critHours.toFixed(0)} <span class="${p.r.reduction > 0 ? 'good' : 'bad'}">${sign(p.r.reduction)}</span></td>
        <td class="num">${p.r.with.careHours.toFixed(1)} <span class="${p.r.careReduction > 0 ? 'good' : 'bad'}">${sign(p.r.careReduction)}</span></td>
        <td class="num">${pct(p.r.with.hospCrit)}</td><td class="num">${p.r.with.nCrit.toFixed(1)}</td>
        <td class="num">${p.dl == null ? '<span class="faint">…</span>' : p.dl.actBy == null || p.dl.actBy === 0 ? 'now' : fmtT(p.t + p.dl.actBy)}</td>
        <td><button type="button" class="lnk-btn" data-load="${n}">Load</button> <button type="button" class="lnk-btn" data-drop="${n}">Remove</button></td></tr>`).join('')}
      </tbody></table></div>
      <p class="rp-note">Every plan here was evaluated at the same decision time (${fmtT(L.t)}) on the same scenario, so the rows are comparable. Changing the city, scenario or time clears them.</p>`;
  }

  // ── Wiring ─────────────────────────────────────────────────────────────
  let wired = false;
  function wire() {
    if (wired) return;
    wired = true;
    const page = $('page');
    page.addEventListener('click', (ev) => {
      const t = ev.target;
      if (t.closest('a')) return;
      const b = t.closest('[data-b],[data-filter],[data-act],[data-fac],[data-delay],[data-load],[data-drop]');
      if (t.id === 'rpRec') return recommend();
      if (t.id === 'rpClear') { st.chosen.clear(); drawBuilder(); compute(); return; }
      if (t.id === 'rpSave') return savePlan();
      if (t.id === 'rpCmpClear') { st.compare = []; drawCompare(); return; }
      if (!b) return;
      if (b.dataset.b) { st.budget = +b.dataset.b; render0(); return; }
      if (b.dataset.filter) { st.filter = b.dataset.filter; drawBuilder(); return; }
      if (b.dataset.delay != null) { st.delay = +b.dataset.delay; drawDeadline(); return; }
      if (b.dataset.load != null) { const p = st.compare[+b.dataset.load]; if (p) { st.chosen = new Set(p.ids); drawBuilder(); compute(); } return; }
      if (b.dataset.drop != null) { st.compare.splice(+b.dataset.drop, 1); drawCompare(); return; }
      if (b.dataset.act) { toggle(b.dataset.act); return; }
      if (b.dataset.fac != null) { st.selFac = st.selFac === +b.dataset.fac ? null : +b.dataset.fac; drawFacilities(); drawTimeline(); return; }
    });
    page.addEventListener('change', (ev) => {
      if (ev.target.id === 'rpSort') { st.sort = ev.target.value; drawBuilder(); }
      else if (ev.target.dataset && ev.target.dataset.act) toggle(ev.target.dataset.act, ev.target.checked);
    });
    page.addEventListener('input', (ev) => { if (ev.target.id === 'rpQ') { st.query = ev.target.value; drawBuilder(); const q = $('rpQ'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } } });
    page.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      const t = ev.target;
      if (t.matches('[data-fac],[data-delay]')) { ev.preventDefault(); t.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
    });
  }
  function toggle(id, want) {
    const on = want == null ? !st.chosen.has(id) : want;
    on ? st.chosen.add(id) : st.chosen.delete(id);
    drawBuilder();
    compute();
  }
  // A budget change re-renders in place; it changes what the planner may recommend.
  function render0() {
    const ctl = $('rpBudget');
    if (ctl) for (const n of ctl.children) n.setAttribute('aria-pressed', String(+n.dataset.b === st.budget));
    drawTiles(); drawCrew();
  }
  async function recommend() {
    const btn = $('rpRec');
    if (!btn || btn.disabled) return;
    btn.disabled = true; btn.textContent = 'Searching…';
    const my = token;
    const ids = await T.services.recommended(L.e, L.k, st.budget).then((p) => p.ids);
    if (my !== token) return;
    st.chosen = new Set(ids);
    btn.disabled = false; btn.textContent = 'Recommend within budget';
    drawBuilder();
    compute();
  }
  function savePlan() {
    if (!st.res || !st.chosen.size) return;
    const ids = [...st.chosen];
    const cost = ids.reduce((s, id) => s + (M.cat.find((a) => a.id === id) || { cost: 0 }).cost, 0);
    const entry = { name: `Plan ${String.fromCharCode(65 + st.compare.length)}`, ids, cost, r: st.res, dl: st.dl, t: L.t };
    st.compare = [...st.compare.filter((p) => p.ids.join() !== ids.join()), entry].slice(-4);
    drawCompare();
    // The deadline may still be computing when the plan is saved; fill it in when it lands.
    if (!entry.dl) {
      const my = token;
      setTimeout(() => { if (my === token && st.dl && st.chosen.size && [...st.chosen].join() === ids.join()) { entry.dl = st.dl; drawCompare(); } }, 1200);
    }
  }

  T.router.register('/plan', {
    title: 'Response',
    mount(ctx) { S.show(); render(ctx); },
    unmount() { token++; job++; },
    update(ctx) { render(ctx); },
  });
})(typeof window !== 'undefined' ? window : globalThis);
