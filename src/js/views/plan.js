/* Response at #/plan: what to do with the crews available, what it costs elsewhere,
   and by when it has to start.

   Every figure is a counterfactual run of the engine from the issue time on the
   ensemble members that best match the evidence so far, so nothing after the issue
   time is used. The decision deadline is the part a dashboard cannot show: a plan
   worth 55% if the crews move now can be worth nothing six hours later. */
(function (root) {
  const T = root.TWIN;
  const C = T.core, S = T.site, V = T.crisisView;
  const { fmtT } = C;
  const { esc } = S;
  const $ = (id) => document.getElementById(id);
  const pct = (p) => Math.round(p * 100) + '%';
  const delta = (x) => (x >= 0 ? '−' : '+') + Math.abs(Math.round(x * 100)) + '%';
  const BUDGETS = [3, 5, 7];

  let token = 0;
  // Per engine and decision step: the single-action gains and the deadline curve, both
  // slow enough to be worth keeping while the page is open.
  let cache = { key: '', singles: {}, deadlines: {} };
  const chosen = new Set();
  let budget = 5;

  async function render(ctx) {
    const my = ++token, alive = () => my === token;
    S.header('/plan');
    let L;
    try { L = await S.load(ctx, S.busy); } catch (err) { S.fail(err); return; }
    if (!alive()) return;
    S.settle(L); S.header('/plan', L);
    const { e, k } = L;
    const p = T.services.planner(e);
    const key = `${L.geo.id}|${L.scen.id}|${k}`;
    if (cache.key !== key) { cache = { key, singles: {}, deadlines: {} }; chosen.clear(); }
    const replayEnd = L.mode === 'historical' && k >= e.K - 2;

    $('page').innerHTML = `
      <div class="pg-wrap">
        <header class="pg-head">
          <p class="pg-kicker">${esc(L.scen.label)} · <span>${esc(L.scen.provenance ? L.scen.provenance.label : 'Simulation')}</span></p>
          <h1>Response</h1>
          <p class="pg-asof">Deciding at ${V.at(L, L.t)} on ${esc(L.geo.city)}, with what was known then</p>
          <p class="ov-lede">${p.CATALOG.length} actions are available${L.geo.id === 'raleigh' ? ', written for Raleigh' : ', generated from the dependency graph: the facilities feeding the most consequential links get the remedies'}. Each is re-simulated from ${fmtT(L.t)} on the ensemble members that best match the evidence so far.</p>
        </header>
        ${replayEnd ? `<p class="empty">The replay has reached the end of the window, so there is nothing left to plan for. Switch to Now to plan at the simulated now.</p>` : `
        <section class="pg-sec" aria-labelledby="plActs">
          <div class="pl-bar">
            <h2 id="plActs">Actions</h2>
            <div class="pl-controls">
              <span class="pg-note">Crews</span>
              <div class="seg" id="plBudget">${BUDGETS.map((b) => `<button data-b="${b}" aria-pressed="${b === budget}">${b}</button>`).join('')}</div>
              <button class="btn" id="plRec">Recommend within budget</button>
              <button class="btn" id="plClear">Clear</button>
            </div>
          </div>
          <div class="pl-acts" id="plActList"></div>
        </section>
        <section class="pg-sec" aria-labelledby="plOut">
          <h2 id="plOut">Expected outcome</h2>
          <div id="plOutcome"><p class="empty">Choose actions, or let the planner recommend a set within the budget.</p></div>
        </section>
        <section class="pg-sec" aria-labelledby="plDead">
          <h2 id="plDead">Decision deadline</h2>
          <p class="pg-note">The same plan, decided now but with the crews starting later. The decision still uses only what was known at ${fmtT(L.t)}; only the response is delayed.</p>
          <div id="plDeadline"><p class="empty">Choose a plan to see how long it keeps its value.</p></div>
        </section>
        <section class="pg-sec prov" aria-labelledby="plProv">
          <h2 id="plProv">How this is computed</h2>
          <p>Each option is applied to the simulation from ${fmtT(L.t)} and run forward on the 32 ensemble members with the highest posterior weight at that moment, then compared with the same members left alone. Critical facility-hours weight each facility by its tier, so a trauma centre counts for more than a culvert gauge.</p>
          <p>${esc(S.provenance(L))}</p>
        </section>`}
      </div>`;
    if (replayEnd) return;

    $('plBudget').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-b]');
      if (!b) return;
      budget = +b.dataset.b;
      for (const n of $('plBudget').children) n.setAttribute('aria-pressed', String(+n.dataset.b === budget));
      drawOutcome(L, p);
    });
    $('plClear').addEventListener('click', () => { chosen.clear(); drawActs(L, p); drawOutcome(L, p); });
    $('plRec').addEventListener('click', async () => {
      const btn = $('plRec');
      btn.disabled = true; btn.textContent = 'Searching…';
      const plan = await T.services.recommended(e, k, budget);
      if (!alive()) return;
      chosen.clear();
      for (const id of plan.ids) chosen.add(id);
      btn.disabled = false; btn.textContent = 'Recommend within budget';
      drawActs(L, p); drawOutcome(L, p);
    });
    $('plActList').addEventListener('change', (ev) => {
      const id = ev.target.dataset.id;
      if (!id) return;
      ev.target.checked ? chosen.add(id) : chosen.delete(id);
      drawOutcome(L, p);
    });

    drawActs(L, p);
    // Open on the planner's own recommendation, so the page says something immediately.
    const plan = await T.services.recommended(e, k, budget);
    if (!alive() || chosen.size) return;
    for (const id of plan.ids) chosen.add(id);
    drawActs(L, p); drawOutcome(L, p);
    T.nav.render('/plan', L); // the sidebar chip can show the recommendation now
    // Then fill in what each action is worth alone, one per frame.
    for (const a of p.CATALOG) {
      if (!alive()) return;
      if (!cache.singles[a.id]) cache.singles[a.id] = p.evaluate(k, [a.id], 24);
      drawActs(L, p);
      await S.nextFrame();
    }
  }

  function drawActs(L, p) {
    const el = $('plActList');
    if (!el) return;
    el.innerHTML = p.CATALOG.map((a) => {
      const s = cache.singles[a.id];
      return `<label class="pl-act${chosen.has(a.id) ? ' on' : ''}">
        <input type="checkbox" data-id="${esc(a.id)}"${chosen.has(a.id) ? ' checked' : ''}>
        <span class="pl-act-main">
          <span class="pl-act-head"><b>${esc(a.label)}</b><span class="pl-cost num">${a.cost} crew${a.cost > 1 ? 's' : ''}</span></span>
          <span class="pl-act-detail">${esc(a.detail)}</span>
          ${a.side ? `<span class="pl-act-side">Side effect: ${esc(a.side)}</span>` : ''}
          <span class="pl-act-gain">${s ? `Alone: ${delta(s.reduction)} critical facility-hours, ${delta(s.careReduction)} hospital and EMS` : 'Alone: evaluating…'}</span>
        </span>
      </label>`;
    }).join('');
  }

  function drawOutcome(L, p) {
    const out = $('plOutcome'), dead = $('plDeadline');
    if (!out) return;
    const ids = [...chosen];
    if (!ids.length) {
      out.innerHTML = '<p class="empty">Choose actions, or let the planner recommend a set within the budget.</p>';
      dead.innerHTML = '<p class="empty">Choose a plan to see how long it keeps its value.</p>';
      return;
    }
    const r = p.evaluate(L.k, ids), F = L.e.F;
    const over = r.cost > budget;
    const verdict = r.cascadeBroken ? ['Cascade broken', 'normal'] : r.reduction > 0.08 ? ['Mitigated', 'watch'] : ['Marginal', 'high'];
    out.innerHTML = `
      <div class="pl-verdict">
        <span class="pill r-${verdict[1]}"><span class="dot"></span>${verdict[0]}</span>
        <span class="pg-note">${r.cost} of ${budget} crews${over ? ' · <b class="bad">over budget</b>' : ''}</span>
      </div>
      <div class="pl-ledger">
        ${cell('Critical facility-hours', r.with.critHours.toFixed(0), r.base.critHours.toFixed(0), r.reduction)}
        ${cell('Hospital and EMS hours', r.with.careHours.toFixed(1), r.base.careHours.toFixed(1), r.careReduction)}
        ${cell('P(a hospital goes critical)', pct(r.with.hospCrit), pct(r.base.hospCrit), r.base.hospCrit ? 1 - r.with.hospCrit / r.base.hospCrit : 0)}
        ${cell('Facilities reaching critical', r.with.nCrit.toFixed(1), r.base.nCrit.toFixed(1), r.base.nCrit ? 1 - r.with.nCrit / r.base.nCrit : 0)}
      </div>
      ${r.sideEffects.length
        ? `<p class="pl-side-list"><b>What it costs elsewhere.</b> ${r.sideEffects.map((s) => `${esc(F[s.i].name)} peaks ${Math.round(s.delta * 100)} points higher`).join('; ')}.</p>`
        : '<p class="pl-side-list">No facility is expected to peak more than 3 points higher because of this plan.</p>'}`;
    drawDeadline(L, p, ids);
  }
  const cell = (k, v, was, d) => `<div class="pl-cellbox"><div class="k">${k}</div><div class="v num">${v}</div><div class="d ${d > 0 ? 'good' : d < 0 ? 'bad' : ''}">${d ? delta(d) : 'no change'} · was ${was}</div></div>`;

  // The deadline curve runs 13 counterfactuals, so it is computed off the click and cached.
  function drawDeadline(L, p, ids) {
    const dead = $('plDeadline');
    const key = ids.slice().sort().join('+');
    if (cache.deadlines[key]) { dead.innerHTML = deadlineHtml(L, cache.deadlines[key]); return; }
    dead.innerHTML = '<div class="loading-bar"><i></i></div><p class="pg-note">Re-running the plan with the crews starting 0, 2, 4 … 24 h later…</p>';
    const my = token;
    setTimeout(() => {
      if (my !== token) return;
      const d = p.deadline(L.k, ids);
      cache.deadlines[key] = d;
      if (my === token && $('plDeadline')) $('plDeadline').innerHTML = deadlineHtml(L, d);
    }, 40);
  }

  function deadlineHtml(L, d) {
    if (!d.pts.length || d.r0 <= 0.02) return '<p class="empty">This plan does not reduce expected critical facility-hours enough for a start time to matter.</p>';
    const W = 940, padL = 54, padR = 16, top = 16, h = 150, H = h + top + 40;
    const maxH = d.pts[d.pts.length - 1].h;
    const ymax = Math.max(0.05, Math.ceil(d.r0 * 20) / 20);
    const x = (hh) => padL + (hh / maxH) * (W - padL - padR);
    const y = (r) => top + h - (Math.max(0, Math.min(r, ymax)) / ymax) * h;
    let g = '';
    for (let hh = 0; hh <= maxH; hh += 4) g += `<line x1="${x(hh)}" x2="${x(hh)}" y1="${top}" y2="${top + h}" class="c-grid"/><text x="${x(hh)}" y="${H - 18}" text-anchor="middle" class="c-tick">+${hh}h</text>`;
    for (let q = 0; q <= 4; q++) { const r = (ymax * q) / 4; g += `<text x="${padL - 8}" y="${y(r) + 4}" text-anchor="end" class="c-tick">${Math.round(r * 100)}%</text>`; }
    // The 80% line is the rule behind "act by".
    g += `<line x1="${padL}" x2="${W - padR}" y1="${y(d.r0 * 0.8)}" y2="${y(d.r0 * 0.8)}" class="c-one"/><text x="${padL + 6}" y="${y(d.r0 * 0.8) - 5}" class="c-note">80% of the benefit of starting now</text>`;
    const pts = d.pts.map((pp) => `${x(pp.h).toFixed(1)} ${y(pp.reduction).toFixed(1)}`);
    g += `<path d="M${pts.join('L')}" class="c-past"/>`;
    g += `<path d="M${padL} ${top + h}L${pts.join('L')}L${x(maxH)} ${top + h}Z" class="pl-fill"/>`;
    for (const pp of d.pts) g += `<circle cx="${x(pp.h)}" cy="${y(pp.reduction)}" r="3" class="mk-cr-o"><title>Start +${pp.h} h: ${pct(pp.reduction)} fewer critical facility-hours</title></circle>`;
    if (d.actBy) g += `<line x1="${x(d.actBy)}" x2="${x(d.actBy)}" y1="${top - 6}" y2="${top + h}" class="c-now"/><text x="${x(d.actBy) + 5}" y="${top + 4}" class="c-nowl">ACT BY ${fmtT(L.t + d.actBy)}</text>`;
    const sentence = d.actBy == null || d.actBy === 0
      ? `<b>The crews have to move now.</b> Two hours of delay already costs more than a fifth of this plan's value${d.half != null ? `, and by <b>${fmtT(L.t + d.half)}</b> it is worth less than half` : ''}.`
      : d.actBy >= maxH
        ? `This plan keeps 80% of its value even if the crews start ${maxH} h late, so it is not the urgent decision.`
        : `Start by <b>${fmtT(L.t + d.actBy)}</b> (${d.actBy} h from the decision) to keep 80% of the benefit${d.half != null ? `; by <b>${fmtT(L.t + d.half)}</b> it is worth less than half` : ''}.`;
    return `<p class="pl-deadline-line">${sentence} Starting now is worth ${pct(d.r0)} fewer critical facility-hours.</p>
      <svg class="pl-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Benefit of the plan against how late the crews start">${g}</svg>`;
  }

  T.router.register('/plan', {
    title: 'Response',
    mount(ctx) { S.show(); render(ctx); },
    unmount() { token++; },
    update(ctx) { render(ctx); },
  });
})(typeof window !== 'undefined' ? window : globalThis);
