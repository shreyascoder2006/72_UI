/* Crisis pages: the registry at #/crises and one crisis at #/crises/<id>.

   Everything shown comes from the analytics on the shared engine (analytics.js): the
   crisis registry and Cascade-R at the issue time, and the engine's failure sequence
   and risk decomposition for the members. Times after the issue time are forecasts and
   are marked as such; the crisis history only covers times up to the issue time, since
   later registries would use information not yet available. */
(function (root) {
  const T = root.TWIN;
  const C = T.core, S = T.site, A = T.analytics;
  const { stateOf, fmtT } = C;
  const { esc } = S;
  const $ = (id) => document.getElementById(id);

  // ── Pieces shared with the overview ────────────────────────────────────
  const pct = (p) => Math.round(p * 100) + '%';
  const riskPill = (r) => { const st = stateOf(r); return `<span class="pill r-${st.key}"><span class="dot"></span>${st.label} · ${pct(r)}</span>`; };
  const stageTag = (c) => `<span class="stage-tag st-${c.stage.toLowerCase()}" title="${esc(STAGE_HELP[c.stage])}">${c.stage}</span>`;
  const STAGE_HELP = {
    Precursor: 'Forecast only: no member has crossed HIGH RISK yet.',
    Emerging: 'Members have crossed HIGH RISK; none is CRITICAL now.',
    Escalating: 'A member is CRITICAL and stress is rising or still spreading to new facilities.',
    Active: 'A member is CRITICAL and stress is holding steady.',
    Recovering: 'Stress is falling and no further member is forecast to cross HIGH RISK.',
  };
  const sysChips = (c) => A.SYS_ORDER.filter((g) => g in c.sys)
    .map((g) => `<span class="sys-chip r-${stateOf(c.sys[g]).key}"><span class="dot"></span>${A.SYS_LABEL[g]}</span>`).join('');
  function people(n) {
    if (n == null) return 'not modeled';
    if (n >= 1e6) return `≈${(n / 1e6).toFixed(2)} million`;
    if (n >= 1e4) return `≈${Math.round(n / 1000)},000`;
    return `≈${(Math.round(n / 100) * 100).toLocaleString('en-US')}`;
  }
  const places = (list, n = 3) => (list.length > n ? `${list.slice(0, n).join(', ')} and ${list.length - n} more` : list.join(', '));
  const at = (L, t) => `${fmtT(t)} <span class="faint">(${S.clockShort(L.e, t)})</span>`;
  function since(L, c) {
    return c.observed ? `since ${at(L, c.since)}` : `expected from ${at(L, c.since)}`;
  }
  function next(L, c) {
    if (!c.nextCrit) return '<span class="faint">none forecast</span>';
    const f = L.e.F[c.nextCrit.i];
    return `${esc(f.name)} at ${at(L, c.nextCrit.t)}, p ${pct(c.nextCrit.prob)}`;
  }
  const sysWord = (g) => (g === 'ems' ? 'EMS' : A.SYS_LABEL[g].toLowerCase());
  const crisisHref = (id) => S.href('/crises/' + encodeURIComponent(id), { c: null });
  const twinHref = (L, patch) => S.href('/twin', { t: L.follow ? null : L.t, ...patch });

  function row(L, c) {
    return `<article class="crisis-row">
      <div class="cr-id"><a href="${esc(crisisHref(c.id))}" class="num">${esc(c.id)}</a><span class="cr-type">${esc(c.type)}</span></div>
      <div class="cr-state">${stageTag(c)}${riskPill(c.maxR)}</div>
      <div class="cr-sys">${sysChips(c)}</div>
      <dl class="cr-facts">
        <div><dt>Began</dt><dd>${since(L, c)}</dd></div>
        <div><dt>Facilities</dt><dd><span class="num">${c.members.length}</span>${c.nCrit ? ` · <span class="num">${c.nCrit}</span> critical` : ''}</dd></div>
        <div><dt>Districts</dt><dd>${esc(places(c.districts))}</dd></div>
        <div><dt>Residents in footprint <span class="faint">(modeled)</span></dt><dd class="num">${people(c.people)}</dd></div>
        <div class="wide"><dt>Next to go critical</dt><dd>${next(L, c)}</dd></div>
      </dl>
      <a class="cr-more" href="${esc(crisisHref(c.id))}" aria-label="Details of ${esc(c.id)}">Details →</a>
    </article>`;
  }
  function interactions(L, reg, only) {
    const F = L.e.F;
    const items = reg.links.filter((l) => only == null || l.from === only || l.to === only).map((l) => {
      const a = reg.list[l.from], b = reg.list[l.to];
      const ln = (c) => `<a href="${esc(crisisHref(c.id))}" class="num">${esc(c.id)}</a>`;
      if (l.kind === 'couples') {
        const ed = L.e.E[l.edge];
        return `<li><span class="ix-kind">Coupling</span>${ln(a)} can pass stress into ${ln(b)} through ${esc(F[ed.from].name)} → ${esc(F[ed.to].name)} <span class="faint">(learned weight ${l.mean.toFixed(2)}, lag ${l.lag} h)</span></li>`;
      }
      return `<li><span class="ix-kind">Contention</span>${ln(a)} and ${ln(b)} both load ${esc(F[l.fac].name)} <span class="faint">(combined link weight ${l.load.toFixed(2)})</span></li>`;
    });
    return items.length ? `<ul class="ix-list">${items.join('')}</ul>` : '';
  }

  // Registry at each hour up to the issue time, computed a few hours per frame.
  async function history(L, alive) {
    const out = [];
    for (let kk = 0; kk <= L.k; kk += 2) {
      out.push({ k: kk, list: L.an.crises(kk).list });
      if (kk % 12 === 10) { await S.nextFrame(); if (!alive()) return null; }
    }
    if (L.k % 2) out.push({ k: L.k, list: L.an.crises(L.k).list });
    return out;
  }
  // Gantt of crises over time: one row per crisis, coloured by its worst member's state.
  function gantt(L, hist, focus) {
    const e = L.e, W = 1000, rowH = 22, padL = 128, padT = 22;
    const ids = [];
    for (const h of hist) for (const c of h.list) if (!ids.includes(c.id) && (!focus || c.id === focus)) ids.push(c.id);
    if (!ids.length) return '';
    const x = (t) => padL + (t / e.HOURS) * (W - padL - 8);
    const H = padT + ids.length * rowH + 8;
    let cells = '';
    ids.forEach((id, r) => {
      for (const h of hist) {
        const c = h.list.find((cc) => cc.id === id);
        if (!c) continue;
        const t = h.k * e.DT, col = C.RISK_HEX[stateOf(c.maxR).key];
        cells += `<rect x="${x(t).toFixed(1)}" y="${padT + r * rowH + 4}" width="${(x(t + 1) - x(t) + 0.4).toFixed(1)}" height="${rowH - 8}" fill="${col}" opacity="${c.observed ? 0.85 : 0.35}"><title>${esc(id)} · ${fmtT(t)} · ${c.stage} · ${pct(c.maxR)}</title></rect>`;
      }
    });
    const labels = ids.map((id, r) => `<a href="${esc(crisisHref(id))}"><text x="0" y="${padT + r * rowH + rowH / 2 + 4}" class="g-label">${esc(id)}</text></a>`).join('');
    let ticks = '';
    for (let t = 0; t <= e.HOURS; t += 12) ticks += `<line x1="${x(t)}" x2="${x(t)}" y1="${padT - 4}" y2="${H - 6}" class="g-grid"/><text x="${x(t)}" y="12" class="g-tick" text-anchor="middle">${esc(S.clockShort(e, t))}</text>`;
    const nowX = x(L.t);
    const later = L.t < e.HOURS ? `<rect x="${nowX}" y="${padT - 4}" width="${x(e.HOURS) - nowX}" height="${H - padT - 2}" class="g-later"/><text x="${nowX + 6}" y="${padT + 10}" class="g-note">not known yet at ${fmtT(L.t)}</text>` : '';
    return `<svg class="gantt" viewBox="0 0 ${W} ${H}" role="img" aria-label="Crises over time">${ticks}${later}${cells}<line x1="${nowX}" x2="${nowX}" y1="${padT - 6}" y2="${H - 4}" class="g-now"/>${labels}</svg>`;
  }

  // ── #/crises ───────────────────────────────────────────────────────────
  let token = 0;
  async function renderRegistry(ctx) {
    const my = ++token, alive = () => my === token;
    S.header('/crises');
    let L;
    try { L = await S.load(ctx, S.busy); } catch (err) { S.fail(err); return; }
    if (!alive()) return;
    S.settle(L); S.header('/crises', L);
    const { e, an, k } = L;
    const reg = an.crises(k), cr = an.cascadeR(k), cx = an.crossing(k);
    const R = e.stateAt(k).risk;
    const lede = `Connected sets of stressed facilities in ${esc(L.geo.city)}, joined where stress flows along a learned dependency link or where the forecast carries it there. A facility counts once it has crossed HIGH RISK and is still stressed, or is forecast to cross it within 24 h with probability of at least 50%.`;
    const sys = reg.systems.map((g) => {
      const s = cr.bySys[g] || { net: 0, haz: 0 }, tot = Math.max(0.0001, s.net + s.haz);
      return `<div class="rbar"><span class="rbar-k">${A.SYS_LABEL[g]}</span><span class="rbar-track"><i class="net" style="width:${(100 * s.net / Math.max(1, maxTot(cr))).toFixed(1)}%"></i><i class="haz" style="width:${(100 * s.haz / Math.max(1, maxTot(cr))).toFixed(1)}%"></i></span><span class="rbar-v num">${tot < 0.01 ? '—' : pct(s.net / tot) + ' via links'}</span></div>`;
    }).join('');
    $('page').innerHTML = `
      <div class="pg-wrap">
        <header class="pg-head">
          <h1>Crises <span class="pg-count num">${reg.list.length}</span></h1>
          <p class="pg-lede">${lede}</p>
          <p class="pg-asof">As issued at ${at(L, L.t)}${L.mode === 'historical' ? ' · replay' : ''}. ${esc(L.scen.label)} · <span class="faint">${esc(L.scen.provenance ? L.scen.provenance.label : 'Simulation')}</span></p>
        </header>
        <div class="pg-grid two">
          <section class="pg-card" aria-labelledby="crH">
            <h2 id="crH">Cascade-R <span class="num cr-big r-${cr.r >= 1 ? 'critical' : cr.r >= 0.6 ? 'high' : 'normal'}">${cr.r.toFixed(2)}</span></h2>
            <p>${crText(L, cr, cx)}</p>
            <div class="rbars" aria-label="Stress by system: through links and from the hazard">${sys}</div>
            <p class="legend-line"><i class="sw net"></i>through dependency links <i class="sw haz"></i>from the hazard directly</p>
          </section>
          <section class="pg-card map-card" aria-label="Crisis footprints">
            ${S.cityMap({ L, R, crises: reg.list, link: crisisHref })}
            <p class="map-note">Footprint: 650 m around each member facility. Dots are monitored facilities in their current state. <a href="${esc(twinHref(L, { c: reg.list[0] ? reg.list[0].id : null, a: null }))}">Open the footprints on the 3D twin →</a></p>
          </section>
        </div>
        <section class="pg-sec" aria-labelledby="regH">
          <h2 id="regH">Registry</h2>
          ${reg.list.length ? reg.list.map((c) => row(L, c)).join('') : `<p class="empty">No crisis at ${fmtT(L.t)}. Facilities are within their normal bands or stressed only briefly.</p>`}
        </section>
        ${reg.links.length ? `<section class="pg-sec"><h2>Interactions</h2>${interactions(L, reg)}</section>` : ''}
        <section class="pg-sec" aria-labelledby="hisH">
          <h2 id="hisH">Over time</h2>
          <p class="pg-note">The registry as it was issued each hour up to ${fmtT(L.t)}. Faded: forecast-only (precursor) at that hour.</p>
          <div id="crHist" class="hist"><div class="loading-bar"><i></i></div></div>
        </section>
      </div>`;
    const hist = await history(L, alive);
    if (!hist || !alive()) return;
    $('crHist').innerHTML = gantt(L, hist) || '<p class="empty">No crisis before this time.</p>';
  }
  const maxTot = (cr) => Math.max(...Object.values(cr.bySys).map((s) => s.net + s.haz), 0.0001);
  function crText(L, cr, cx) {
    const now = cr.r >= 1
      ? 'More stress is travelling through dependency links than arriving from the hazard: the cascade is feeding itself.'
      : cr.haz + cr.net < 0.05 ? 'Facilities are near their baselines; neither the hazard nor the network is adding stress.'
      : 'The hazard is putting more stress on facilities than the dependency network is passing between them.';
    const when = cx ? (cx.now ? '' : ` Forecast to reach 1 at ${at(L, cx.t)}.`) : ' Not forecast to reach 1 within the 72 h window.';
    return `${now}${when}`;
  }

  T.router.register('/crises', {
    title: 'Crises',
    mount(ctx) { S.show(); renderRegistry(ctx); },
    unmount() { token++; },
    update(ctx) { renderRegistry(ctx); },
  });

  // ── #/crises/<id> ──────────────────────────────────────────────────────
  let detailId = null;
  async function renderDetail(ctx) {
    const my = ++token, alive = () => my === token, id = detailId;
    S.header('/crises/' + id);
    let L;
    try { L = await S.load(ctx, S.busy); } catch (err) { S.fail(err); return; }
    if (!alive()) return;
    S.settle(L); S.header('/crises/' + id, L);
    const { e, an, k } = L, F = e.F, N = e.N;
    const reg = an.crises(k);
    const n = reg.list.findIndex((c) => c.id === id);
    const crumbs = `<nav class="pg-crumbs" aria-label="Breadcrumb"><a data-nav="/crises" href="${esc(S.href('/crises', { c: null }))}">Crises</a><span>›</span><span class="num">${esc(id)}</span></nav>`;
    if (n < 0) {
      $('page').innerHTML = `<div class="pg-wrap">${crumbs}
        <header class="pg-head"><h1 class="num">${esc(id)}</h1><p class="pg-lede">Not in the registry at ${at(L, L.t)} for ${esc(L.scen.label)} in ${esc(L.geo.city)}. A crisis keeps its ID while its root facility stays the same; as forecasts update, the same event can be listed under another ID.</p>
          <p class="pg-asof">As issued at ${at(L, L.t)}${L.mode === 'historical' ? ' · replay' : ''}.</p></header>
        <section class="pg-sec"><h2>When it is in the registry</h2><div id="crHist" class="hist"><div class="loading-bar"><i></i></div></div></section></div>`;
      const hist = await history(L, alive);
      if (!hist || !alive()) return;
      const hits = hist.filter((h) => h.list.some((c) => c.id === id)).map((h) => h.k * e.DT);
      $('crHist').innerHTML = hits.length
        ? `<p>Up to ${fmtT(L.t)} it appears at ${spans(hits).map(([a, b]) => `<a href="${esc(S.href('/crises/' + encodeURIComponent(id), { t: b }))}">${fmtT(a)}–${fmtT(b)}</a>`).join(', ')}.</p>${gantt(L, hist, id)}`
        : `<p class="empty">It does not appear in any registry issued up to ${fmtT(L.t)}${L.mode === 'live' ? '. It may form later; the registry is only known up to the simulated now' : ''}.</p>`;
      return;
    }
    const c = reg.list[n], set = c.set;
    const seq = e.cascade(k).filter((s) => set.has(s.i));
    const firstOf = new Map(), critOf = new Map();
    for (const s of seq) { if (s.level === 'HIGH RISK' && !firstOf.has(s.i)) firstOf.set(s.i, s); if (s.level === 'CRITICAL' && !critOf.has(s.i)) critOf.set(s.i, s); }
    // Where the members' stress comes from now: hazard directly or through links.
    let viaLinks = 0, fromHaz = 0;
    const rows = c.members.map((i) => {
      const ex = e.explain(k, i);
      const top = ex.drivers.filter((d) => d.kind !== 'base' && d.value > 0.005)[0];
      for (const d of ex.drivers) { if (d.kind === 'edge') viaLinks += Math.max(0, d.value); else if (d.kind === 'hazard') fromHaz += Math.max(0, d.value); }
      const driver = !top ? '<span class="faint">baseline</span>' : top.kind === 'hazard' ? esc(top.label) : `via ${esc(F[top.from].name)}`;
      const hi = firstOf.get(i), cr = critOf.get(i);
      const ev = (s) => (!s ? '<span class="faint">—</span>' : s.observed ? `${fmtT(s.t)}` : `<span class="fc">~${fmtT(s.t)} · p ${pct(s.prob)}</span>`);
      return `<tr>
        <td><a href="${esc(twinHref(L, { a: F[i].id, c: c.id }))}">${esc(F[i].name)}</a><div class="faint num">${esc(F[i].id)}</div></td>
        <td>${A.SYS_LABEL[A.group(e.kinds[i])]}</td><td>${esc(F[i].district)}</td>
        <td>${riskPill(e.now[k * N + i])}</td><td>${driver}${top ? ` <span class="faint">${pct(top.share)}</span>` : ''}</td>
        <td>${ev(hi)}</td><td>${ev(cr)}</td></tr>`;
    }).join('');
    const tot = viaLinks + fromHaz;
    const root0 = F[c.root];
    const story = c.observed
      ? `It began at ${esc(root0.name)} (${sysWord(A.group(e.kinds[c.root]))}, ${esc(root0.district)}) at ${at(L, c.since)}`
      : `The forecast has it beginning at ${esc(root0.name)} (${sysWord(A.group(e.kinds[c.root]))}, ${esc(root0.district)}) around ${at(L, c.since)}`;
    const span = `and spans ${c.members.length} facilit${c.members.length > 1 ? 'ies' : 'y'} in ${A.SYS_ORDER.filter((g) => g in c.sys).map(sysWord).join(', ')} across ${esc(places(c.districts, 4))}.`;
    const crit = c.nCrit ? `${c.nCrit} ${c.nCrit > 1 ? 'are' : 'is'} CRITICAL now.` : 'None is CRITICAL now.';
    const share = tot > 0.05 ? ` Of the stress on its members, ${pct(viaLinks / tot)} arrives through dependency links and ${pct(fromHaz / tot)} from the hazard directly.` : '';
    const SHOW = 28;
    const events = seq.slice(0, SHOW).map((s) => `<li class="${s.observed ? 'obs' : 'fc'}">
        <span class="ev-t num">${fmtT(s.t)}</span><span class="ev-c">${esc(S.clockShort(e, s.t))}</span>
        <span class="ev-l ${s.level === 'CRITICAL' ? 'r-critical' : 'r-high'}"><span class="dot"></span>${s.level === 'CRITICAL' ? 'Critical' : 'High risk'}</span>
        <span class="ev-f">${esc(F[s.i].name)}</span><span class="ev-p">${s.observed ? 'observed' : 'forecast · p ' + pct(s.prob)}</span></li>`).join('');
    const ix = interactions(L, reg, n);
    $('page').innerHTML = `
      <div class="pg-wrap">
        ${crumbs}
        <header class="pg-head">
          <h1>${esc(c.type)} <span class="num pg-id">${esc(c.id)}</span></h1>
          <div class="cr-state">${stageTag(c)}${riskPill(c.maxR)}<span class="faint">${esc(STAGE_HELP[c.stage])}</span></div>
          <p class="pg-lede">${story} ${span} ${crit}${share}</p>
          <p class="pg-asof">As issued at ${at(L, L.t)}${L.mode === 'historical' ? ' · replay' : ''}. ${esc(L.scen.label)} · <span class="faint">${esc(L.scen.provenance ? L.scen.provenance.label : 'Simulation')}</span></p>
        </header>
        <div class="pg-grid two">
          <section class="pg-card">
            <dl class="cr-facts big">
              <div><dt>Began</dt><dd>${since(L, c)}</dd></div>
              <div><dt>Systems</dt><dd>${sysChips(c)}</dd></div>
              <div><dt>Residents in footprint <span class="faint">(modeled)</span></dt><dd class="num">${people(c.people)}</dd></div>
              <div><dt>Next to go critical</dt><dd>${next(L, c)}</dd></div>
            </dl>
            <div class="pg-actions"><a class="btn" href="${esc(twinHref(L, { c: c.id, a: null }))}">${T.icons.UI.home} Open on the 3D twin</a></div>
          </section>
          <section class="pg-card map-card" aria-label="Footprint">
            ${S.cityMap({ L, R: e.stateAt(k).risk, crises: reg.list, focus: c.id, fit: c.id, link: crisisHref, label: `Footprint of ${c.id}` })}
            <p class="map-note">Footprint: 650 m around each member. Residents are the modeled population whose nearest monitored facility is a member.</p>
          </section>
        </div>
        <section class="pg-sec" aria-labelledby="seqH">
          <h2 id="seqH">How it propagates</h2>
          <p class="pg-note">Each member's first crossing of HIGH RISK and CRITICAL, in order. Observed up to ${fmtT(L.t)}; after that, the ensemble's median time and the probability that it happens at all.</p>
          <ol class="events">${events}</ol>${seq.length > SHOW ? `<p class="pg-note" style="margin-top:8px">and ${seq.length - SHOW} later crossings; the members table lists every facility's.</p>` : ''}
        </section>
        <section class="pg-sec" aria-labelledby="memH">
          <h2 id="memH">Members</h2>
          <div class="tbl-wrap"><table class="tbl">
            <thead><tr><th>Facility</th><th>System</th><th>District</th><th>Now</th><th>Main driver now <span class="faint">(share of risk)</span></th><th>High risk</th><th>Critical</th></tr></thead>
            <tbody>${rows}</tbody></table></div>
        </section>
        ${ix ? `<section class="pg-sec"><h2>Interactions with other crises</h2>${ix}</section>` : ''}
        <section class="pg-sec">
          <h2>Over time</h2>
          <p class="pg-note">This crisis in each hourly registry up to ${fmtT(L.t)}. Faded: forecast-only at that hour.</p>
          <div id="crHist" class="hist"><div class="loading-bar"><i></i></div></div>
        </section>
      </div>`;
    const hist = await history(L, alive);
    if (!hist || !alive()) return;
    $('crHist').innerHTML = gantt(L, hist, c.id);
  }
  // Consecutive hours → [first, last] spans.
  function spans(ts) {
    const out = [];
    for (const t of ts) { const last = out[out.length - 1]; if (last && t - last[1] <= 1.01) last[1] = t; else out.push([t, t]); }
    return out;
  }

  T.router.register('/crises/:id', {
    title: (p) => p.id,
    mount(ctx, params) { detailId = String(params.id).toUpperCase(); S.show(); renderDetail(ctx); },
    unmount() { token++; },
    update(ctx) { renderDetail(ctx); },
  });

  T.crisisView = { row, riskPill, stageTag, sysChips, people, places, since, next, crisisHref, twinHref, interactions, crText, at };
})(typeof window !== 'undefined' ? window : globalThis);
