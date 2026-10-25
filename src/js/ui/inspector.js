/* Right inspector: the selected facility's live view, risk, forecast and causal trace. */
(function (root) {
  const C = root.TWIN.core;
  const { stateOf, fmtDur, fmtT, clamp } = C;
  const I = root.TWIN.icons;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // Physical readings implied by a risk level, per facility kind (display only).
  function reading(f, kind, r, rain) {
    switch (kind) {
      case 'drainage': return { capK: 'Channel capacity', cap: clamp(0.18 + 0.95 * r, 0, 1.35), readK: 'Stage', read: (1.6 + 15.5 * r).toFixed(1), unit: 'ft' };
      case 'pump': return { capK: 'Pump duty', cap: clamp(0.25 + 0.85 * r, 0, 1.2), readK: 'Wet well', read: Math.round(20 + 78 * r), unit: '%' };
      case 'traffic': return { capK: 'Volume / capacity', cap: clamp(0.3 + 0.85 * r, 0, 1.3), readK: 'Avg speed', read: Math.round((f.subtype === 'Interchange' ? 62 : 38) * (1 - 0.86 * clamp((r - 0.15) / 0.85, 0, 1))), unit: 'mph' };
      case 'power': return { capK: 'Transformer load', cap: clamp(0.38 + 0.72 * r, 0, 1.25), readK: 'Bus voltage', read: (f.voltage || '').split(/[ /]/)[0] || '—', unit: f.voltage ? 'kV' : '' };
      case 'hospital': return { capK: 'Bed occupancy', cap: clamp(0.58 + 0.46 * r, 0, 1.08), readK: 'ED wait', read: Math.round(25 + 260 * Math.max(0, r - 0.3)), unit: 'min' };
      case 'ems': return { capK: 'Units committed', cap: clamp(0.22 + 0.85 * r, 0, 1), readK: 'Response', read: (6.5 + 11 * r).toFixed(1), unit: 'min' };
      default: return { capK: 'Rain rate', cap: clamp(rain / 30, 0, 1), readK: 'Hazard index', read: Math.round(r * 100), unit: '' };
    }
  }

  function create(app) {
    const el = document.getElementById('inspector');
    const E = () => app.engine;
    let feed = null, cur = null, lastK = '';

    function open(i) {
      cur = i;
      const f = app.geo.facilities[i];
      el.innerHTML = `
        <div class="insp-head">
          <div class="insp-top"><div><span class="chip-id">${esc(f.id)}</span><span class="chip-type">${esc(f.subtype)}</span></div>
            <button class="icon-btn" id="inspClose" aria-label="Close inspector">${I.UI.close}</button></div>
          <h2 class="insp-name">${esc(f.name)}</h2>
          <div class="insp-loc">${esc(f.district)}${f.address ? ' · ' + esc(f.address) : ''} · Raleigh, NC</div>
          <div class="insp-coord">${f.lngLat[1].toFixed(5)}° N, ${Math.abs(f.lngLat[0]).toFixed(5)}° W · ${esc(f.source)}</div>
        </div>
        <div class="insp-body scroll">
          <div class="feed"><canvas id="feedCanvas"></canvas><span class="feed-tag" id="feedTag"><i></i>${esc(f.sensor)} · LIVE</span><span class="feed-ts" id="feedTs"></span></div>
          <div class="primary">
            <div class="ring"><canvas id="ringCanvas"></canvas><div class="ring-val"><b id="ringVal">0%</b><small>Risk index</small></div></div>
            <div class="primary-meta">
              <span class="label">Current state</span>
              <span id="statePill"></span>
              <span class="trend" id="trend"></span>
            </div>
          </div>
          <div class="stats" id="stats"></div>
          <div class="sec"><div class="sec-head"><span class="sec-title">Inbound cascade sources</span><span class="caps" id="inCount"></span></div><div class="compass" id="compass"></div></div>
          <div class="sec"><div class="sec-head"><span class="sec-title">Multi-horizon forecast</span><span class="caps" id="fcIssued"></span></div>
            <canvas class="chart" id="fcCanvas" style="height:132px"></canvas><div class="horizons" id="horizons"></div></div>
          <div class="sec"><div class="sec-head"><span class="sec-title">Hourly peak risk · last 12 h</span></div><canvas class="chart" id="barCanvas" style="height:92px"></canvas></div>
          <div class="sec"><div class="sec-head"><span class="sec-title">Why this risk · causal trace</span></div><div class="chain" id="chain"></div><div class="drivers" id="drivers"></div></div>
        </div>`;
      el.querySelector('#inspClose').addEventListener('click', () => app.select(null));
      el.querySelector('#drivers').addEventListener('click', (e) => { const b = e.target.closest('[data-goto]'); if (b) app.select(+b.dataset.goto, { fly: true }); });
      el.querySelector('#chain').addEventListener('click', (e) => { const b = e.target.closest('[data-goto]'); if (b) app.select(+b.dataset.goto, { fly: true }); });
      if (feed) feed.stop();
      feed = root.TWIN.feed.create(el.querySelector('#feedCanvas'));
      feed.start();
      lastK = '';
      update(true);
    }
    function close() { cur = null; if (feed) { feed.stop(); feed = null; } }

    function update(force) {
      if (cur == null) return;
      const v = app.view;
      const key = `${v.k}|${v.kInfo}|${v.mode}`;
      if (!force && key === lastK) return;
      lastK = key;
      const e = E(), i = cur, f = app.geo.facilities[i], kind = e.kinds[i];
      const r = v.R[i], sd = e.nowSd[v.kInfo * e.N + i], tr = v.trust[i];
      const fc = e.forecast(v.kInfo, i);
      const rain = e.rainField(e.radarParams(v.t, v.kNow), f.lngLat[0], f.lngLat[1], v.t);
      const st = stateOf(r);
      const rd = reading(f, kind, r, rain);
      const offline = Number.isNaN(e.obs[v.kInfo * e.N + i]);

      // feed
      const upFlood = e.inEdges[i].reduce((m, en) => { const ed = e.E[en]; return e.kinds[ed.from] === 'drainage' ? Math.max(m, clamp((v.R[ed.from] - 0.55) / 0.35, 0, 1)) : m; }, 0);
      feed.set({ kind, risk: r, rain, flood: upFlood, voltage: f.voltage, offline });
      const tag = el.querySelector('#feedTag');
      tag.classList.toggle('off', offline);
      tag.lastChild.textContent = `${f.sensor} · ${offline ? 'OFFLINE' : v.forecastView ? 'LAST FRAME' : v.mode === 'historical' ? 'ARCHIVE' : 'LIVE'}`;
      const ck = C.clockAt(app.geo.t0, v.forecastView ? v.tNow : v.t);
      el.querySelector('#feedTs').textContent = `${ck.day} ${ck.time} EDT`;

      // primary
      root.TWIN.charts.ring(el.querySelector('#ringCanvas'), r, v.forecastView ? 0 : sd);
      el.querySelector('#ringVal').textContent = Math.round(r * 100) + '%';
      el.querySelector('#ringVal').style.color = C.RISK_HEX[st.key];
      el.querySelector('#statePill').innerHTML = `<span class="pill r-${st.key}"><span class="dot"></span>${st.label}</span>`;
      const kPrev = Math.max(0, v.kInfo - 4);
      const d3 = r - e.now[kPrev * e.N + i];
      const h6 = fc.horizons.find((h) => h.h === 6);
      el.querySelector('#trend').innerHTML = `${d3 >= 0 ? '<span class="up">▲</span>' : '<span class="down">▼</span>'} ${(Math.abs(d3) * 100).toFixed(0)} pts / 2 h · +6 h → ${Math.round(h6.mean * 100)}%`;

      // stats
      const crit = r >= 0.75;
      const eta = crit ? 'Now' : fc.ttc.prob < 0.15 ? 'Not expected' : fmtDur(fc.ttc.median);
      const etaSub = crit ? 'above critical' : fc.ttc.prob < 0.15 ? `p ${Math.round(fc.ttc.prob * 100)}% in window` : `${fmtDur(fc.ttc.p10)}–${fmtDur(fc.ttc.p90)} · p ${Math.round(fc.ttc.prob * 100)}%`;
      const capCls = 'r-' + stateOf(clamp(rd.cap - 0.2, 0, 1)).key;
      const nAct = e.inEdges[i].filter((en) => e.edgePosterior(v.kInfo, en).active).length;
      el.querySelector('#stats').innerHTML = [
        `<div class="stat ${capCls}"><div class="stat-k">${rd.capK}</div><div class="stat-v">${Math.round(rd.cap * 100)}<small>%</small></div><div class="bar"><i style="width:${Math.min(100, rd.cap * 100)}%"></i></div></div>`,
        `<div class="stat"><div class="stat-k">ETA to critical</div><div class="stat-v" style="font-size:${eta.length > 7 ? 13 : 16}px">${eta}</div><div class="stat-s">${etaSub}</div></div>`,
        `<div class="stat"><div class="stat-k">P(critical · 24 h)</div><div class="stat-v">${Math.round((crit ? Math.max(fc.p24, 0.99) : fc.p24) * 100)}<small>%</small></div><div class="stat-s">calibrated ensemble</div></div>`,
        `<div class="stat r-${tr > 0.75 ? 'normal' : tr > 0.5 ? 'watch' : 'critical'}"><div class="stat-k">Sensor trust</div><div class="stat-v">${Math.round(tr * 100)}<small>%</small></div><div class="bar"><i style="width:${tr * 100}%"></i></div></div>`,
        `<div class="stat"><div class="stat-k">${rd.readK}</div><div class="stat-v">${offline ? '—' : rd.read}<small>${rd.unit}</small></div><div class="stat-s">${esc(f.sensor)}${offline ? ' offline' : ''}</div></div>`,
        `<div class="stat"><div class="stat-k">Uncertainty</div><div class="stat-v">±${Math.round(sd * 100)}<small>pts</small></div><div class="stat-s">${nAct} upstream active</div></div>`,
      ].join('');

      // inbound compass
      const q = e.inbound(v.kInfo, i);
      const total = e.inEdges[i].length;
      el.querySelector('#inCount').textContent = `${total} candidate links`;
      const cell = (key, cls) => {
        const list = q[key], act = list.filter((x) => x.active), flow = act.reduce((s, x) => s + x.flow, 0);
        const top = act.sort((a, b) => b.flow - a.flow)[0] || list[0];
        const rc = act.length ? 'r-' + stateOf(Math.max(...act.map((x) => v.R[x.from]))).key : '';
        return `<div class="cq ${cls} ${act.length ? 'active ' + rc : ''}"><div class="cq-k">${{ N: 'NORTH', E: 'EAST', S: 'SOUTH', W: 'WEST' }[key]}</div>
          <div class="cq-v">${act.length}<small class="faint" style="font-size:10px"> / ${list.length}</small></div>
          <div class="cq-s">${top ? esc(app.geo.facilities[top.from].name.split(' at ')[0]) + (act.length ? ` · +${flow.toFixed(2)}` : '') : 'none'}</div></div>`;
      };
      el.querySelector('#compass').innerHTML = cell('N', 'cq-n') + cell('W', 'cq-w') +
        `<div class="cq-c"><svg viewBox="0 0 30 33" width="40" height="44"><path d="M15 1.2 28.2 8.8v15.4L15 31.8 1.8 24.2V8.8z" fill="rgba(10,12,15,.9)" stroke="${C.RISK_HEX[st.key]}" stroke-width="1.6"/></svg></div>` +
        cell('E', 'cq-e') + cell('S', 'cq-s-');

      // forecast chart
      const t0 = Math.max(0, v.tInfo - 24), t1 = Math.min(72, v.tInfo + 36);
      const past = [];
      for (let k = Math.round(t0 / e.DT); k <= v.kInfo; k++) past.push({ t: k * e.DT, v: e.now[k * e.N + i] });
      const series = fc.series.filter((s) => s.t <= t1).map((s) => ({ t: s.t, mean: s.mean, p10: s.p10, p90: s.p90 }));
      let truth = null;
      if (v.mode === 'historical') { truth = []; for (let k = Math.round(t0 / e.DT); k <= Math.round(t1 / e.DT); k++) truth.push({ t: k * e.DT, v: e.truth[k * e.N + i] }); }
      root.TWIN.charts.forecast(el.querySelector('#fcCanvas'), { t0, t1, past, series, truth, tNow: v.tInfo, tView: v.t, vView: r });
      el.querySelector('#fcIssued').textContent = `issued ${fmtT(v.tInfo)}${truth ? ' · dotted = actual' : ''}`;
      el.querySelector('#horizons').innerHTML = fc.horizons.filter((h) => h.h !== 72).map((h) => h.beyond
        ? `<div class="hz"><div class="hz-k">+${h.h}H</div><div class="hz-v faint">—</div><div class="hz-p">beyond 72 h</div></div>`
        : `<div class="hz r-${stateOf(h.mean).key}"><div class="hz-k">+${h.h}H</div><div class="hz-v">${Math.round(h.mean * 100)}%</div><div class="hz-p">p ${Math.round(h.pCrit * 100)}%</div></div>`).join('');

      // hourly peaks
      const vals = [], labels = [];
      for (let hh = 11; hh >= 0; hh--) {
        const kEnd = v.kInfo - hh * 2;
        if (kEnd < 0) { vals.push(null); labels.push(''); continue; }
        let pk = 0;
        for (let k = Math.max(0, kEnd - 1); k <= kEnd; k++) pk = Math.max(pk, e.now[k * e.N + i]);
        vals.push(pk);
        labels.push(hh % 3 === 0 ? (hh ? `-${hh}h` : 'now') : '');
      }
      root.TWIN.charts.bars(el.querySelector('#barCanvas'), vals, labels);

      // causal trace
      const ex = e.explain(v.kInfo, i);
      const chain = traceChain(e, v, i);
      el.querySelector('#chain').innerHTML = chain.map((c, n) => (n ? '<span class="chain-arrow">→</span>' : '') +
        (c.i == null ? `<span class="chain-node"><span class="dot" style="background:var(--water)"></span>${c.label}</span>`
          : `<button class="chain-node" data-goto="${c.i}"><span class="dot r-${stateOf(v.R[c.i]).key}"></span>${esc(app.geo.facilities[c.i].id)}</button>`)).join('');
      const maxV = Math.max(...ex.drivers.map((d) => Math.max(0, d.value)), 0.01);
      el.querySelector('#drivers').innerHTML = ex.drivers.filter((d) => d.kind !== 'edge' || d.value > 0.004 || d.status === 'pruned').slice(0, 7).map((d) => {
        if (d.kind === 'edge') {
          const fr = app.geo.facilities[d.from];
          const rdUp = reading(fr, e.kinds[d.from], d.upstreamRisk, 0);
          return `<button class="drv r-${stateOf(d.upstreamRisk).key}" data-goto="${d.from}">
            <span class="drv-name">${esc(fr.name)}</span><span class="drv-val">+${d.value.toFixed(2)}</span>
            <span class="drv-bar"><i style="width:${(Math.max(0, d.value) / maxV) * 100}%"></i></span>
            <span class="drv-ev">${esc(d.mechanism)}<br>lag ${d.lag} h · weight ${d.weight.toFixed(2)} ± ${d.sd.toFixed(2)} · <span class="st-${d.status}">${d.status}</span> · ${esc(fr.sensor)} ${rdUp.readK.toLowerCase()} ${Number.isNaN(d.upstreamObs) ? 'offline' : rdUp.read + ' ' + rdUp.unit} · trust ${Math.round(d.upstreamTrust * 100)}%</span></button>`;
        }
        const hazard = d.kind === 'hazard';
        const wxName = d.wx ? app.geo.facilities[app.engine.idx[d.wx]] : null;
        const ev = hazard ? (d.rain > 0.2 ? `${d.rain.toFixed(1)} mm/h estimated on the catchment${wxName ? ' · nearest gauge ' + esc(wxName.sensor) : ''}` : 'Scenario hazard at this location') : 'Normal load for this hour and day';
        return `<div class="drv"><span class="drv-name">${esc(d.label)}</span><span class="drv-val">${hazard ? '+' : ''}${d.value.toFixed(2)}</span>
          <span class="drv-bar"><i style="width:${(Math.max(0, d.value) / maxV) * 100}%;background:${hazard ? 'var(--water)' : 'var(--text-4)'}"></i></span><span class="drv-ev">${ev}</span></div>`;
      }).join('');
    }

    // Follow the strongest upstream contribution until the hazard or baseline dominates.
    function traceChain(e, v, i) {
      const out = [{ i }];
      const seen = new Set([i]);
      let cur_ = i;
      for (let depth = 0; depth < 5; depth++) {
        const ex = e.explain(v.kInfo, cur_);
        const edge = ex.drivers.find((d) => d.kind === 'edge' && d.value > 0.03 && !seen.has(d.from));
        const hazard = ex.drivers.find((d) => d.kind === 'hazard');
        if (!edge || (hazard && hazard.value > edge.value * 1.2)) {
          if (hazard && hazard.value > 0.03) out.unshift({ i: null, label: { drainage: 'Rainfall', pump: 'Rainfall', traffic: 'Rain', power: 'Heat / wind', hospital: 'Heat', ems: 'Storm calls', weather: 'Storm' }[e.kinds[cur_]] });
          break;
        }
        out.unshift({ i: edge.from });
        seen.add(edge.from);
        cur_ = edge.from;
      }
      return out;
    }

    return { open, close, update, get current() { return cur; } };
  }

  root.TWIN.inspector = { create, reading };
})(typeof window !== 'undefined' ? window : globalThis);
