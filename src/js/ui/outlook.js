/* Situation: the twin's briefing panel, in place of the asset inventory.

   It answers "what is happening and what comes next": the city's state, a short
   briefing, a few measures, risk by system, and a prioritised list of upcoming
   predicted events (crises first, then the next threshold crossings). Selecting an
   event selects its facility, moves the clock to the event and opens the inspector.
   Below, analytical panels that each appear only when the engine has something for
   them: the predicted course, modeled population exposure, the highest-risk
   facilities, traffic and access, sensor evidence, and the pretrained forecaster's
   benchmark.

   Every figure comes from the shared engine at the view's issue time. Content moved
   here from the former overview page (src/js/views/overview.js): its narrative is the
   briefing, its crisis cards are events, its benchmark and course chart are panels. */
(function (root) {
  const T = root.TWIN;
  const C = T.core, A = T.analytics;
  const { stateOf, fmtT } = C;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pct = (p) => Math.round(p * 100) + '%';
  const SYS_WORD = { drainage: 'Drainage', pump: 'Drainage', traffic: 'Roads', power: 'Power', telecom: 'Telecom', ems: 'EMS', hospital: 'Hospital' };

  function create(app) {
    const el = document.getElementById('outlook');
    let lastKey = '', lastAt = 0, open = new Set();

    const clock = (t) => { const ck = C.clockAt(app.engine.t0, t); return `${ck.day.slice(0, 3)} ${ck.time}`; };

    function render(v, force) {
      if (!el || !app.state || app.state.viewMode !== 'situation') return;
      const key = `${v.kInfo}|${v.mode}|${app.state.scenario}|${app.state.selected}|${app.state.crisis}`;
      // During playback the clock moves every frame; the briefing refreshes once a second.
      if (!force && (key === lastKey || (app.state.playing && performance.now() - lastAt < 1000))) return;
      lastKey = key; lastAt = performance.now();
      const e = app.engine, k = v.kInfo, tI = v.tInfo, F = e.F, N = e.N, an = e.analytics;
      const R = e.stateAt(k).risk, reg = an.crises(k), seq = e.cascade(k);
      const cr = an.cascadeR(k), cx = an.crossing(k);
      const city = stateOf(e.cityAt(k).risk);
      const facs = F.map((f, i) => i).filter((i) => e.kinds[i] !== 'weather');
      const critNow = facs.filter((i) => R[i] >= C.CRIT);
      const soon = seq.filter((s) => s.level === 'CRITICAL' && !s.observed && s.prob >= 0.5 && s.t - tI <= 24 && R[s.i] < C.CRIT);
      const pop = T.services.population(app.geo.id);
      const exp = pop.modeled ? pop.atRisk(R) : null;
      // Residents where the linked facility is forecast HIGH or CRITICAL in 24 h (live view only).
      const exp24 = exp && v.mode === 'live' && k + 48 < e.K ? pop.atRisk(e.project(k, k + 48)) : null;
      const scen = e.scen;

      // Briefing (the former overview narrative, condensed).
      const crisisLine = !reg.list.length ? 'No crisis is in the registry.'
        : `${reg.list.length === 1 ? 'One crisis' : `${reg.list.length} crises`}: ${reg.list.slice(0, 2).map((c) => `${c.type.toLowerCase()} around ${esc(c.districts.slice(0, 2).join(', '))} (${c.stage.toLowerCase()})`).join('; ')}${reg.list.length > 2 ? `; ${reg.list.length - 2} more` : ''}.`;
      const crossLine = cr.r >= 1 ? 'The cascade is feeding itself: more stress moves through dependencies than arrives from the hazard.'
        : cx ? `Cascade-R is forecast to reach 1 at ${fmtT(cx.t)} (${clock(cx.t)}).` : 'The hazard, not the network, drives the stress.';

      // Risk by system: worst facility now, and the first forecast CRITICAL crossing.
      const systems = A.SYS_ORDER.filter((g) => facs.some((i) => A.group(e.kinds[i]) === g));
      const sysRows = systems.map((g) => {
        const own = facs.filter((i) => A.group(e.kinds[i]) === g);
        const mx = Math.max(...own.map((i) => R[i]));
        const next = seq.find((s) => A.group(e.kinds[s.i]) === g && !s.observed && s.level === 'CRITICAL' && s.prob >= 0.4);
        const st = stateOf(mx);
        return `<div class="ol-sys"><span class="ol-sys-k">${A.SYS_LABEL[g]}</span><span class="ol-bar"><i class="r-${st.key}" style="width:${Math.max(4, Math.round(mx * 100))}%"></i></span>
          <span class="ol-sys-v r-${st.key}">${st.label}</span><span class="ol-sys-n">${next ? `CRITICAL ~${esc(clock(next.t))} · ${pct(next.prob)}` : st.key === 'critical' ? 'now' : '—'}</span></div>`;
      }).join('');

      // Upcoming events: crises first, then the next crossings not already covered.
      const events = [];
      for (const c of reg.list) {
        const nc = c.nextCrit;
        events.push({ type: 'crisis', id: c.id, i: nc ? nc.i : c.root, t: nc ? nc.t : Math.max(tI, c.since), c });
      }
      const seen = new Set(events.map((x) => x.i));
      for (const s of seq) {
        if (s.observed || s.prob < 0.5 || s.t - tI > 36 || seen.has(s.i)) continue;
        if (s.level !== 'CRITICAL' && seq.some((q) => q.i === s.i && q.level === 'CRITICAL' && !q.observed && q.prob >= 0.5)) continue;
        seen.add(s.i);
        events.push({ type: 'event', i: s.i, t: s.t, s });
        if (events.length >= 9) break;
      }
      const evHtml = events.map((x, n) => {
        if (x.type === 'crisis') {
          const c = x.c, nc = c.nextCrit;
          return `<button class="ol-ev crisis r-${stateOf(c.maxR).key}${app.state.crisis === c.id ? ' on' : ''}" data-n="${n}" type="button">
            <span class="ol-ev-t">${nc ? esc(clock(nc.t).slice(4)) : 'now'}</span>
            <span class="ol-ev-b"><b>${esc(c.type)} <span class="num faint">${esc(c.id)}</span></b>
            <span>${c.stage} · ${c.members.length} facilities · ${esc(c.districts.slice(0, 2).join(', '))}${nc ? ` · next CRITICAL: ${esc(F[nc.i].name)} (${pct(nc.prob)})` : ''}</span></span></button>`;
        }
        const s = x.s, crit = s.level === 'CRITICAL';
        return `<button class="ol-ev r-${crit ? 'critical' : 'high'}${app.state.selected === x.i ? ' on' : ''}" data-n="${n}" type="button">
          <span class="ol-ev-t">${esc(clock(s.t).slice(4))}</span>
          <span class="ol-ev-b"><b>${esc(F[x.i].name)}</b><span>${SYS_WORD[e.kinds[x.i]] || ''} · ${crit ? 'CRITICAL' : 'HIGH RISK'} · forecast ${pct(s.prob)} · ${fmtT(s.t)}</span></span></button>`;
      }).join('');

      // KPIs: only the ones the engine can supply.
      const kpis = [
        `<div class="ol-kpi"><span>Critical now</span><b class="${critNow.length ? 'r-critical' : ''}">${critNow.length}<small> of ${facs.length}</small></b></div>`,
        `<div class="ol-kpi"><span>Critical within 24 h</span><b class="${soon.length ? 'r-high' : ''}">${soon.length}<small> forecast</small></b></div>`,
        `<div class="ol-kpi"><span>Cascade-R</span><b class="${cr.r >= 1 ? 'r-critical' : ''}">${cr.r.toFixed(2)}<small>${cx && !cx.now ? ` → 1 at ${esc(clock(cx.t).slice(4))}` : cx ? ' self-sustaining' : ''}</small></b></div>`,
        exp ? `<div class="ol-kpi"><span>Residents in high-risk areas</span><b>${people(exp.high + exp.crit)}<small>${exp24 ? ` → ${people(exp24.high + exp24.crit)} in 24 h` : ''} · modeled</small></b></div>` : '',
      ].join('');

      const panels = analysis(v, { R, reg, seq, exp, facs });
      const rec = T.services.recommendedNow(e, k);
      el.innerHTML = `
        <div class="ol-head">
          <p class="ol-kicker">${esc(scen.label)} · <span>${esc(scen.provenance ? scen.provenance.label : 'Simulation')}</span></p>
          <div class="ol-title"><h2>Outlook</h2><span class="pill r-${city.key}"><span class="dot"></span>City ${city.label}</span></div>
          <p class="ol-asof">${v.forecastView ? `Forecast view ${fmtT(v.t)} · issued` : 'As of'} ${fmtT(tI)} · ${esc(clock(tI))} ${C.tzLabel()}</p>
        </div>
        <div class="ol-body scroll">
          <p class="ol-brief">${crisisLine} ${critNow.length ? `${critNow.length} facilit${critNow.length > 1 ? 'ies are' : 'y is'} CRITICAL now` : 'Nothing is CRITICAL now'}${soon.length ? `; ${soon.length} ${critNow.length ? 'more are' : 'are'} forecast to become CRITICAL within 24 h, the first ${esc(F[soon[0].i].name)} at ${esc(clock(soon[0].t))}` : ''}. ${crossLine}</p>
          <div class="ol-kpis">${kpis}</div>
          <section class="ol-sec"><h3>Risk by system <span>now · next CRITICAL</span></h3>${sysRows}</section>
          <section class="ol-sec"><h3>Upcoming <span>${events.length ? 'select to inspect' : ''}</span></h3>
            ${events.length ? `<div class="ol-evs">${evHtml}</div>` : '<p class="ol-empty">No crisis and no crossing forecast in the next 36 hours.</p>'}</section>
          ${panels}
          <div class="ol-foot">
            <a data-nav="/plan" href="#/plan">Response plan${rec && rec.result ? ` · −${Math.round(rec.result.reduction * 100)}% critical hours` : ''} →</a>
            <a data-nav="/crises" href="#/crises">Crisis registry →</a>
            <p>${esc(scen.provenance ? scen.provenance.note : 'Simulated data.')} Nothing here is a real-time feed.</p>
          </div>
        </div>`;
      // Keep opened panels open across refreshes.
      el.querySelectorAll('details[data-p]').forEach((d) => { d.open = open.has(d.dataset.p); d.addEventListener('toggle', () => (d.open ? open.add(d.dataset.p) : open.delete(d.dataset.p))); });
      el.querySelectorAll('.ol-ev').forEach((b) => b.addEventListener('click', () => {
        const x = events[+b.dataset.n];
        if (x.type === 'crisis') app.focusCrisis(x.c.id, { fit: false });
        app.focusEvent(x.i, x.t);
      }));
      // The recommendation is searched in the background; the footer picks it up when ready.
      if (!rec && v.mode === 'live') T.services.recommended(e, k).then(() => { if (lastKey === key) { lastKey = ''; render(app.view, true); } });
    }

    function people(n) { return n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e4 ? `${Math.round(n / 1000)}k` : String(Math.round(n / 100) * 100); }

    // Analytical panels, each drawn only when its engine output is non-empty.
    function analysis(v, d) {
      const e = app.engine, F = e.F, k = v.kInfo, out = [];
      const panel = (id, title, html) => out.push(`<details class="ol-panel" data-p="${id}"><summary>${title}</summary><div class="ol-panel-b">${html}</div></details>`);
      // Predicted course: Cascade-R observed, then forecast.
      const an = e.analytics, past = [], fut = [];
      for (let kk = 0; kk <= k; kk += 4) past.push([kk * e.DT, an.cascadeR(kk).r]);
      past.push([k * e.DT, an.cascadeR(k).r]);
      for (let kk = k + 4; kk < e.K; kk += 4) fut.push([kk * e.DT, an.cascadeR(k, kk).r]);
      if (past.length + fut.length > 2) panel('course', 'Predicted course · Cascade-R', spark(e, past, fut, v.tInfo));
      if (d.exp && d.exp.total) {
        const cr = d.reg.list.filter((c) => c.people != null).slice(0, 4);
        panel('pop', 'Population exposure <span>modeled</span>', `<p>${people(d.exp.crit)} residents live where the linked facility is CRITICAL and ${people(d.exp.high)} where it is HIGH RISK, of ${people(d.exp.total)} in the model.</p>
          ${cr.length ? `<ul>${cr.map((c) => `<li><b class="num">${esc(c.id)}</b> ${esc(c.type)} · ${people(c.people)} in its footprint</li>`).join('')}</ul>` : ''}`);
      }
      const top = d.facs.filter((i) => d.R[i] >= 0.35).sort((a, b) => d.R[b] - d.R[a]).slice(0, 6);
      if (top.length) panel('top', 'Highest-risk facilities', `<ul>${top.map((i) => `<li><button type="button" data-sel="${i}">${esc(F[i].name)}</button><span class="r-${stateOf(d.R[i]).key}">${pct(d.R[i])}</span></li>`).join('')}</ul>`);
      const traffic = d.seq.filter((s) => e.kinds[s.i] === 'traffic' && s.level === 'HIGH RISK' && (s.observed ? d.R[s.i] >= 0.55 : s.prob >= 0.5 && s.t - v.tInfo <= 24));
      if (traffic.length) panel('traffic', 'Traffic and access', `<ul>${traffic.slice(0, 6).map((s) => `<li><button type="button" data-sel="${s.i}">${esc(F[s.i].name)}</button><span>${s.observed ? 'impaired now' : `from ${esc(clock(s.t).slice(4))} · ${pct(s.prob)}`}</span></li>`).join('')}</ul>`);
      const trust = e.stateAt(k).trust;
      const bad = d.facs.filter((i) => trust[i] < 0.5);
      if (bad.length) panel('sensors', 'Sensor evidence', `<p>Feeds the filter currently distrusts; their past evidence is down-weighted.</p><ul>${bad.slice(0, 6).map((i) => `<li><button type="button" data-sel="${i}">${esc(F[i].sensor)} · ${esc(F[i].name)}</button><span>trust ${pct(trust[i])}</span></li>`).join('')}</ul>`);
      const sec = T.services.second(e);
      if (sec) {
        const c = sec.compare(), name = sec.model.split('/')[1], lk = sec.likely(k);
        const row = (label, r) => `<tr><th>${label}</th><td>${r.brier.toFixed(3)}</td><td>${r.events ? `${r.hits}/${r.events}` : '—'}</td><td>${r.medianLead == null ? '—' : r.medianLead + ' h'}</td></tr>`;
        panel('ml', `Forecast benchmark <span>pretrained ML</span>`, `<p>${esc(name)}, pretrained and never trained on this city, reading the same sensor streams: ${lk.ml} facilities at 50%+ of CRITICAL within 24 h, against the ensemble's ${lk.ens}.</p>
          <table class="ol-tbl"><thead><tr><th>Over the replay</th><th>Brier</th><th>Warned</th><th>Lead</th></tr></thead><tbody>${row('Ensemble', c.ens)}${row(esc(name), c.ml)}</tbody></table>
          <p class="ol-note">Same cases, same rules, simulated ground truth.</p>`);
      }
      return out.length ? `<section class="ol-sec ol-analysis"><h3>Analysis</h3>${out.join('')}</section>` : '';
    }
    function spark(e, past, fut, tNow) {
      const W = 300, H = 70, x = (t) => (t / e.HOURS) * W;
      const ymax = Math.max(2, ...past.map((p) => p[1]), ...fut.map((p) => p[1]));
      const y = (r) => H - 6 - (Math.min(r, ymax) / ymax) * (H - 14);
      const line = (pts) => pts.map(([t, r], n) => `${n ? 'L' : 'M'}${x(t).toFixed(1)} ${y(r).toFixed(1)}`).join('');
      return `<svg class="ol-spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="Cascade-R over 72 hours">
        <line x1="0" x2="${W}" y1="${y(1)}" y2="${y(1)}" class="c-one"/><text x="2" y="${y(1) - 3}" class="c-note">1</text>
        <path d="${line(past)}" class="c-past"/>${fut.length ? `<path d="${line([past[past.length - 1], ...fut])}" class="c-fut"/>` : ''}
        <line x1="${x(tNow)}" x2="${x(tNow)}" y1="2" y2="${H}" class="c-now"/></svg>`;
    }

    if (el) el.addEventListener('click', (ev) => { const b = ev.target.closest('[data-sel]'); if (b) app.select(+b.dataset.sel, { fly: true }); });
    return { render, invalidate: () => { lastKey = ''; } };
  }

  root.TWIN.outlook = { create };
})(typeof window !== 'undefined' ? window : globalThis);
