/* The Crises page at #/crises: a board of linked analytical views, independent of the
   3D twin (no map, no renderer).

   - Cascade-R: the city figure and, per system, how much stress arrives directly from
     the hazard against through learned dependency links (analytics.cascadeR).
   - Dependency network: the learned links between facilities (engine.edgesAt), drawn
     between systems or between facilities, with a compact inspector.
   - Crisis timeline: Cascade-R observed then forecast, or the selected facility's risk
     with its forecast 10-90% band, and the predicted threshold crossings.
   - Registry, system impact matrix (stress flowing now along learned links, system to
     system), critical facilities, and recent sensor evidence.

   One selection (crisis, system, facility or link) drives every view. Time is the shared
   context: clicking the timeline moves it, and the page redraws from the same engine
   state. Nothing here starts a timer. */
(function (root) {
  const T = root.TWIN;
  const C = T.core, S = T.site, A = T.analytics, V = T.crisisView;
  const { stateOf, fmtT } = C;
  const { esc } = S;
  const $ = (id) => document.getElementById(id);
  const pct = (p) => Math.round(p * 100) + '%';
  const SYS_SHORT = { hazard: 'Hazard', drainage: 'Drainage', traffic: 'Roads', power: 'Power', telecom: 'Telecom', ems: 'EMS', hospital: 'Hospitals' };

  let token = 0, L = null, M = null;
  let sel = { crisis: null, sys: null, fac: null, edge: null }, view = 'systems', query = '', facsAll = false;
  const series = new Map(); // Cascade-R series per city|scenario|k|mode

  // ── Model: everything the views read, computed once per issue time ─────
  function model(L) {
    const e = L.e, k = L.k, an = L.an, F = e.F, N = e.N;
    const R = e.stateAt(k).risk, trust = e.stateAt(k).trust;
    const reg = an.crises(k), seq = e.cascade(k), cr = an.cascadeR(k);
    const kPrev = Math.max(0, k - 12), crPrev = an.cascadeR(kPrev);
    const eps = e.edgesAt(k);
    const facs = F.map((f, i) => i).filter((i) => e.kinds[i] !== 'weather');
    const sysOf = (i) => A.group(e.kinds[i]);
    const systems = A.SYS_ORDER.filter((g) => facs.some((i) => sysOf(i) === g));
    const links = e.E.map((ed, q) => ({ q, from: ed.from, to: ed.to, a: sysOf(ed.from), b: sysOf(ed.to), ...eps[q], lag: ed.lag * e.DT, mech: ed.mechanism }));
    return { e, k, R, trust, reg, seq, cr, crPrev, kPrev, facs, sysOf, systems, links, F, N };
  }
  // What the current selection narrows the views to.
  function scope() {
    const c = sel.crisis && M.reg.list.find((x) => x.id === sel.crisis);
    const set = c ? c.set : null;
    return { c, set, inScope: (i) => !set || set.has(i) };
  }
  const STATUS_RANK = { confirmed: 3, candidate: 2, pruned: 1 };

  // ── Page ───────────────────────────────────────────────────────────────
  async function render(ctx) {
    const my = ++token, alive = () => my === token;
    S.header('/crises');
    try { L = await S.load(ctx, S.busy); } catch (err) { S.fail(err); return; }
    if (!alive()) return;
    S.settle(L); S.header('/crises', L);
    M = model(L);
    if (sel.crisis && !M.reg.list.some((c) => c.id === sel.crisis)) sel = { crisis: null, sys: null, fac: null, edge: null };
    if (!sel.crisis && ctx.c && M.reg.list.some((c) => c.id === ctx.c)) sel.crisis = ctx.c;
    // With exactly one crisis there is nothing to choose, so it is the context by default
    // rather than leaving the most important panels asking for a click.
    if (!sel.crisis && M.reg.list.length === 1) sel.crisis = M.reg.list[0].id;
    $('page').innerHTML = `
      <div class="pg-wrap bd-wrap">
        <header class="pg-head bd-head">
          <h1>Crises <span class="pg-count num">${M.reg.list.length}</span></h1>
          <p class="pg-lede">Connected sets of stressed facilities in ${esc(L.geo.city)}, joined where stress flows along a learned dependency link or where the forecast carries it there. A facility counts once it has crossed HIGH RISK and is still stressed, or is forecast to cross it within 24 h with probability of at least 50%.</p>
          <p class="pg-asof">As issued at ${V.at(L, L.t)}${L.mode === 'historical' ? ' · replay' : ''} · ${esc(L.scen.label)} · ${esc(L.scen.provenance ? L.scen.provenance.label : 'Simulation')}</p>
        </header>
        <div class="bd-row bd-top">
          <section class="bd-card" id="bdCR" aria-labelledby="bdCRh"></section>
          <section class="bd-card" id="bdNet" aria-labelledby="bdNeth"></section>
        </div>
        <section class="bd-card bd-tl" id="bdTL" aria-labelledby="bdTLh"></section>
        <div class="bd-row bd-four">
          <div class="bd-col">
            <section class="bd-card" id="bdReg" aria-labelledby="bdRegh"></section>
            <section class="bd-card" id="bdFac" aria-labelledby="bdFach"></section>
          </div>
          <div class="bd-col">
            <section class="bd-card" id="bdMx" aria-labelledby="bdMxh"></section>
            <section class="bd-card" id="bdEv" aria-labelledby="bdEvh"></section>
          </div>
        </div>
      </div>`;
    wire();
    draw();
    // The Cascade-R course takes a few hundred milliseconds; the timeline fills in after.
    const key = `${L.geo.id}|${L.scen.id}|${L.k}|${L.mode}`;
    if (!series.has(key)) {
      await S.nextFrame();
      if (!alive()) return;
      const an = L.an, e = L.e, past = [], fut = [];
      for (let kk = 0; kk <= L.k; kk += 2) past.push([kk * e.DT, an.cascadeR(kk).r]);
      if (L.k % 2) past.push([L.t, M.cr.r]);
      await S.nextFrame();
      if (!alive()) return;
      for (let kk = L.k + 2; kk < e.K; kk += 2) fut.push([kk * e.DT, an.cascadeR(L.k, kk).r]);
      series.set(key, { past, fut });
      if (series.size > 8) series.delete(series.keys().next().value);
    }
    if (alive()) drawTimeline();
  }
  function draw() { drawCR(); drawNet(); drawTimeline(); drawReg(); drawMatrix(); drawFacilities(); drawEvidence(); }

  // ── Selection ──────────────────────────────────────────────────────────
  function select(patch) {
    sel = { ...sel, ...patch };
    if ('crisis' in patch) T.store.set({ c: sel.crisis }); // kept in the link, no redraw from the store
    draw();
  }
  let wired = false;
  function wire() {
    if (wired) return;
    wired = true;
    const page = $('page');
    page.addEventListener('click', (ev) => {
      const t = ev.target;
      if (t.closest('a')) return;
      const b = t.closest('[data-crisis],[data-sys],[data-fac],[data-edge],[data-view]');
      if (b && b.dataset.view) { view = b.dataset.view; drawNet(); return; }
      if (b && b.dataset.crisis != null) { const id = b.dataset.crisis; select({ crisis: sel.crisis === id ? null : id, sys: null, fac: null, edge: null }); return; }
      if (b && b.dataset.edge) { select({ edge: sel.edge === b.dataset.edge ? null : b.dataset.edge, sys: null, fac: null }); return; }
      if (b && b.dataset.sys) { select({ sys: sel.sys === b.dataset.sys ? null : b.dataset.sys, fac: null, edge: null }); return; }
      if (b && b.dataset.fac != null) { const i = +b.dataset.fac; select({ fac: sel.fac === i ? null : i, sys: M.sysOf(i), edge: null }); return; }
      // A click on the timeline's plot area moves the shared time.
      const svg = t.closest('#bdTLsvg');
      if (svg && !t.closest('[data-fac]')) {
        const r = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal;
        const x = ((ev.clientX - r.left) / r.width) * vb.width;
        const tt = Math.round(((x - TL.padL) / (vb.width - TL.padL - TL.padR)) * M.e.HOURS * 2) / 2;
        if (tt >= 0 && tt <= M.e.HOURS) T.store.set({ t: tt }, { push: true, notify: true });
      }
    });
    page.addEventListener('input', (ev) => { if (ev.target.id === 'bdSearch') { query = ev.target.value; drawReg(true); } });
    // Rows, matrix cells and the show-all toggle are reachable without a mouse.
    page.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      const t = ev.target;
      if (t.id === 'bdFacMore') { ev.preventDefault(); facsAll = !facsAll; drawFacilities(); $('bdFacMore') && $('bdFacMore').focus(); return; }
      if (t.matches('[data-fac],[data-edge],[data-sys],[data-crisis]')) { ev.preventDefault(); t.click(); }
    });
    page.addEventListener('click', (ev) => {
      if (ev.target.id === 'bdFacMore') { facsAll = !facsAll; drawFacilities(); const b = $('bdFacMore'); if (b) b.focus(); }
    });
  }

  // ── Cascade-R ──────────────────────────────────────────────────────────
  // Two things the operator needs and a single number cannot carry: how much stress each
  // system is under (bar length, against the worst system) and where it comes from (the
  // split inside the bar). A low figure now is not safety if the forecast crosses later,
  // so the state line says which of those two situations this is.
  function crState(cr, cross) {
    if (cr.r >= 1) return { key: 'critical', head: 'Self-sustaining now', body: 'More stress is moving through learned dependency links than the hazard is applying directly. Stopping the hazard no longer stops the cascade: the links have to be cut.' };
    if (cross && !cross.now) {
      const inH = cross.t - L.t;
      return {
        key: inH <= 12 ? 'high' : 'watch',
        head: `Below the threshold now · forecast to cross at ${fmtT(cross.t)}`,
        body: `The cascade is not feeding itself yet, but on the evidence available at ${fmtT(L.t)} it is forecast to reach 1 in ${C.fmtDur(inH)}, at ${esc(S.clockShort(M.e, cross.t))}. Acting before then is acting on the hazard; after it, on the links.`,
      };
    }
    return { key: 'normal', head: 'Below the threshold', body: `Stress is arriving from the hazard rather than circulating through the network, and is not forecast to cross 1 within the window. This is a hazard problem, not yet a cascade.` };
  }
  function drawCR() {
    const { cr, crPrev, kPrev, systems, e } = M, sc = scope();
    const d = cr.r - crPrev.r;
    const cross = L.an.crossing(M.k);
    const st = crState(cr, cross);
    // Bar length is magnitude against the worst system; the split inside it is the source.
    const tot = (g) => { const x = cr.bySys[g] || { net: 0, haz: 0 }; return x.net + x.haz; };
    const peak = Math.max(0.02, ...systems.map(tot));
    const rows = systems.map((g) => {
      const x = cr.bySys[g] || { net: 0, haz: 0 }, t = x.net + x.haz;
      const quiet = t < 0.02;
      const w = (t / peak) * 100;
      const on = sel.sys === g, inC = !!(sc.c && g in sc.c.sys);
      const share = quiet ? '' : `${pct(x.haz / t)} hazard · ${pct(x.net / t)} links`;
      return `<button type="button" class="cr-row${on ? ' on' : ''}${inC ? ' inc' : ''}${quiet ? ' quiet' : ''}" data-sys="${g}" aria-pressed="${on}"
        title="${A.SYS_LABEL[g]} — total stress ${t.toFixed(2)}: ${x.haz.toFixed(2)} direct from the hazard, ${x.net.toFixed(2)} through learned links">
        <span class="cr-k">${SYS_SHORT[g]}</span>
        <span class="cr-track"><span class="cr-bar" style="width:${Math.max(quiet ? 0 : 1.5, w).toFixed(1)}%">
          <i class="haz" style="flex:${quiet ? 1 : x.haz || 0.0001}"></i><i class="net" style="flex:${quiet ? 0 : x.net || 0.0001}"></i></span></span>
        <span class="cr-v num">${quiet ? '<span class="faint">no stress</span>' : t.toFixed(2)}</span>
        <span class="cr-s">${quiet ? '' : share}</span></button>`;
    }).join('');
    $('bdCR').innerHTML = `
      <div class="bd-h"><h2 id="bdCRh">Cascade-R <span class="num cr-num r-${cr.r >= 1 ? 'critical' : cr.r >= 0.6 ? 'high' : 'normal'}">${cr.r.toFixed(2)}</span></h2>
        <span class="bd-delta ${d > 0.005 ? 'up' : d < -0.005 ? 'down' : ''}">${d > 0.005 ? '▲' : d < -0.005 ? '▼' : '='} ${Math.abs(d).toFixed(2)} <small>vs ${fmtT(kPrev * e.DT)}</small></span></div>
      <div class="cr-state r-${st.key}"><b>${esc(st.head)}</b><span>${st.body}</span></div>
      <div class="cr-rows" role="group" aria-label="Stress by system">${rows}</div>
      <p class="bd-legend"><i class="sw haz"></i>Direct from the hazard <i class="sw net"></i>Through learned links
        <span>Bar length is total stress against ${esc(SYS_SHORT[systems.reduce((a, g) => (tot(g) > tot(a) ? g : a), systems[0])] || '—')}, the worst system now.</span></p>`;
  }

  // ── Dependency network ─────────────────────────────────────────────────
  const POS = { hazard: [280, 32], drainage: [120, 98], traffic: [440, 98], power: [100, 172], telecom: [460, 172], ems: [205, 244], hospital: [355, 262] };
  function sysPairs(sc) {
    const pairs = new Map();
    for (const l of M.links) {
      if (l.a === l.b || (sc.set && !sc.set.has(l.from) && !sc.set.has(l.to))) continue;
      const key = l.a + '>' + l.b;
      const p = pairs.get(key) || { a: l.a, b: l.b, n: 0, status: 'pruned', flow: 0, best: null, counts: { confirmed: 0, candidate: 0, pruned: 0 } };
      p.n++; p.counts[l.status]++; p.flow += l.status === 'pruned' ? 0 : l.flow;
      if (STATUS_RANK[l.status] > STATUS_RANK[p.status]) p.status = l.status;
      if (!p.best || l.mean > p.best.mean) p.best = l;
      pairs.set(key, p);
    }
    return pairs;
  }
  function drawNet() {
    const sc = scope(), { systems, R, facs, sysOf, cr } = M;
    const pairs = sysPairs(sc);
    const sysState = (g) => stateOf(Math.max(0, ...facs.filter((i) => sysOf(i) === g).map((i) => R[i])));
    const trim = (p, q) => { const dx = q[0] - p[0], dy = q[1] - p[1]; const t = Math.min(52 / Math.abs(dx || 1e-6), 15 / Math.abs(dy || 1e-6), 1); return [p[0] + dx * t, p[1] + dy * t]; };
    const focus = sel.edge ? sel.edge.split('>') : sel.sys ? [sel.sys] : null;
    const lit = (a, b) => !focus || focus.includes(a) && (focus.length === 1 || focus.includes(b));
    let svg = '';
    if (view === 'systems') {
      const maxHaz = Math.max(0.01, ...systems.map((g) => (cr.bySys[g] || {}).haz || 0));
      // Direct hazard forcing (not a learned link).
      for (const g of systems) {
        const h = (cr.bySys[g] || {}).haz || 0;
        if (h < 0.01) continue;
        const [p, q] = [trim(POS.hazard, POS[g]), trim(POS[g], POS.hazard)];
        svg += `<path d="M${p[0]} ${p[1]}L${q[0]} ${q[1]}" class="ln haz${lit('hazard', g) ? '' : ' dim'}" style="stroke-width:${(0.8 + 2.4 * h / maxHaz).toFixed(2)}" marker-end="url(#ahz)"><title>Hazard → ${A.SYS_LABEL[g]}: direct forcing ${h.toFixed(2)}</title></path>`;
      }
      for (const p of pairs.values()) {
        if (!POS[p.a] || !POS[p.b]) continue;
        const [x1, y1] = POS[p.a], [x2, y2] = POS[p.b];
        const mx = (x1 + x2) / 2 + (y2 - y1) * 0.12, my = (y1 + y2) / 2 - (x2 - x1) * 0.12;
        const s0 = trim(POS[p.a], [mx, my]), s1 = trim(POS[p.b], [mx, my]);
        const key = p.a + '>' + p.b, on = sel.edge === key;
        const d = `M${s0[0].toFixed(1)} ${s0[1].toFixed(1)}Q${mx.toFixed(1)} ${my.toFixed(1)} ${s1[0].toFixed(1)} ${s1[1].toFixed(1)}`;
        svg += `<path d="${d}" class="hit" data-edge="${key}"/>`;
        svg += `<path d="${d}" class="ln ${p.status}${on ? ' on' : ''}${lit(p.a, p.b) ? '' : ' dim'}" style="stroke-width:${(1 + Math.min(3, p.flow * 8)).toFixed(2)}" marker-end="url(#a${p.status})" data-edge="${key}"><title>${A.SYS_LABEL[p.a]} → ${A.SYS_LABEL[p.b]}: ${p.n} links (${p.counts.confirmed} confirmed, ${p.counts.candidate} candidate, ${p.counts.pruned} pruned)</title></path>`;
      }
      svg += ['hazard', ...systems].map((g) => {
        const [x, y] = POS[g], st = g === 'hazard' ? null : sysState(g), on = sel.sys === g || (sc.c && g in sc.c.sys);
        return `<g class="nd${on ? ' on' : ''}${g === 'hazard' ? ' hz' : ' r-' + st.key}${focus && !focus.includes(g) && !(g === 'hazard' && focus.length === 1) ? ' dim' : ''}" data-sys="${g}" transform="translate(${x - 52} ${y - 15})">
          <rect width="104" height="30" rx="5"/><text x="52" y="20" text-anchor="middle">${g === 'hazard' ? esc(hazardName()) : SYS_SHORT[g]}</text></g>`;
      }).join('');
    } else {
      // Facilities in columns by system; links between them.
      const cols = systems, at = new Map();
      cols.forEach((g, c) => {
        const own = facs.filter((i) => sysOf(i) === g && (!sc.set || sc.set.has(i)));
        own.forEach((i, n) => at.set(i, [40 + c * ((520 - 40) / Math.max(1, cols.length - 1)), 34 + (n + 0.5) * (250 / Math.max(own.length, 1))]));
      });
      for (const l of M.links) {
        if (!at.has(l.from) || !at.has(l.to)) continue;
        const [x1, y1] = at.get(l.from), [x2, y2] = at.get(l.to);
        const on = sel.fac === l.from || sel.fac === l.to;
        svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="ln ${l.status} thin${sel.fac != null && !on ? ' dim' : ''}${on ? ' on' : ''}"><title>${esc(M.F[l.from].name)} → ${esc(M.F[l.to].name)} · ${l.status} · weight ${l.mean.toFixed(2)}</title></line>`;
      }
      cols.forEach((g, c) => { svg += `<text x="${40 + c * ((520 - 40) / Math.max(1, cols.length - 1))}" y="16" text-anchor="middle" class="col-h">${SYS_SHORT[g]}</text>`; });
      for (const [i, [x, y]] of at) {
        const st = stateOf(R[i]);
        svg += `<circle cx="${x}" cy="${y}" r="${sel.fac === i ? 7 : 5}" class="fn r-${st.key}${sel.fac === i ? ' on' : ''}" data-fac="${i}"><title>${esc(M.F[i].name)} · ${st.label} ${pct(R[i])}</title></circle>`;
      }
      if (!at.size) svg += '<text x="280" y="150" text-anchor="middle" class="col-h">No facility in the selected crisis</text>';
    }
    const any = [...pairs.values()].some((p) => p.status === 'confirmed');
    $('bdNet').innerHTML = `
      <div class="bd-h"><h2 id="bdNeth">Dependency network</h2>
        <div class="seg"><button type="button" data-view="systems" aria-pressed="${view === 'systems'}">Systems</button><button type="button" data-view="facilities" aria-pressed="${view === 'facilities'}">Facilities</button></div></div>
      <div class="net-wrap">
        <svg class="net" viewBox="0 0 560 290" role="img" aria-label="Learned dependency network">
          <defs>${['confirmed', 'candidate', 'pruned'].map((s) => `<marker id="a${s}" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L8 4L0 8z" class="mk ${s}"/></marker>`).join('')}<marker id="ahz" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L8 4L0 8z" class="mk haz"/></marker></defs>
          ${svg}</svg>
        <aside class="net-insp">${inspector(pairs)}</aside>
      </div>
      <p class="bd-legend"><i class="ln-k confirmed"></i>Confirmed <i class="ln-k candidate"></i>Candidate (awaiting evidence) <i class="ln-k pruned"></i>Pruned <i class="ln-k haz"></i>Direct hazard${any ? '' : ' <span>No link is confirmed yet at this time: the learner is still gathering evidence.</span>'}</p>`;
  }
  function hazardName() {
    const h = L.scen.hazardLabel;
    return (h && (h.drainage || h.power || h.traffic)) || (L.scen.rain && L.scen.id !== 'chlorine' ? 'Rainfall' : 'Hazard');
  }
  function inspector(pairs) {
    const { e, F, R, facs, sysOf, cr, seq, links } = M;
    if (sel.edge) {
      const p = pairs.get(sel.edge) || sysPairs({ set: null }).get(sel.edge);
      if (!p) return `<p class="ni-empty">No learned link between these systems.</p>`;
      const b = p.best;
      return `<h3>${A.SYS_LABEL[p.a]} → ${A.SYS_LABEL[p.b]}</h3>
        <span class="ni-tag ${p.status}">${p.status}</span>
        <dl><div><dt>Learned links</dt><dd>${p.n} · ${p.counts.confirmed} confirmed, ${p.counts.candidate} candidate, ${p.counts.pruned} pruned</dd></div>
        <div><dt>Stress flowing now</dt><dd class="num">${p.flow.toFixed(3)}</dd></div>
        <div><dt>Strongest</dt><dd>${esc(F[b.from].name)} → ${esc(F[b.to].name)}</dd></div>
        <div><dt>Weight</dt><dd class="num">${b.mean.toFixed(2)} ± ${b.sd.toFixed(2)} · lag ${b.lag} h · ${pct(b.learned)} from data</dd></div></dl>
        <p class="ni-note">${esc(b.mech || '')}</p>`;
    }
    if (sel.fac != null) {
      const i = sel.fac, f = F[i], st = stateOf(R[i]);
      const inb = links.filter((l) => l.to === i && l.status !== 'pruned').sort((a, b) => b.flow - a.flow)[0];
      const next = seq.find((s) => s.i === i && !s.observed);
      return `<h3>${esc(f.name)}</h3><span class="pill r-${st.key}"><span class="dot"></span>${st.label} · ${pct(R[i])}</span>
        <dl><div><dt>System</dt><dd>${A.SYS_LABEL[sysOf(i)]} · ${esc(f.district)}</dd></div>
        <div><dt>Next crossing</dt><dd>${next ? `${next.level === 'CRITICAL' ? 'CRITICAL' : 'HIGH RISK'} ~${fmtT(next.t)} · ${pct(next.prob)}` : 'none forecast'}</dd></div>
        <div><dt>Main inbound link</dt><dd>${inb ? `${esc(F[inb.from].name)} · ${inb.status} · flow ${inb.flow.toFixed(3)}` : 'none carrying stress'}</dd></div></dl>
        <p class="ni-go"><a href="${esc(S.href('/twin', { a: f.id }))}">Inspect in City twin →</a></p>`;
    }
    const g = sel.sys;
    if (g === 'hazard') {
      const rows = M.systems.map((s) => [s, (cr.bySys[s] || {}).haz || 0]).sort((a, b) => b[1] - a[1]).filter((x) => x[1] > 0.01);
      return `<h3>${esc(hazardName())}</h3><span class="ni-tag haz">direct forcing</span>
        <p class="ni-note">${esc(L.scen.blurb)}</p>
        <dl>${rows.slice(0, 4).map(([s, h]) => `<div><dt>${A.SYS_LABEL[s]}</dt><dd class="num">${h.toFixed(2)}</dd></div>`).join('') || '<div><dt>Now</dt><dd>no direct stress</dd></div>'}</dl>`;
    }
    if (g) {
      const own = facs.filter((i) => sysOf(i) === g), st = stateOf(Math.max(...own.map((i) => R[i])));
      const out = links.filter((l) => l.a === g && l.b !== g && l.status !== 'pruned'), inn = links.filter((l) => l.b === g && l.a !== g && l.status !== 'pruned');
      const lag = out.length ? out.reduce((s, l) => s + l.lag, 0) / out.length : null;
      const first = seq.find((s) => sysOf(s.i) === g && s.level === 'CRITICAL' && (s.observed || s.prob >= 0.5));
      return `<h3>${A.SYS_LABEL[g]}</h3><span class="pill r-${st.key}"><span class="dot"></span>${st.label}</span>
        <dl><div><dt>Facilities</dt><dd>${own.length} · ${own.filter((i) => R[i] >= C.CRIT).length} critical now</dd></div>
        <div><dt>Links out / in</dt><dd>${out.length} / ${inn.length} <span class="faint">(${out.filter((l) => l.status === 'confirmed').length} / ${inn.filter((l) => l.status === 'confirmed').length} confirmed)</span></dd></div>
        <div><dt>Avg lag downstream</dt><dd>${lag == null ? '—' : lag.toFixed(1) + ' h'}</dd></div>
        <div><dt>First CRITICAL</dt><dd>${first ? `${esc(F[first.i].name)} · ${first.observed ? 'observed' : '~'}${fmtT(first.t)}${first.observed ? '' : ' · ' + pct(first.prob)}` : 'none forecast'}</dd></div></dl>`;
    }
    // Nothing picked: the selected crisis is the context, and failing that the city.
    const c = scope().c;
    if (c) {
      const sys = Object.entries(c.sys).sort((a, b) => b[1] - a[1]);
      const st = stateOf(c.maxR);
      return `<h3>${esc(c.id)}</h3><span class="pill r-${st.key}"><span class="dot"></span>${esc(c.type)} · ${esc(c.stage)}</span>
        <dl><div><dt>Facilities</dt><dd>${c.members.length} across ${sys.length} system${sys.length > 1 ? 's' : ''}</dd></div>
        <div><dt>Began at</dt><dd>${esc(F[c.root].name)} · ${fmtT(c.since)}</dd></div>
        <div><dt>Next CRITICAL</dt><dd>${c.nextCrit ? `${esc(F[c.nextCrit.i].name)} ~${fmtT(c.nextCrit.t)} · ${pct(c.nextCrit.prob)}` : 'none forecast'}</dd></div>
        <div><dt>Worst system</dt><dd>${A.SYS_LABEL[sys[0][0]]} · ${pct(sys[0][1])}</dd></div></dl>
        <p class="ni-note">Pick a system box, a link or a facility to look inside this crisis.</p>`;
    }
    const worst = facs.slice().sort((a, b) => R[b] - R[a])[0];
    const wst = worst == null ? null : stateOf(R[worst]);
    const n = M.reg.list.length;
    return `<h3>${esc(L.geo.city)}</h3><span class="pill r-${wst ? wst.key : 'normal'}"><span class="dot"></span>${n ? `${n} crises · none selected` : `No crisis at ${fmtT(L.t)}`}</span>
      <dl><div><dt>Facilities watched</dt><dd>${facs.length}</dd></div>
      <div><dt>Most stressed</dt><dd>${worst == null ? '—' : `${esc(F[worst].name)} · ${pct(R[worst])}`}</dd></div>
      <div><dt>Links confirmed</dt><dd>${links.filter((l) => l.status === 'confirmed').length} of ${links.length}</dd></div></dl>
      <p class="ni-note">${n ? 'Pick a crisis in the registry to focus every panel on it, or a system box to look across all of them.' : 'Pick a system box or a link to see what the learner has established so far.'}</p>`;
  }

  // ── Timeline ───────────────────────────────────────────────────────────
  const TL = { W: 1000, H: 196, padL: 44, padR: 14, top: 62, bot: 26 };
  function drawTimeline() {
    const { e, seq, F, sysOf } = M, sc = scope(), tI = L.t;
    const x = (t) => TL.padL + (t / e.HOURS) * (TL.W - TL.padL - TL.padR);
    const plotH = TL.H - TL.top - TL.bot;
    const focusI = sel.fac != null ? sel.fac : sel.sys && sel.sys !== 'hazard' ? M.facs.filter((i) => sysOf(i) === sel.sys).sort((a, b) => M.R[b] - M.R[a])[0] : null;
    let g = '', title, ymax;
    if (focusI != null) {
      // The facility's analysis up to now, then the ensemble's forecast with its 10-90% band.
      ymax = 1;
      const y = (r) => TL.top + plotH - r * plotH;
      const obs = []; for (let kk = 0; kk <= M.k; kk++) obs.push([kk * e.DT, e.now[kk * e.N + focusI]]);
      const fc = e.forecast(M.k, focusI).series;
      const band = fc.map((s) => `${x(s.t).toFixed(1)},${y(s.p90).toFixed(1)}`).concat(fc.slice().reverse().map((s) => `${x(s.t).toFixed(1)},${y(s.p10).toFixed(1)}`)).join(' ');
      for (const [lv, k2] of [[C.CRIT, 'critical'], [0.55, 'high']]) g += `<line x1="${TL.padL}" x2="${TL.W - TL.padR}" y1="${y(lv)}" y2="${y(lv)}" class="tl-thr ${k2}"/><text x="${TL.W - TL.padR}" y="${y(lv) - 3}" text-anchor="end" class="tl-ax">${k2 === 'critical' ? 'CRITICAL' : 'HIGH'}</text>`;
      g += `<polygon points="${band}" class="tl-band"/>`;
      g += `<path d="${obs.map(([t, r], n) => `${n ? 'L' : 'M'}${x(t).toFixed(1)} ${y(r).toFixed(1)}`).join('')}" class="tl-obs"/>`;
      g += `<path d="${fc.map((s, n) => `${n ? 'L' : 'M'}${x(s.t).toFixed(1)} ${y(s.mean).toFixed(1)}`).join('')}" class="tl-fc"/>`;
      title = `Risk · ${esc(F[focusI].name)}${sel.fac == null ? ` <span>(worst in ${A.SYS_LABEL[sel.sys]})</span>` : ''}`;
      [0, 0.5, 1].forEach((r) => { g += `<text x="${TL.padL - 6}" y="${y(r) + 3}" text-anchor="end" class="tl-ax">${r}</text>`; });
    } else {
      const sr = series.get(`${L.geo.id}|${L.scen.id}|${M.k}|${L.mode}`);
      title = 'Cascade-R · city';
      if (sr) {
        ymax = Math.max(2, Math.ceil(Math.max(...sr.past.map((p) => p[1]), ...sr.fut.map((p) => p[1]))));
        const y = (r) => TL.top + plotH - (Math.min(r, ymax) / ymax) * plotH;
        g += `<line x1="${TL.padL}" x2="${TL.W - TL.padR}" y1="${y(1)}" y2="${y(1)}" class="tl-thr one"/><text x="${TL.W - TL.padR}" y="${y(1) - 3}" text-anchor="end" class="tl-ax">1 · self-sustaining</text>`;
        g += `<path d="${sr.past.map(([t, r], n) => `${n ? 'L' : 'M'}${x(t).toFixed(1)} ${y(r).toFixed(1)}`).join('')}" class="tl-obs"/>`;
        if (sr.fut.length) g += `<path d="${[sr.past[sr.past.length - 1], ...sr.fut].map(([t, r], n) => `${n ? 'L' : 'M'}${x(t).toFixed(1)} ${y(r).toFixed(1)}`).join('')}" class="tl-fc"/>`;
        for (let r = 0; r <= ymax; r += Math.max(1, Math.round(ymax / 3))) g += `<text x="${TL.padL - 6}" y="${y(r) + 3}" text-anchor="end" class="tl-ax">${r}</text>`;
      } else g += `<text x="${TL.W / 2}" y="${TL.top + plotH / 2}" text-anchor="middle" class="tl-ax">Computing the Cascade-R course…</text>`;
    }
    // Forecast region, axis, now.
    const nx = x(tI);
    g = `<rect x="${nx}" y="${TL.top - 4}" width="${Math.max(0, x(e.HOURS) - nx)}" height="${plotH + 8}" class="tl-fcz"/>` + g;
    for (let t = 0; t <= e.HOURS; t += 12) { const ck = C.clockAt(e.t0, t); g += `<line x1="${x(t)}" x2="${x(t)}" y1="${TL.top - 4}" y2="${TL.H - TL.bot}" class="tl-grid"/><text x="${x(t)}" y="${TL.H - 12}" text-anchor="middle" class="tl-ax">${fmtT(t)}</text><text x="${x(t)}" y="${TL.H - 1}" text-anchor="middle" class="tl-ax dim">${ck.day.slice(4)} ${ck.time}</text>`; }
    g += `<line x1="${nx}" x2="${nx}" y1="10" y2="${TL.H - TL.bot}" class="tl-now"/><text x="${nx + 4}" y="12" class="tl-nowl">${L.mode === 'historical' ? 'VIEW' : 'NOW'} ${fmtT(tI)}</text>`;
    // Threshold crossings: the first HIGH and CRITICAL per system (or the selected facility's).
    const evs = [], seen = new Set();
    for (const s of seq) {
      if (!sc.inScope(s.i) || (!s.observed && s.prob < 0.5)) continue;
      const key = focusI != null ? (s.i === focusI ? s.level : null) : sysOf(s.i) + s.level;
      if (!key || seen.has(key)) continue;
      seen.add(key); evs.push(s);
    }
    // Crossings that share a moment are grouped; each group gets one label placed in the
    // first lane where it fits, with a leader line back to its marker. Positions always
    // come from the event time — only the labels move.
    const shown = evs.slice(0, 18).sort((a, b) => a.t - b.t);
    const CH = 4.6, LANE_Y = [20, 32, 44];
    const label = (s2) => `${focusI != null ? (s2.level === 'CRITICAL' ? 'CRITICAL' : 'HIGH RISK') : `${SYS_SHORT[sysOf(s2.i)]} ${s2.level === 'CRITICAL' ? 'critical' : 'high'}`} ${s2.observed ? '' : '~'}${fmtT(s2.t)}`;
    // Group while the next crossing would land inside the previous label's own width:
    // a group is a window the chart genuinely cannot label separately.
    const groups = [];
    for (const s2 of shown) {
      const gx = x(s2.t), last = groups[groups.length - 1];
      const need = last ? (last.items.length === 1 ? label(last.items[0]).length : 22) * CH + 14 : 0;
      if (last && gx - last.x < need) { last.items.push(s2); last.crit = last.crit || s2.level === 'CRITICAL'; last.t1 = s2.t; }
      else groups.push({ x: gx, t: s2.t, t1: s2.t, items: [s2], crit: s2.level === 'CRITICAL' });
    }
    const laneEnd = LANE_Y.map(() => -1e9);
    for (const grp of groups) {
      const one = grp.items.length === 1 ? grp.items[0] : null;
      const nCrit = grp.items.filter((z) => z.level === 'CRITICAL').length;
      const txt = one ? label(one)
        : `${grp.items.length} crossings ${grp.items.some((z) => !z.observed) ? '~' : ''}${fmtT(grp.t)}${grp.t1 > grp.t ? '–' + fmtT(grp.t1) : ''}`;
      const w = txt.length * CH + 12;
      let lane = LANE_Y.findIndex((_, n) => grp.x > laneEnd[n]);
      if (lane < 0) lane = LANE_Y.length - 1;
      const flip = grp.x + w > TL.W - TL.padR;
      const lx = flip ? grp.x - 7 : grp.x + 7;
      laneEnd[lane] = Math.max(laneEnd[lane], (flip ? grp.x : grp.x + w) + 10);
      const ly = LANE_Y[lane];
      const cls = grp.crit ? 'r-critical' : 'r-high';
      const picked = grp.items.some((z) => z.i === sel.fac);
      const tip = grp.items.map((z) => `${F[z.i].name} · ${z.level === 'CRITICAL' ? 'CRITICAL' : 'HIGH RISK'} · ${z.observed ? 'observed' : 'forecast ' + pct(z.prob)} · ${fmtT(z.t)}`).join('\n');
      g += `<line x1="${grp.x}" x2="${grp.x}" y1="${ly + 4}" y2="${TL.top - 6}" class="tl-lead ${cls}"/>`;
      g += `<text x="${lx.toFixed(1)}" y="${ly + 3}" text-anchor="${flip ? 'end' : 'start'}" class="tl-evl ${cls}${picked ? ' on' : ''}" data-fac="${grp.items[0].i}">${esc(txt)}${one ? '' : ` (${nCrit} critical)`}<title>${esc(tip)}</title></text>`;
      grp.items.forEach((s2) => {
        const ex = x(s2.t);
        g += `<g class="tl-ev ${s2.level === 'CRITICAL' ? 'r-critical' : 'r-high'}${s2.observed ? ' obs' : ''}${sel.fac === s2.i ? ' on' : ''}" data-fac="${s2.i}">
          <line x1="${ex}" x2="${ex}" y1="${TL.top - 6}" y2="${TL.H - TL.bot}"/>
          <circle cx="${ex}" cy="${TL.top - 6}" r="${sel.fac === s2.i ? 5 : 3.4}"/>
          <title>${esc(F[s2.i].name)} · ${s2.level === 'CRITICAL' ? 'CRITICAL' : 'HIGH RISK'} · ${s2.observed ? 'observed' : 'forecast ' + pct(s2.prob)} · ${fmtT(s2.t)}</title></g>`;
      });
    }
    // A crowded group is listed in full under the chart, so no crossing is unreachable.
    const big = groups.filter((grp) => grp.items.length > 1);
    $('bdTL').innerHTML = `
      <div class="bd-h"><h2 id="bdTLh">Crisis timeline <span class="faint">T+0 → T+72 h</span></h2><span class="bd-sub-r">${title}</span></div>
      <svg id="bdTLsvg" class="tl-svg" viewBox="0 0 ${TL.W} ${TL.H}" role="img" aria-label="72-hour crisis timeline">${g}</svg>
      ${big.length ? `<div class="tl-groups">${big.map((grp) => `<details class="tl-grp"><summary><b class="${grp.crit ? 'r-critical' : 'r-high'}">${grp.items.length}</b> crossings ${fmtT(grp.t)}${grp.t1 > grp.t ? '–' + fmtT(grp.t1) : ''}</summary><ul>${grp.items.map((z) => `<li><button type="button" data-fac="${z.i}" class="${sel.fac === z.i ? 'on' : ''}">${esc(F[z.i].name)}</button><span>${z.level === 'CRITICAL' ? 'CRITICAL' : 'HIGH'} · ${z.observed ? 'observed' : pct(z.prob)} · ${fmtT(z.t)}</span></li>`).join('')}</ul></details>`).join('')}</div>` : ''}
      <p class="bd-legend"><i class="ln-k obs"></i>Observed <i class="ln-k fc"></i>Forecast (median) ${focusI != null ? '<i class="sw band"></i>10–90% range ' : ''}<i class="dotk r-high"></i>HIGH <i class="dotk r-critical"></i>CRITICAL <span>${evs.length ? 'Hollow: forecast. Click a crossing to select it, or the chart to move the time.' : sc.c ? 'No crossing for this crisis.' : 'No threshold crossing observed or forecast.'}</span></p>`;
  }

  // ── Registry ───────────────────────────────────────────────────────────
  function drawReg(keepFocus) {
    const { reg, F } = M, q = query.trim().toLowerCase();
    const list = reg.list.filter((c) => !q || [c.id, c.type, c.stage, ...c.districts, ...c.members.map((i) => F[i].name)].join(' ').toLowerCase().includes(q));
    const rows = list.map((c) => {
      const st = stateOf(c.maxR), nc = c.nextCrit;
      return `<tr class="${sel.crisis === c.id ? 'on' : ''}" data-crisis="${esc(c.id)}">
        <td><a href="${esc(V.crisisHref(c.id))}" class="num">${esc(c.id)}</a><div class="faint">${esc(c.type)} · ${esc(c.districts.slice(0, 2).join(', '))}${c.districts.length > 2 ? ` +${c.districts.length - 2}` : ''}</div></td>
        <td>${V.stageTag(c)}</td><td><span class="pill r-${st.key}"><span class="dot"></span>${st.label}</span></td>
        <td>${nc ? `${esc(F[nc.i].name)}<div class="faint">~${fmtT(nc.t)} · ${pct(nc.prob)}</div>` : '<span class="faint">none</span>'}</td></tr>`;
    }).join('');
    const c = scope().c;
    $('bdReg').innerHTML = `
      <div class="bd-h"><h2 id="bdRegh">Crisis registry <span class="faint">(${reg.list.length})</span></h2></div>
      <label class="bd-search"><span aria-hidden="true">${T.icons.UI.search}</span><input id="bdSearch" type="search" value="${esc(query)}" placeholder="Search crises, facilities, areas" autocomplete="off" aria-label="Search the registry"></label>
      ${reg.list.length ? `<div class="tbl-wrap"><table class="bd-tbl reg"><thead><tr><th>ID · type</th><th>Stage</th><th>Severity</th><th>Next critical</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="faint">No crisis matches.</td></tr>'}</tbody></table></div>`
        : `<p class="ni-empty">No crisis at ${fmtT(L.t)}. Nearest to forming:</p>${nearest()}`}
      ${c ? `<p class="bd-go">${esc(c.id)}: <a href="${esc(V.crisisHref(c.id))}">details</a> · <a href="${esc(S.href('/twin', { c: c.id }))}">City twin</a> · <a href="${esc(S.href('/plan', { c: c.id }))}">Response</a> · <button type="button" data-crisis="${esc(c.id)}">clear</button></p>` : reg.list.length ? '<p class="bd-go faint">Select a crisis to focus every panel on it.</p>' : ''}`;
    if (keepFocus) { const s = $('bdSearch'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
  }

  // With no crisis: the facilities closest to HIGH RISK now, so the card still informs.
  function nearest() {
    const { R, facs, F, sysOf } = M;
    const top = facs.slice().sort((a, b) => R[b] - R[a]).slice(0, 6);
    return `<div class="tbl-wrap"><table class="bd-tbl"><thead><tr><th>Facility</th><th>System</th><th>Risk now</th></tr></thead><tbody>${top.map((i) => { const st = stateOf(R[i]); return `<tr data-fac="${i}"><td>${esc(F[i].name)}</td><td>${SYS_SHORT[sysOf(i)]}</td><td><span class="pill r-${st.key}"><span class="dot"></span>${st.label} · ${pct(R[i])}</span></td></tr>`; }).join('')}</tbody></table></div>`;
  }

  // ── System impact matrix ───────────────────────────────────────────────
  // One cell = all learned links from the row system to the column system. Two facts are
  // kept apart deliberately: whether the learner has *established* a link (status), and
  // how much stress is *flowing* along it right now (weight x upstream stress). A
  // candidate link carrying nothing is not the same as no link at all, and neither is
  // evidence of transmission, so they are drawn differently and labelled separately.
  function drawMatrix() {
    const sc = scope(), { systems, links } = M;
    const cell = {};
    for (const l of links) {
      if (sc.set && !sc.set.has(l.from) && !sc.set.has(l.to)) continue;
      const key = l.a + '>' + l.b;
      const c = cell[key] || (cell[key] = { n: 0, confirmed: 0, candidate: 0, pruned: 0, flow: 0 });
      c.n++; c[l.status]++;
      if (l.status !== 'pruned') c.flow += l.flow;
    }
    const live = Object.values(cell).filter((c) => c.confirmed || c.candidate);
    const max = Math.max(0, ...live.map((c) => c.flow));
    const flowing = max >= 0.005;
    const bin = (x) => (!flowing ? 0 : x / max >= 0.75 ? 4 : x / max >= 0.45 ? 3 : x / max >= 0.2 ? 2 : x / max >= 0.05 ? 1 : 0);
    const body = systems.map((a) => `<tr><th scope="row" title="${A.SYS_LABEL[a]}">${SYS_SHORT[a]}</th>${systems.map((b) => {
      const key = a + '>' + b, c = cell[key];
      if (!c || (!c.confirmed && !c.candidate)) {
        const pruned = c && c.pruned;
        return `<td class="mx-none" title="${A.SYS_LABEL[a]} → ${A.SYS_LABEL[b]}: ${pruned ? `${c.pruned} link(s), all pruned — the learner rejected them` : 'no candidate link'}">${pruned ? '×' : '·'}</td>`;
      }
      const carrying = flowing && c.flow >= max * 0.05;
      const kind = carrying ? 'mx-' + bin(c.flow) : c.confirmed ? 'mx-idle' : 'mx-cand';
      const what = carrying ? `carrying ${c.flow.toFixed(3)}` : c.confirmed ? 'confirmed, carrying nothing now' : 'candidate, awaiting evidence';
      return `<td class="${kind}${sel.edge === key ? ' on' : ''}" tabindex="0" role="button" data-edge="${a !== b ? key : ''}"
        title="${A.SYS_LABEL[a]} → ${A.SYS_LABEL[b]}: ${c.n} link${c.n > 1 ? 's' : ''} (${c.confirmed} confirmed, ${c.candidate} candidate${c.pruned ? ', ' + c.pruned + ' pruned' : ''}) — ${what}">${carrying ? '' : c.confirmed ? '○' : '·'}</td>`;
    }).join('')}</tr>`).join('');
    $('bdMx').innerHTML = `
      <div class="bd-h"><h2 id="bdMxh">System impact matrix</h2><span class="bd-sub-r">${flowing ? 'stress flowing now' : 'no transmission yet'}</span></div>
      ${!flowing ? `<p class="mx-state">The learner has found candidate links between these systems, but <b>none is carrying stress at ${fmtT(L.t)}</b>. Nothing here is evidence of transmission yet — the grid shows where a link could carry stress if the upstream system is pushed.</p>` : ''}
      <div class="mx-wrap"><table class="mx"><caption class="sr-only">Learned links from each row system to each column system</caption>
        <thead><tr><th></th>${systems.map((b) => `<th scope="col" title="${A.SYS_LABEL[b]}">${SYS_SHORT[b].slice(0, 4)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>
      <div class="mx-key">${flowing ? '<span><i class="mx-4"></i>Most flow</span><span><i class="mx-2"></i>Some</span><span><i class="mx-1"></i>Trace</span>' : ''}<span><i class="mx-idle"></i>Confirmed, idle</span><span><i class="mx-cand"></i>Candidate</span><span><i class="mx-none"></i>No link</span></div></div>
      <p class="bd-note">Row → column. Colour shows stress flowing now (posterior weight × upstream stress); an outline shows a link the learner has established that is not carrying anything. <b>×</b> marks pairs whose links were rejected. The diagonal is links inside one system.</p>`;
  }

  // ── Facilities at risk ─────────────────────────────────────────────────
  // "Critical facilities" listed sites whose risk now is NORMAL because their crossing is
  // forecast, which reads as a contradiction. Observed and forecast are separated here.
  function drawFacilities() {
    const { R, facs, seq, F, sysOf } = M, sc = scope();
    const nextCrit = (i) => seq.find((s) => s.i === i && s.level === 'CRITICAL' && (s.observed || s.prob >= 0.5));
    const list = facs.filter(sc.inScope).map((i) => ({ i, r: R[i], nc: nextCrit(i) }))
      .filter((x) => x.r >= 0.55 || x.nc)
      .sort((a, b) => (b.r >= C.CRIT) - (a.r >= C.CRIT) || (a.nc ? a.nc.t : 999) - (b.nc ? b.nc.t : 999) || b.r - a.r);
    const nowCrit = list.filter((x) => x.r >= C.CRIT).length, nowHigh = list.filter((x) => x.r >= 0.55 && x.r < C.CRIT).length;
    const shown = facsAll ? list : list.slice(0, 8);
    $('bdFac').innerHTML = `
      <div class="bd-h"><h2 id="bdFach">Facilities at risk <span class="faint">(${list.length})</span></h2>
        <span class="bd-sub-r">${nowCrit ? `${nowCrit} critical now` : nowHigh ? `${nowHigh} high now` : 'none yet — all forecast'}</span></div>
      ${list.length ? `<div class="tbl-wrap"><table class="bd-tbl"><thead><tr><th>#</th><th>Facility</th><th>System</th>
        <th title="State of the analysis at the issue time">Now</th><th title="First forecast crossing of CRITICAL, with its probability">Reaches CRITICAL</th></tr></thead><tbody>
        ${shown.map((x, n) => { const st = stateOf(x.r); return `<tr class="${sel.fac === x.i ? 'on' : ''}" data-fac="${x.i}" tabindex="0"><td class="num faint">${n + 1}</td><td>${esc(F[x.i].name)}</td><td>${SYS_SHORT[sysOf(x.i)]}</td><td><span class="pill r-${st.key}"><span class="dot"></span>${st.label}</span></td><td class="num">${!x.nc ? '<span class="faint">not forecast</span>' : x.nc.observed ? 'already' : `~${fmtT(x.nc.t)} <span class="faint">${pct(x.nc.prob)}</span>`}</td></tr>`; }).join('')}
      </tbody></table></div>${list.length > 8 ? `<p class="bd-note"><button type="button" class="lnk-btn" id="bdFacMore">${facsAll ? 'Show the first 8' : `Show all ${list.length}`}</button></p>` : ''}`
        : '<p class="ni-empty">No facility is at HIGH RISK now or forecast to reach CRITICAL from this issue time.</p>'}`;
  }

  // ── Recent sensor evidence ─────────────────────────────────────────────
  // Three different quantities, which a single "reading" column would blur: what the feed
  // reported, what the filter believes after weighing it, and how far it trusts the feed.
  // They diverge exactly when a sensor is failing, which is the case worth seeing.
  function drawEvidence() {
    const { e, R, trust, facs, F, k } = M, sc = scope();
    const pool = sel.fac != null ? [sel.fac] : facs.filter(sc.inScope);
    const list = pool.slice().sort((a, b) => (trust[a] < 0.5) - (trust[b] < 0.5) || R[b] - R[a]).slice(0, 6);
    const spark = (i) => {
      const pts = []; for (let kk = Math.max(0, k - 12); kk <= k; kk++) { const y = e.obs[kk * e.N + i]; if (!Number.isNaN(y)) pts.push([kk - k + 12, y]); }
      if (pts.length < 2) return '<span class="faint">no data</span>';
      return `<svg class="ev-spark" viewBox="0 0 60 18" aria-hidden="true"><path d="${pts.map(([t, y], n) => `${n ? 'L' : 'M'}${(t * 5).toFixed(1)} ${(16 - y * 14).toFixed(1)}`).join('')}"/></svg>`;
    };
    const rows = list.map((i) => {
      const y = e.obs[k * e.N + i], off = Number.isNaN(y), bad = trust[i] < 0.5;
      const gap = !off && Math.abs(y - R[i]) >= 0.15;
      const tag = off ? '<span class="ni-tag pruned">offline</span>'
        : bad ? '<span class="ni-tag candidate">quarantined</span>'
        : gap ? '<span class="ni-tag watch">disagrees</span>' : '<span class="ni-tag ok">healthy</span>';
      return `<tr class="${sel.fac === i ? 'on' : ''}" data-fac="${i}" tabindex="0">
        <td><span class="num">${esc(F[i].sensor)}</span><div class="faint">${esc(F[i].name)}</div></td>
        <td class="num${gap || bad ? ' ev-off' : ''}">${off ? '—' : pct(y)}</td>
        <td class="num">${pct(R[i])}</td>
        <td class="num ${bad ? 'ev-bad' : ''}">${pct(trust[i])}</td>
        <td>${spark(i)}</td><td>${tag}</td></tr>`;
    }).join('');
    const quarantined = list.filter((i) => trust[i] < 0.5 || Number.isNaN(e.obs[k * e.N + i])).length;
    $('bdEv').innerHTML = `
      <div class="bd-h"><h2 id="bdEvh">Sensor evidence</h2><span class="bd-sub-r">${quarantined ? `${quarantined} feed${quarantined > 1 ? 's' : ''} not trusted` : 'all feeds agree'}</span></div>
      <div class="tbl-wrap"><table class="bd-tbl ev-tbl"><thead><tr>
        <th>Sensor</th><th title="What the feed reported at this step">Feed</th>
        <th title="What the filter believes after weighing the feed against the ensemble and upstream sensors">Analysis</th>
        <th title="How much influence the filter still gives this feed">Trust</th><th>6 h</th><th>State</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6" class="faint">No facility in scope.</td></tr>'}</tbody></table></div>
      <p class="bd-note"><b>Feed</b> and <b>Analysis</b> are both on the model's 0–100 stress scale, not physical units — this scenario generates its sensor streams. Where they disagree the filter has discounted the feed; <b>Trust</b> is how much influence it still carries.</p>`;
  }

  T.router.register('/crises', {
    title: 'Crises',
    mount(ctx) { S.show(); render(ctx); },
    unmount() { token++; },
    update(ctx) { render(ctx); },
  });
})(typeof window !== 'undefined' ? window : globalThis);
