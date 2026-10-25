/* Overlay drawers: dependency graph, interventions, temporal validation. */
(function (root) {
  const C = root.TWIN.core;
  const { stateOf, RISK_HEX, fmtT } = C;
  const I = root.TWIN.icons;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const GROUPS = ['weather', 'drainage', 'traffic', 'power', 'ems', 'hospital'];
  const GLABEL = { weather: 'Weather', drainage: 'Drainage', traffic: 'Traffic', power: 'Power', ems: 'EMS response', hospital: 'Hospitals' };
  const GICON = { weather: I.FAC.weather, drainage: I.FAC.gauge, traffic: I.FAC.signal, power: I.FAC.power, ems: I.FAC.ems, hospital: I.FAC.hospital };
  const POS = { weather: [56, 148], drainage: [190, 148], traffic: [336, 52], power: [336, 246], ems: [486, 52], hospital: [536, 196] };
  const groupOf = (kind) => (kind === 'pump' ? 'drainage' : kind);

  function createGraph(app) {
    const el = document.getElementById('drawerGraph');
    let tab = 'types', replay = null, filter = 'all';
    el.innerHTML = `
      <div class="drawer-head"><h3><b>Dependency graph</b>Inferred from streaming data</h3>
        <div style="display:flex;gap:8px;align-items:center">
          <div class="seg" role="group"><button data-tab="types" aria-pressed="true">Systems</button><button data-tab="links" aria-pressed="false">Facility links</button></div>
          <button class="icon-btn" data-close aria-label="Close">${I.UI.close}</button></div></div>
      <div class="drawer-body scroll" id="graphBody"></div>`;
    el.querySelector('[data-close]').addEventListener('click', () => app.setDrawer(null));
    el.querySelector('.seg').addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]'); if (!b) return;
      tab = b.dataset.tab;
      el.querySelectorAll('.seg button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      render(true);
    });
    const body = el.querySelector('#graphBody');

    // First step at which each system-to-system link carried stress (propagation order).
    let actCache = null;
    function activation() {
      if (actCache && actCache.s === app.state.scenario) return actCache.a;
      const e = app.engine, a = {};
      for (const ed of e.E) {
        const key = groupOf(e.kinds[ed.from]) + '>' + groupOf(e.kinds[ed.to]);
        if (key.startsWith('drainage>drainage') || key.split('>')[0] === key.split('>')[1]) continue;
        for (let k = 0; k < e.K; k++) {
          const up = e.now[Math.max(0, k - ed.lag) * e.N + ed.from];
          if (up > e.thr[ed.from] + 0.05) { a[key] = Math.min(a[key] ?? 1e9, k); break; }
        }
      }
      // Exogenous weather links: first step the rain/hazard signal is material.
      const wx = e.F.map((_, i) => i).filter((i) => e.kinds[i] === 'weather');
      for (let k = 0; k < e.K; k++) {
        const m = wx.reduce((s, i) => s + e.now[k * e.N + i], 0) / wx.length;
        if (m > 0.22) { for (const g of ['drainage', 'traffic', 'power']) a['weather>' + g] = Math.min(a['weather>' + g] ?? 1e9, k); break; }
      }
      actCache = { s: app.state.scenario, a };
      return a;
    }

    function render(force) {
      if (el.hidden) return;
      const v = app.view, e = app.engine;
      if (!force && body._k === v.kInfo && body._t === tab && !replay) return;
      body._k = v.kInfo; body._t = tab;
      tab === 'types' ? renderTypes(v, e) : renderLinks(v, e);
    }

    function renderTypes(v, e, cursorK) {
      const kc = cursorK ?? v.kInfo;
      const eps = e.edgesAt(v.kInfo);
      const groups = {};
      for (const ep of eps) {
        const ed = e.E[ep.e];
        const gf = groupOf(e.kinds[ed.from]), gt = groupOf(e.kinds[ed.to]);
        if (gf === gt) continue;
        const key = gf + '>' + gt;
        const gr = (groups[key] ||= { from: gf, to: gt, n: 0, conf: 0, pruned: 0, w: 0, lag: [] });
        gr.n++;
        if (ep.status === 'confirmed') { gr.conf++; gr.w += ep.mean; gr.lag.push(ed.lag * e.DT); }
        if (ep.status === 'pruned') gr.pruned++;
      }
      const disc = e.discover(v.kInfo);
      for (const g of ['drainage', 'traffic', 'power', 'ems', 'hospital']) {
        const d = disc.find((x) => x.from === 'weather' && x.to === g);
        if (d && (d.found || ['drainage', 'traffic', 'power'].includes(g))) groups['weather>' + g] = { from: 'weather', to: g, n: 1, conf: d.found ? 1 : 0, pruned: 0, w: d.strength, lag: [d.lag], exo: true };
      }
      const act = activation();
      const order = Object.entries(act).filter(([, k]) => k <= kc).sort((a, b) => a[1] - b[1]).map(([key]) => key);
      const groupRisk = {};
      for (const g of GROUPS) {
        let mx = 0;
        for (let i = 0; i < e.N; i++) if (groupOf(e.kinds[i]) === g) mx = Math.max(mx, v.R[i]);
        groupRisk[g] = mx;
      }
      const edgesSvg = Object.entries(groups).map(([key, gr]) => {
        const [x1, y1] = POS[gr.from], [x2, y2] = POS[gr.to];
        const back = POS[gr.to][0] < POS[gr.from][0];
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy);
        const bend = back ? 0.32 : 0.12;
        const cx = mx + (dy / L) * L * bend, cy = my - (dx / L) * L * bend;
        // trim to node radius
        const r = 25;
        const sx = x1 + ((cx - x1) / Math.hypot(cx - x1, cy - y1)) * r, sy = y1 + ((cy - y1) / Math.hypot(cx - x1, cy - y1)) * r;
        const ex = x2 + ((cx - x2) / Math.hypot(cx - x2, cy - y2)) * (r + 4), ey = y2 + ((cy - y2) / Math.hypot(cx - x2, cy - y2)) * (r + 4);
        const lit = order.includes(key) && gr.conf > 0;
        const rank = order.indexOf(key) + 1;
        const col = lit ? RISK_HEX[stateOf(Math.max(groupRisk[gr.to], 0.36)).key] : '#5b636d';
        const w = lit ? 1.4 + Math.min(4, gr.w * (gr.exo ? 3 : 2.4)) : 1;
        const lag = gr.lag.length ? (gr.lag.reduce((s, x) => s + x, 0) / gr.lag.length).toFixed(1) : '–';
        const lx = 0.25 * sx + 0.5 * cx + 0.25 * ex, ly = 0.25 * sy + 0.5 * cy + 0.25 * ey;
        if (!lit) return `<path d="M${sx},${sy} Q${cx},${cy} ${ex},${ey}" fill="none" stroke="#3d434b" stroke-width="1" stroke-dasharray="3 3" opacity="0.7"/>`;
        // Label sits on the outside of the curve, away from the nodes.
        const nx = cx - (sx + ex) / 2, ny = cy - (sy + ey) / 2, nl = Math.hypot(nx, ny) || 1;
        const tx = lx + (nx / nl) * 15, ty = ly + (ny / nl) * 15 + 3;
        return `<g class="ge lit">
          <path d="M${sx},${sy} Q${cx},${cy} ${ex},${ey}" fill="none" stroke="${col}" stroke-width="${w}" marker-end="url(#ah-lit)" opacity="0.95"/>
          <path d="M${sx},${sy} Q${cx},${cy} ${ex},${ey}" fill="none" stroke="#fff" stroke-width="${Math.max(1, w - 1)}" stroke-dasharray="2 14" class="pulse" opacity="0.7"/>
          <g transform="translate(${lx},${ly})"><circle r="7.5" fill="#0d0f12" stroke="${col}"/><text text-anchor="middle" dy="3" font-size="8.5" fill="${col}" font-family="var(--font-mono)">${rank}</text></g>
          <text x="${tx}" y="${ty}" text-anchor="middle" font-size="8.5" fill="#8a939e" font-family="var(--font-mono)" paint-order="stroke" stroke="#0d0f12" stroke-width="3">${gr.exo ? 'r ' + gr.w.toFixed(2) : gr.conf + '/' + gr.n} · ${lag}h</text>
        </g>`;
      }).join('');
      const nodesSvg = GROUPS.map((g) => {
        const [x, y] = POS[g], rk = groupRisk[g], col = RISK_HEX[stateOf(rk).key];
        return `<g transform="translate(${x},${y})">
          <path d="M0,-25 21.7,-12.5 21.7,12.5 0,25 -21.7,12.5 -21.7,-12.5z" fill="#0d0f12" stroke="${col}" stroke-width="1.6"/>
          <g transform="translate(-9,-9) scale(1.125)" style="color:${col}">${GICON[g].replace('<svg ', '<svg width="16" height="16" ')}</g>
          <text y="${g === 'traffic' || g === 'ems' ? -33 : 40}" text-anchor="middle" font-size="10.5" fill="#e4e8ee" font-family="var(--font-ui)" font-weight="500" paint-order="stroke" stroke="#0d0f12" stroke-width="3">${GLABEL[g]} <tspan fill="${col}" font-family="var(--font-mono)" font-size="9.5">${Math.round(rk * 100)}%</tspan></text>
        </g>`;
      }).join('');
      const st = { confirmed: 0, candidate: 0, pruned: 0 };
      eps.forEach((x) => st[x.status]++);
      const screen = disc.filter((d) => d.strength > 0.2).sort((a, b) => b.strength - a.strength).slice(0, 8);
      body.innerHTML = `
        <svg viewBox="0 0 592 292" width="100%" style="display:block" role="img" aria-label="System dependency graph">
          <defs>
            <marker id="ah-lit" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0,0 10,5 0,10z" fill="#e4e8ee"/></marker>
          </defs>
          <style>.pulse{animation:dash 1.2s linear infinite}@keyframes dash{to{stroke-dashoffset:-32}}</style>
          ${edgesSvg}${nodesSvg}
        </svg>
        <div class="legend-row">
          <span><i style="border-color:#e5484d"></i>lit = stress propagating, numbered in propagation order</span>
          <span><i style="border-color:#5b636d;border-top-style:dashed"></i>candidate, not yet exercised</span>
        </div>
        <div class="val-note">Facility-level links at ${fmtT(v.tInfo)}: <b class="good">${st.confirmed} confirmed</b> · <b class="bad">${st.pruned} pruned</b> · ${st.candidate} awaiting evidence. Labels show confirmed / candidate links and mean lag. Learned online by sparse Bayesian regression on sensor streams, with no structure given in advance.</div>
        <div class="sec-head" style="margin-top:14px"><span class="sec-title">Raw-stream screen · weather partialled out · trailing 24 h</span><button class="link-btn" id="replayBtn">Replay propagation</button></div>
        <div class="disc">${screen.map((d) => `<div class="disc-row ${d.found ? '' : 'weak'}"><span>${GLABEL[d.from]} → ${GLABEL[d.to]}</span><span class="meter"><i style="width:${Math.min(100, d.strength * 100)}%"></i></span><span class="mono">r ${d.strength.toFixed(2)}</span><span class="mono faint">${d.lag}h</span></div>`).join('') || '<div class="empty">Not enough variation in the streams yet.</div>'}</div>`;
      body.querySelector('#replayBtn').addEventListener('click', () => startReplay(v, e));
    }

    function startReplay(v, e) {
      cancelAnimationFrame(replay);
      const t0 = performance.now(), dur = 5000;
      const step = (t) => {
        const p = Math.min(1, (t - t0) / dur);
        renderTypes(v, e, Math.round(p * v.kInfo));
        if (p < 1) replay = requestAnimationFrame(step); else replay = null;
      };
      replay = requestAnimationFrame(step);
    }

    function renderLinks(v, e) {
      const eps = e.edgesAt(v.kInfo).map((ep) => ({ ...ep, ed: e.E[ep.e] }));
      const rank = { confirmed: 0, candidate: 1, pruned: 2 };
      const list = eps.filter((x) => filter === 'all' || x.status === filter).sort((a, b) => rank[a.status] - rank[b.status] || b.mean - a.mean);
      const F = e.F;
      body.innerHTML = `
        <div class="seg" role="group" style="margin-bottom:10px" id="linkFilter">${['all', 'confirmed', 'candidate', 'pruned'].map((k) => `<button data-f="${k}" aria-pressed="${k === filter}">${k}</button>`).join('')}</div>
        <div class="drivers">${list.map((x) => `
          <button class="drv" data-goto="${x.ed.to}">
            <span class="drv-name">${esc(F[x.ed.from].id)} → ${esc(F[x.ed.to].id)} <span class="faint" style="font-size:11px">${esc(x.ed.mechanism)}</span></span>
            <span class="drv-val">${x.mean.toFixed(2)}</span>
            <span class="drv-bar"><i style="width:${Math.min(100, x.mean * 140)}%;background:${x.status === 'confirmed' ? 'var(--accent)' : x.status === 'pruned' ? 'var(--crit)' : 'var(--text-4)'}"></i></span>
            <span class="drv-ev">± ${x.sd.toFixed(2)} · lag ${x.ed.lag * e.DT} h · evidence ${Math.round(x.learned * 100)}% · <span class="st-${x.status}">${x.status}</span>${x.active ? ' · <span style="color:var(--high)">carrying stress</span>' : ''}</span>
          </button>`).join('')}</div>`;
      body.querySelector('#linkFilter').addEventListener('click', (ev) => { const b = ev.target.closest('[data-f]'); if (b) { filter = b.dataset.f; renderLinks(v, e); } });
      body.querySelector('.drivers').addEventListener('click', (ev) => { const b = ev.target.closest('[data-goto]'); if (b) app.select(+b.dataset.goto, { fly: true }); });
    }

    return { render, reset: () => { actCache = null; } };
  }

  function createPlan(app) {
    const el = document.getElementById('drawerPlan');
    let chosen = new Set(), budget = 5, result = null, busy = false, singles = {};
    el.innerHTML = `
      <div class="drawer-head"><h3><b>Interventions</b>Constrained counterfactuals</h3><button class="icon-btn" data-close aria-label="Close">${I.UI.close}</button></div>
      <div class="drawer-body scroll" id="planBody"></div>`;
    el.querySelector('[data-close]').addEventListener('click', () => app.setDrawer(null));
    const body = el.querySelector('#planBody');
    let planner = null, kDecision = -1;

    function ensure() {
      if (!planner || planner._e !== app.engine) { planner = root.TWIN.interventions.create(app.engine); planner._e = app.engine; singles = {}; result = null; }
    }
    function render(force) {
      if (el.hidden) return;
      ensure();
      const v = app.view;
      if (kDecision !== v.kInfo) { kDecision = v.kInfo; singles = {}; result = null; }
      if (!force && body._k === v.kInfo && !body._dirty) return;
      body._k = v.kInfo; body._dirty = false;
      const used = [...chosen].reduce((s, id) => s + planner.CATALOG.find((a) => a.id === id).cost, 0);
      body.innerHTML = `
        <div class="budget"><span class="sec-title">Crew budget</span>
          <div style="display:flex;align-items:center;gap:10px">
            <div class="budget-pips">${Array.from({ length: Math.max(budget, used) }, (_, n) => `<i class="${n < used ? (used > budget ? 'over' : 'used') : ''}"></i>`).join('')}</div>
            <div class="seg" id="budgetSeg">${[3, 5, 7].map((b) => `<button data-b="${b}" aria-pressed="${b === budget}">${b}</button>`).join('')}</div></div></div>
        <div class="acts">${planner.CATALOG.map((a) => {
          const s = singles[a.id];
          return `<label class="act"><input type="checkbox" data-id="${a.id}" ${chosen.has(a.id) ? 'checked' : ''}>
            <span class="act-name">${esc(a.label)}</span><span class="act-cost">${a.cost} crew${a.cost > 1 ? 's' : ''}</span>
            <span class="act-detail">${esc(a.detail)}</span>
            ${a.side ? `<span class="act-side">Side effect: ${esc(a.side)}</span>` : ''}
            <span class="act-gain">${s ? `alone: ${fmtPct(s.reduction)} critical facility-hours · ${fmtPct(s.careReduction)} hospital/EMS` : 'alone: evaluating…'}</span></label>`;
        }).join('')}</div>
        <div style="display:flex;gap:8px;margin-top:12px">
          <button class="btn" id="recBtn">${I.UI.check} Recommend within budget</button>
          <button class="btn" id="clearBtn">Clear</button></div>
        <div id="outcome"></div>
        <div class="val-note">Decision time ${fmtT(v.tInfo)}. Each option is re-simulated from that moment on the 32 storm members that best match the evidence so far; nothing after ${fmtT(v.tInfo)} is used.</div>`;
      body.querySelector('#budgetSeg').addEventListener('click', (e) => { const b = e.target.closest('[data-b]'); if (b) { budget = +b.dataset.b; body._dirty = true; render(true); } });
      body.querySelector('.acts').addEventListener('change', (e) => {
        const id = e.target.dataset.id; if (!id) return;
        e.target.checked ? chosen.add(id) : chosen.delete(id);
        evaluate();
      });
      body.querySelector('#recBtn').addEventListener('click', () => {
        if (busy) return;
        busy = true; body.querySelector('#recBtn').textContent = 'Searching…';
        setTimeout(() => { chosen = new Set(planner.recommend(app.view.kInfo, budget)); busy = false; evaluate(); }, 30);
      });
      body.querySelector('#clearBtn').addEventListener('click', () => { chosen.clear(); result = null; body._dirty = true; render(true); });
      drawOutcome();
      // Fill per-action estimates lazily so the drawer opens instantly.
      const pending = planner.CATALOG.filter((a) => !singles[a.id]);
      if (pending.length) setTimeout(() => {
        for (const a of pending) singles[a.id] = planner.evaluate(app.view.kInfo, [a.id], 24);
        body._dirty = true; render(true);
      }, 60);
    }
    function evaluate() {
      result = chosen.size ? planner.evaluate(app.view.kInfo, [...chosen]) : null;
      body._dirty = true; render(true);
    }
    const fmtPct = (x) => (x >= 0 ? '−' : '+') + Math.abs(Math.round(x * 100)) + '%';
    function drawOutcome() {
      const out = body.querySelector('#outcome');
      if (!result) { out.innerHTML = ''; return; }
      const F = app.engine.F, r = result;
      const used = r.cost;
      out.innerHTML = `<div class="outcome">
        <div class="sec-head" style="margin:0"><span class="sec-title">Expected outcome · ${used} of ${budget} crews${used > budget ? ' <span class="bad">over budget</span>' : ''}</span>
        <span class="pill ${r.cascadeBroken ? 'r-normal' : r.reduction > 0.08 ? 'r-watch' : 'r-high'}">${r.cascadeBroken ? 'Cascade broken' : r.reduction > 0.08 ? 'Mitigated' : 'Marginal'}</span></div>
        <div class="outcome-grid">
          <div><div class="k">Critical facility-hours</div><div class="v">${r.with.critHours.toFixed(0)}</div><div class="d ${r.reduction > 0 ? 'good' : 'bad'}">${fmtPct(r.reduction)} vs ${r.base.critHours.toFixed(0)}</div></div>
          <div><div class="k">Hospital & EMS hours</div><div class="v">${r.with.careHours.toFixed(1)}</div><div class="d ${r.careReduction > 0 ? 'good' : 'bad'}">${fmtPct(r.careReduction)} vs ${r.base.careHours.toFixed(1)}</div></div>
          <div><div class="k">P(hospital critical)</div><div class="v">${Math.round(r.with.hospCrit * 100)}%</div><div class="d ${r.with.hospCrit <= r.base.hospCrit ? 'good' : 'bad'}">was ${Math.round(r.base.hospCrit * 100)}%</div></div>
        </div>
        ${r.sideEffects.length ? `<div class="act-side" style="margin-top:8px">Side effects: ${r.sideEffects.map((s) => `${esc(F[s.i].name)} peak +${Math.round(s.delta * 100)} pts`).join(' · ')}</div>` : ''}
      </div>`;
    }
    return { render };
  }

  function createValid(app) {
    const el = document.getElementById('drawerValid');
    el.innerHTML = `
      <div class="drawer-head"><h3><b>Temporal validation</b>Replay vs ground truth</h3><button class="icon-btn" data-close aria-label="Close">${I.UI.close}</button></div>
      <div class="drawer-body scroll" id="validBody"></div>`;
    el.querySelector('[data-close]').addEventListener('click', () => app.setDrawer(null));
    const body = el.querySelector('#validBody');
    function render() {
      if (el.hidden) return;
      const e = app.engine, V = e.validation();
      if (body._e === e) return;
      body._e = e;
      const leads = V.leads.filter((l) => !l.missed).sort((a, b) => b.lead - a.lead).slice(0, 6);
      body.innerHTML = `
        <div class="val-grid">
          <div><div class="val-k">Median lead</div><div class="val-v">${V.medianLead.toFixed(1)}<small class="faint" style="font-size:11px"> h</small></div><div class="val-s">warning → critical</div></div>
          <div><div class="val-k">Detection</div><div class="val-v">${Math.round(V.pod * 100)}%</div><div class="val-s">${V.hits} of ${V.events} events</div></div>
          <div><div class="val-k">False alarms</div><div class="val-v">${Math.round(V.far * 100)}%</div><div class="val-s">${V.falseAlarms} of ${V.alarms} warnings</div></div>
          <div><div class="val-k">Brier score</div><div class="val-v">${V.brier.toFixed(3)}</div><div class="val-s">skill ${V.bss >= 0 ? '+' : ''}${V.bss.toFixed(2)} vs climatology</div></div>
        </div>
        <div class="sec-head" style="margin-top:14px"><span class="sec-title">Reliability · P(critical within 6/12/24 h)</span><span class="caps">${V.pairs.toLocaleString()} forecasts</span></div>
        <canvas class="chart" id="relCanvas" style="height:150px"></canvas>
        <div class="sec-head" style="margin-top:12px"><span class="sec-title">Longest lead times</span></div>
        <div class="drivers">${leads.map((l) => `<div class="drv"><span class="drv-name">${esc(e.F[l.i].name)}</span><span class="drv-val">${l.lead.toFixed(1)} h</span><span class="drv-ev">critical at ${fmtT(l.tc)} · first 24 h warning at ${fmtT(l.tc - l.lead)}</span></div>`).join('')}</div>
        <div class="val-note">Every forecast is issued with only the sensor data available at its time stamp (strict future-data isolation) and scored against the hidden ground-truth run, which the system never reads. Warning rule: P(critical within 24 h) ≥ 60%.</div>`;
      drawReliability(body.querySelector('#relCanvas'), V.bins);
    }
    function drawReliability(canvas, bins) {
      const { g, w, h } = root.TWIN.charts.prep(canvas, 150);
      const pad = { l: 28, r: 10, t: 8, b: 20 };
      const X = (p) => pad.l + p * (w - pad.l - pad.r), Y = (p) => pad.t + (1 - p) * (h - pad.t - pad.b);
      g.font = '500 9px ' + getComputedStyle(document.documentElement).getPropertyValue('--font-mono');
      g.strokeStyle = 'rgba(255,255,255,0.07)'; g.fillStyle = '#6a737e';
      for (const p of [0, 0.25, 0.5, 0.75, 1]) {
        g.beginPath(); g.moveTo(X(0), Y(p) + 0.5); g.lineTo(X(1), Y(p) + 0.5); g.stroke();
        g.fillText(p.toFixed(2), 2, Y(p) + 3); g.fillText(p.toFixed(2), X(p) - 10, h - 6);
      }
      g.setLineDash([3, 3]); g.strokeStyle = 'rgba(255,255,255,0.3)'; g.beginPath(); g.moveTo(X(0), Y(0)); g.lineTo(X(1), Y(1)); g.stroke(); g.setLineDash([]);
      const pts = bins.filter((b) => b.n > 20);
      g.strokeStyle = '#79a7e3'; g.lineWidth = 1.6; g.beginPath();
      pts.forEach((b, j) => (j ? g.lineTo(X(b.p), Y(b.o)) : g.moveTo(X(b.p), Y(b.o)))); g.stroke();
      for (const b of pts) { g.fillStyle = '#79a7e3'; g.beginPath(); g.arc(X(b.p), Y(b.o), 2 + Math.min(4, Math.sqrt(b.n) / 12), 0, Math.PI * 2); g.fill(); }
    }
    return { render, reset: () => (body._e = null) };
  }

  root.TWIN.drawers = { createGraph, createPlan, createValid };
})(typeof window !== 'undefined' ? window : globalThis);
