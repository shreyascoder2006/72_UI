/* Overview at #/: the situation in the chosen city and scenario at the issue time, in
   sentences computed from the engine, then the predicted course (Cascade-R and the
   order in which systems fail), the crises in the registry, their footprints, and the
   intervention planner's recommendation. No figure here is fixed in the page: each
   comes from the shared engine at the issue time. */
(function (root) {
  const T = root.TWIN;
  const C = T.core, S = T.site, A = T.analytics, V = T.crisisView;
  const { stateOf, fmtT } = C;
  const { esc } = S;
  const $ = (id) => document.getElementById(id);
  const pct = (p) => Math.round(p * 100) + '%';
  const BUDGET = 5;

  let token = 0;
  async function render(ctx) {
    const my = ++token, alive = () => my === token;
    S.header('/');
    let L;
    try { L = await S.load(ctx, S.busy); } catch (err) { S.fail(err); return; }
    if (!alive()) return;
    S.settle(L); S.header('/', L);
    const { e, an, k } = L, N = e.N, F = e.F;
    const reg = an.crises(k), cr = an.cascadeR(k), cx = an.crossing(k);
    const seq = e.cascade(k);
    const R = e.stateAt(k).risk;
    const city = stateOf(e.cityAt(k).risk);
    const critNow = [], soon = [];
    for (let i = 0; i < N; i++) if (e.kinds[i] !== 'weather' && R[i] >= C.CRIT) critNow.push(i);
    for (const s of seq) if (s.level === 'CRITICAL' && !s.observed && s.prob >= 0.5 && s.t - L.t <= 24 && !critNow.includes(s.i)) soon.push(s);
    const monitored = F.filter((f) => f.type !== 'weather').length;

    const crisisLine = !reg.list.length
      ? 'No crisis is in the registry.'
      : `${reg.list.length === 1 ? 'One crisis is' : `${reg.list.length} crises are`} in the registry: ${reg.list.slice(0, 3).map((c) => `${article(c.type)} ${esc(c.type.toLowerCase())} (<a href="${esc(V.crisisHref(c.id))}" class="num">${esc(c.id)}</a>, ${c.stage.toLowerCase()}) around ${esc(V.places(c.districts, 2))}`).join('; ')}${reg.list.length > 3 ? `; and ${reg.list.length - 3} more` : ''}.`;
    const facLine = `${critNow.length ? `${critNow.length} of the ${monitored} infrastructure facilities ${critNow.length > 1 ? 'are' : 'is'} CRITICAL now` : `None of the ${monitored} infrastructure facilities is CRITICAL now`}${soon.length ? `; the forecast has ${soon.length} ${critNow.length ? 'more ' : ''}crossing CRITICAL within 24 h, the first ${esc(F[soon[0].i].name)} at ${V.at(L, soon[0].t)}` : L.mode === 'live' ? `; none ${critNow.length ? 'more ' : ''}is forecast to within 24 h` : ''}.`;
    const replayEnd = L.mode === 'historical' && k >= e.K - 2;

    $('page').innerHTML = `
      <div class="pg-wrap">
        <header class="pg-head ov-head">
          <p class="pg-kicker">${esc(L.scen.label)} · <span>${esc(L.scen.provenance ? L.scen.provenance.label : 'Simulation')}</span></p>
          <h1>${esc(L.geo.city)} <span class="pill r-${city.key}"><span class="dot"></span>City ${city.label}</span></h1>
          <p class="pg-asof">As issued at ${V.at(L, L.t)}${L.mode === 'historical' ? ' · replay' : ''}</p>
          <p class="ov-lede">${crisisLine} ${facLine} ${V.crText(L, cr, cx)}</p>
        </header>

        <section class="pg-sec" aria-labelledby="ovCourse">
          <h2 id="ovCourse">Predicted course</h2>
          <p class="pg-note">Cascade-R over the 72 h window (observed up to ${fmtT(L.t)}, forecast after), and when each facility first crosses HIGH RISK <span class="mk-hi" aria-hidden="true">◆</span> and CRITICAL <span class="mk-cr" aria-hidden="true">●</span>, by system. Hollow marks are forecasts; fainter means less likely.</p>
          <div id="ovChart" class="ov-chart"><div class="loading-bar"><i></i></div></div>
        </section>

        <div class="pg-grid two">
          <section class="pg-sec" aria-labelledby="ovCrises">
            <h2 id="ovCrises">Crises now</h2>
            ${reg.list.length ? reg.list.slice(0, 3).map((c) => V.row(L, c)).join('') : `<p class="empty">No crisis at ${fmtT(L.t)}.</p>`}
            <p class="pg-more"><a data-nav="/crises" href="${esc(S.href('/crises', { c: null }))}">${reg.list.length > 3 ? `All ${reg.list.length} crises` : 'Crisis registry'}, interactions and history →</a></p>
          </section>
          <section class="pg-card map-card" aria-label="Crisis footprints">
            ${S.cityMap({ L, R, crises: reg.list, link: V.crisisHref })}
            <p class="map-note">Dots: monitored facilities in their current state. Outlines: crisis footprints. <a href="${esc(V.twinHref(L, { c: reg.list[0] ? reg.list[0].id : null, a: null }))}">Open the 3D twin →</a></p>
          </section>
        </div>

        <section class="pg-sec" aria-labelledby="ovPlan">
          <h2 id="ovPlan">Recommended response</h2>
          <div id="ovPlanBody">${replayEnd
            ? '<p class="empty">The replay has reached the end of the window, so there is nothing left to plan for. Switch to Now to see the recommendation at the simulated now.</p>'
            : `<p class="pg-note">Searching the action catalogue within ${BUDGET} crews at ${fmtT(L.t)}: each combination is re-simulated on the ensemble members that best match the evidence so far…</p><div class="loading-bar"><i></i></div>`}</div>
        </section>

        <section class="pg-sec prov" aria-labelledby="ovProv">
          <h2 id="ovProv">What this is built from</h2>
          <p>${esc(L.scen.blurb)}</p>
          <p>${esc(S.provenance(L))}</p>
          <p>The city model is OpenStreetMap: ${monitored} infrastructure facilities and ${F.length - monitored} weather stations, their street and river connections, and the buildings on the 3D twin. Residents come from a modeled grid that spreads ${esc(L.geo.city)}'s population over street and building density${L.geo.population ? ` (${Math.round(L.geo.population.cells.reduce((s, c) => s + c[2], 0) / 1000).toLocaleString('en-US')}k people in ${L.geo.population.cells.length} cells of ${L.geo.population.cell} m)` : ''}.</p>
        </section>
      </div>`;

    // Chart: Cascade-R hourly, observed then forecast (a few hundred ms on Nagpur).
    await S.nextFrame();
    if (!alive()) return;
    const past = [], fut = [];
    for (let kk = 0; kk <= k; kk += 2) past.push([kk * e.DT, an.cascadeR(kk).r]);
    if (k % 2) past.push([L.t, cr.r]);
    await S.nextFrame();
    if (!alive()) return;
    for (let kk = k + 2; kk < e.K; kk += 2) fut.push([kk * e.DT, an.cascadeR(k, kk).r]);
    $('ovChart').innerHTML = course(L, reg.systems, seq, past, fut);

    if (replayEnd) return;
    const plan = await T.services.recommended(e, k, BUDGET);
    if (!alive()) return;
    $('ovPlanBody').innerHTML = planHtml(L, plan);
  }
  const article = (w) => (/^[aeiou]/i.test(w) ? 'an' : 'a');

  function course(L, systems, seq, past, fut) {
    const e = L.e, W = 1000, padL = 112, padR = 14, top = 14, h = 128, rowH = 24;
    const x = (t) => padL + (t / e.HOURS) * (W - padL - padR);
    const ymax = Math.max(2, Math.ceil(Math.max(...past.map((p) => p[1]), ...fut.map((p) => p[1]), 0)));
    const y = (r) => top + h - (Math.min(r, ymax) / ymax) * h;
    const line = (pts) => pts.map(([t, r], n) => `${n ? 'L' : 'M'}${x(t).toFixed(1)} ${y(r).toFixed(1)}`).join('');
    const rows0 = top + h + 26;
    const H = rows0 + systems.length * rowH + 26;
    let g = '';
    // Grid and axis
    for (let t = 0; t <= e.HOURS; t += 12) {
      g += `<line x1="${x(t)}" x2="${x(t)}" y1="${top}" y2="${H - 22}" class="c-grid"/><text x="${x(t)}" y="${H - 8}" text-anchor="middle" class="c-tick">${esc(S.clockShort(e, t))}</text>`;
    }
    for (let r = 0; r <= ymax; r++) g += `<text x="${padL - 8}" y="${y(r) + 4}" text-anchor="end" class="c-tick">${r}</text>`;
    g += `<line x1="${padL}" x2="${W - padR}" y1="${y(1)}" y2="${y(1)}" class="c-one"/><text x="${padL + 6}" y="${y(1) - 5}" class="c-note">1 · cascade self-sustaining above</text>`;
    g += `<text x="0" y="${top + 12}" class="c-label">Cascade-R</text>`;
    g += `<path d="${line(past)}" class="c-past"/>`;
    if (fut.length) g += `<path d="${line([past[past.length - 1], ...fut])}" class="c-fut"/>`;
    // Systems: first HIGH RISK and CRITICAL per facility
    systems.forEach((sys, n) => {
      const yy = rows0 + n * rowH + rowH / 2;
      g += `<line x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}" class="c-row"/><text x="0" y="${yy + 4}" class="c-label">${A.SYS_LABEL[sys]}</text>`;
      for (const s of seq) {
        if (A.group(e.kinds[s.i]) !== sys) continue;
        const cxp = x(s.t).toFixed(1), crit = s.level === 'CRITICAL';
        const op = s.observed ? 1 : (0.3 + 0.7 * s.prob).toFixed(2);
        const tip = `<title>${esc(e.F[s.i].name)} · ${crit ? 'CRITICAL' : 'HIGH RISK'} · ${fmtT(s.t)} · ${s.observed ? 'observed' : 'forecast, p ' + pct(s.prob)}</title>`;
        g += crit
          ? `<circle cx="${cxp}" cy="${yy}" r="4.2" class="${s.observed ? 'mk-cr-o' : 'mk-cr-f'}" opacity="${op}">${tip}</circle>`
          : `<path d="M${cxp} ${yy - 5}l4.5 5-4.5 5-4.5-5z" class="${s.observed ? 'mk-hi-o' : 'mk-hi-f'}" opacity="${op}">${tip}</path>`;
      }
    });
    const nx = x(L.t);
    g += `<line x1="${nx}" x2="${nx}" y1="${top - 6}" y2="${H - 22}" class="c-now"/><text x="${nx + 5}" y="${top + 2}" class="c-nowl">${L.mode === 'historical' ? 'VIEW' : 'NOW'} ${fmtT(L.t)}</text>`;
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Predicted course: Cascade-R and system failures over 72 hours">${g}</svg>`;
  }

  function planHtml(L, plan) {
    const p = T.services.planner(L.e);
    if (!plan.ids.length) return `<p class="empty">No action in the catalogue lowers the expected critical facility-hours enough to be worth a crew at ${fmtT(L.t)}.</p>`;
    const r = plan.result, F = L.e.F;
    const acts = plan.ids.map((id) => p.CATALOG.find((a) => a.id === id));
    const used = acts.reduce((s, a) => s + a.cost, 0);
    const delta = (x) => (x >= 0 ? '−' : '+') + Math.abs(Math.round(x * 100)) + '%';
    return `
      <ol class="plan-list">${acts.map((a) => `<li><div class="pl-head"><b>${esc(a.label)}</b><span class="num faint">${a.cost} crew${a.cost > 1 ? 's' : ''}</span></div><p>${esc(a.detail)}</p>${a.side ? `<p class="pl-side">Side effect: ${esc(a.side)}</p>` : ''}</li>`).join('')}</ol>
      <p class="plan-out">Together (${used} of ${plan.budget} crews) they are expected to cut critical facility-hours by <b>${delta(r.reduction)}</b> (${r.base.critHours.toFixed(0)} → ${r.with.critHours.toFixed(0)}) and hospital and EMS critical hours by <b>${delta(r.careReduction)}</b>${r.cascadeBroken ? ', and to keep hospitals out of CRITICAL' : ''}.${r.sideEffects.length ? ` Side effects: ${r.sideEffects.map((s) => `${esc(F[s.i].name)} peaks ${Math.round(s.delta * 100)} points higher`).join('; ')}.` : ''}</p>
      <p class="pg-note">Greedy search by benefit per crew over ${p.CATALOG.length} actions at ${fmtT(L.t)}, re-simulated from that moment on the ensemble members that best match the evidence; nothing after ${fmtT(L.t)} is used. ${L.geo.id === 'raleigh' ? 'The actions are written for Raleigh.' : 'The actions are generated from the dependency graph (the facilities feeding the most consequential links get the remedies).'} Try other combinations in the 3D twin's Interventions drawer.</p>`;
  }

  T.router.register('/', {
    title: 'Overview',
    mount(ctx) { S.show(); render(ctx); },
    unmount() { token++; },
    update(ctx) { render(ctx); },
  });
})(typeof window !== 'undefined' ? window : globalThis);
