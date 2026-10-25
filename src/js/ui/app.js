/* Application orchestrator: state, view computation, render loop and controls. */
(function (root) {
  const T = root.TWIN;
  const C = T.core;
  const { stateOf, RISK_HEX, fmtT, clamp } = C;
  const I = T.icons.UI;
  const LIVE_NOW = 34.5;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

  const app = {
    geo: root.TWIN_GEO,
    engine: null,
    state: {
      scenario: 'tropical', mode: 'live', nowT: LIVE_NOW, t: LIVE_NOW, playing: false, speed: 2, streaming: false,
      selected: null, drawer: null, orbit: false,
      layers: { drainage: true, traffic: true, power: true, hospital: true, weather: true, flows: true, arcs: false, buildings: true, labels: true },
    },
    view: null,
  };

  // ── View ───────────────────────────────────────────────────────────────
  function computeView() {
    const e = app.engine, s = app.state;
    const k = e.kOf(s.t);
    const kNow = s.mode === 'live' ? e.kOf(s.nowT) : e.K - 1;
    const forecastView = s.mode === 'live' && k > kNow;
    const kInfo = forecastView ? kNow : k;
    const R = forecastView ? e.project(kNow, k) : e.stateAt(k).risk;
    return {
      k, kNow, kInfo, forecastView, mode: s.mode, t: s.t, tNow: s.mode === 'live' ? s.nowT : e.HOURS, tInfo: kInfo * e.DT,
      R, trust: e.stateAt(kInfo).trust,
    };
  }

  // ── Init ───────────────────────────────────────────────────────────────
  async function init() {
    const step = (s) => { $('loadingStep').textContent = s; return nextFrame(); };
    await step('Assimilating 72 h of sensor streams · 200-member ensemble…');
    app.engine = T.engine.create(app.geo, { scenario: app.state.scenario });
    app.view = computeView();

    await step('Loading Raleigh city model · OpenStreetMap buildings and streets…');
    const tm = await T.twinmap.create($('map'), app.geo, root.TWIN_CONFIG || {});
    app.tm = tm;
    app.map = tm.map;
    app.layers = T.layers.install(tm.map, app.geo, { labelFont: tm.labelFont });
    app.radar = T.radar.install(tm.map, app.geo, 'arcs-confirmed');
    app.markers = T.markers.install(tm.gl, tm.map, app.geo, (i) => app.select(i, { fly: true }));
    precomputePaths();

    await step('Starting command center…');
    app.sidebar = T.sidebar.create(app);
    app.inspector = T.inspector.create(app);
    app.timeline = T.timeline.create(app);
    app.graph = T.drawers.createGraph(app);
    app.plan = T.drawers.createPlan(app);
    app.valid = T.drawers.createValid(app);
    wireControls();
    for (const [k, on] of Object.entries(app.state.layers)) applyLayer(k, on);
    applyPadding();
    renderAll(true);
    $('loading').classList.add('done');
    setTimeout(() => $('loading').remove(), 600);
    tm.map.jumpTo({ ...tm.OVERVIEW, zoom: tm.OVERVIEW.zoom - 0.9, pitch: 30, bearing: tm.OVERVIEW.bearing - 40 });
    tm.overview({ duration: 2600 });
    requestAnimationFrame(loop);
  }

  // Arc geometry for power/feed links and the dependency-arc layer.
  function precomputePaths() {
    const F = app.geo.facilities, frame = T.geom.frame(app.geo.center);
    app.paths = app.engine.E.map((ed) => {
      const a = F[ed.from].lngLat, b = F[ed.to].lngLat;
      const routed = ed.path && ed.path.length > 2 ? ed.path : T.geom.arc(a, b, 0.14, 24, frame);
      return { routed, arc: T.geom.arc(a, b, 0.2, 28, frame) };
    });
  }

  // ── Rendering ──────────────────────────────────────────────────────────
  let lastKey = '';
  function renderAll(force) {
    const v = (app.view = computeView());
    const key = `${v.k}|${v.kInfo}|${v.mode}|${app.state.scenario}|${app.state.selected}|${app.state.layers.arcs}`;
    renderLight(v);
    if (!force && key === lastKey) return;
    lastKey = key;
    const e = app.engine;
    // Map
    app.markers.update(v.R, v.trust);
    app.layers.update(v.R, { diurnal: e.diurnal(v.t), flows: flows(v), arcs: app.state.layers.arcs ? arcs(v) : null });
    if (app.state.layers.weather) drawRadar(v);
    // Panels
    app.sidebar.updateList(v.R, v.trust, app.state.selected);
    const kAlert = v.forecastView ? v.kNow : v.k;
    app.sidebar.updateAlerts(e.alerts.filter((a) => a.k <= kAlert), Math.min(v.t, v.tNow));
    app.inspector.update(true);
    renderTop(v);
    renderStrip(v);
    renderLegend();
    app.graph.render();
    app.plan.render();
    app.valid.render();
    if (app.state.playing) detectStageEvents(v);
  }

  function renderLight(v) {
    app.timeline.update(v);
    const ck = C.clockAt(app.geo.t0, v.t);
    $('clockT').textContent = fmtT(v.t);
    $('clockD').textContent = `${ck.day} · ${ck.time} EDT`;
    const tag = $('clockTag');
    if (v.mode === 'historical') { tag.textContent = 'REPLAY'; tag.className = 'clock-tag'; }
    else if (v.forecastView) { tag.textContent = `FORECAST +${(v.t - v.tNow).toFixed(1)}h`; tag.className = 'clock-tag forecast'; }
    else if (v.t < v.tNow - 0.01) { tag.textContent = `PAST −${(v.tNow - v.t).toFixed(1)}h`; tag.className = 'clock-tag'; }
    else { tag.textContent = app.state.streaming ? 'STREAMING' : 'LIVE'; tag.className = 'clock-tag'; }
    tag.title = v.mode === 'live' && Math.abs(v.t - v.tNow) > 0.01 ? 'Return to live' : '';
    tag.style.cursor = tag.title ? 'pointer' : '';
  }

  function flows(v) {
    if (!app.state.layers.flows) return [];
    const e = app.engine, out = [];
    for (const ed of e.E) {
      const ep = e.edgePosterior(v.kInfo, ed.n);
      if (ep.status === 'pruned') continue;
      const flow = ep.mean * e.g(v.R[ed.from], ed.from);
      if (flow < 0.02) continue;
      const tk = e.kinds[ed.to];
      const kind = tk === 'drainage' || tk === 'pump' ? 'water' : tk === 'traffic' ? 'traffic' : 'cascade';
      out.push({ path: app.paths[ed.n].routed, kind, flow: clamp(flow * 2.6, 0.15, 1) });
    }
    return out;
  }
  function arcs(v) {
    const e = app.engine;
    return e.E.map((ed) => {
      const ep = e.edgePosterior(v.kInfo, ed.n);
      return { path: app.paths[ed.n].arc, status: ep.status, mean: ep.mean, active: ep.active };
    });
  }

  let radarTimer = 0;
  function drawRadar(v) {
    const e = app.engine;
    const sp = e.radarParams(v.t, v.kNow);
    app.radar.draw((lng, lat, t) => e.rainField(sp, lng, lat, t), v.t, e.scen.heading);
  }

  function renderTop(v) {
    const e = app.engine;
    const city = v.forecastView ? null : e.cityAt(v.kInfo);
    let risk;
    if (city) risk = city.risk;
    else {
      let mx = 0, sum = 0, n = 0, nc = 0;
      for (let i = 0; i < e.N; i++) { if (e.kinds[i] === 'weather') continue; const w = 4 - e.F[i].tier; mx = Math.max(mx, v.R[i]); sum += v.R[i] * w; n += w; if (v.R[i] >= 0.75) nc++; }
      risk = clamp(0.5 * (sum / n) + 0.5 * mx - (nc < 2 ? 0.08 : 0) + 0.04 * Math.max(0, nc - 2), 0, 1);
    }
    const st = stateOf(risk);
    $('cityChip').innerHTML = `<span class="caps pill-label">City</span><span class="pill r-${st.key}"><span class="dot"></span>${st.label}</span>`;
    const ess = e.cityAt(v.kInfo).ess;
    const faults = Array.from(v.trust).filter((t, i) => t < 0.5 && e.kinds[i]).length;
    const sys = $('sys');
    sys.querySelector('.sys-led').classList.toggle('warn', faults > 0);
    sys.querySelector('.sys-text').textContent = `${e.N} feeds assimilated · ESS ${Math.round(ess)}/${e.M} · ${faults ? faults + ' sensor' + (faults > 1 ? 's' : '') + ' degraded' : 'all sensors healthy'}`;
    sys.title = `Renderer: ${app.tm.renderer}. Effective sample size of the particle filter averaged over facilities.`;
  }

  // Cascade strip: one stage per system, lit when it reaches HIGH, with the time it did
  // (observed) or is expected to (forecast).
  const STAGES = [['weather', 'Rainfall'], ['drainage', 'Drainage'], ['traffic', 'Traffic'], ['power', 'Power'], ['ems', 'EMS'], ['hospital', 'Hospital']];
  let seqCache = { k: -1, s: '', seq: [] };
  function renderStrip(v) {
    const e = app.engine;
    if (seqCache.k !== v.kInfo || seqCache.s !== app.state.scenario) seqCache = { k: v.kInfo, s: app.state.scenario, seq: e.cascade(v.kInfo) };
    const first = {};
    for (const c of seqCache.seq) {
      const gk = e.kinds[c.i] === 'pump' ? 'drainage' : e.kinds[c.i];
      if (c.level === 'HIGH RISK' && !(gk in first)) first[gk] = c;
    }
    let nCritGroups = 0;
    const html = STAGES.map(([g, label], n) => {
      let mx = 0;
      for (let i = 0; i < e.N; i++) { const gk = e.kinds[i] === 'pump' ? 'drainage' : e.kinds[i]; if (gk === g) mx = Math.max(mx, v.R[i]); }
      if (mx >= 0.75 && g !== 'weather') nCritGroups++;
      const st = stateOf(mx).key;
      const f = first[g];
      const on = mx >= 0.55 || (g === 'weather' && mx >= 0.35);
      const fc = !on && f && !f.observed && f.prob >= 0.5;
      const t = on && f ? fmtT(f.t) : fc ? '~' + fmtT(f.t) : '';
      return (n ? '<span class="stage-arrow">→</span>' : '') + `<span class="stage r-${st} ${on ? 'on' : fc ? 'fc' : ''}">${label}${t ? `<span class="st-t">${t}</span>` : ''}</span>`;
    }).join('');
    $('strip').innerHTML = html + (nCritGroups >= 3 ? '<span class="stage-arrow">→</span><span class="stage on r-critical">Critical cascade</span>' : '');
  }

  function renderLegend() {
    const L = app.state.layers, items = [];
    if (L.traffic) items.push('<span><i class="ln" style="border-color:#2b8a62"></i>Free flow</span><span><i class="ln" style="border-color:#ee8a2a"></i>Congested</span>');
    if (L.drainage) items.push('<span><i class="ln" style="border-color:#3f93d8"></i>Drainage within capacity</span><span><i class="fl"></i>Flood footprint (AR)</span>');
    if (L.power) items.push('<span><i style="height:8px;background:repeating-linear-gradient(135deg,rgba(229,72,77,.6) 0 2px,transparent 2px 5px)"></i>Outage risk area</span>');
    if (L.flows) items.push('<span><i class="ar water"></i>Water flow</span><span><i class="ar trf"></i>Traffic diversion</span><span><i class="ar cas"></i>Cascade spread</span>');
    $('legend').innerHTML = `<div class="legend-scale"><i style="background:${RISK_HEX.normal}"></i><i style="background:${RISK_HEX.watch}"></i><i style="background:${RISK_HEX.high}"></i><i style="background:${RISK_HEX.critical}"></i></div>
      <div class="legend-labels"><span>NORMAL</span><span>WATCH</span><span>HIGH</span><span>CRITICAL</span></div>
      <div class="legend-items">${items.join('')}</div>`;
  }

  function renderCrumbs() {
    const i = app.state.selected, F = app.geo.facilities;
    const home = `<button class="home" id="homeBtn">${I.home} City overview</button>`;
    $('crumbs').innerHTML = i == null
      ? `<span>Raleigh, NC</span><span class="sep">›</span><span class="cur">All districts</span>${app.state.orbit ? '' : ''}`
      : `<button class="crumb" id="crumbCity">Raleigh, NC</button><span class="sep">›</span><span>${esc(F[i].district)}</span><span class="sep">›</span><span class="cur">${esc(F[i].name)}</span>${home}`;
    const hb = $('homeBtn'); if (hb) hb.addEventListener('click', () => { app.select(null); app.tm.overview(); });
    const cc = $('crumbCity'); if (cc) cc.addEventListener('click', () => { app.select(null); app.tm.overview(); });
  }

  // Toasts and camera follow during playback: first critical facility per system.
  let announced = new Set(), lastFly = 0, toastTimer = 0;
  function detectStageEvents(v) {
    const e = app.engine;
    for (let i = 0; i < e.N; i++) {
      const g = e.kinds[i] === 'pump' ? 'drainage' : e.kinds[i];
      if (g === 'weather' || announced.has(g) || v.R[i] < 0.75) continue;
      announced.add(g);
      const names = { drainage: 'Drainage over capacity', traffic: 'Road network gridlock', power: 'Substation outage risk', ems: 'EMS response failing', hospital: 'Hospital capacity critical' };
      toast(`<b>Critical</b><span>${names[g]} · ${esc(e.F[i].name)} · ${fmtT(v.t)}</span>`);
      if (app.state.streaming && performance.now() - lastFly > 4500 && app.state.selected == null) {
        lastFly = performance.now();
        app.map.flyTo({ center: e.F[i].lngLat, zoom: 13.9, pitch: 58, duration: 1700, padding: app.tm.padding, essential: true });
      }
    }
  }
  function toast(html) {
    const el = $('toast');
    el.innerHTML = html; el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 3800);
  }

  // ── Loop ───────────────────────────────────────────────────────────────
  let lastT = 0, liveAcc = 0;
  function loop(now) {
    const dt = lastT ? Math.min(0.1, (now - lastT) / 1000) : 0;
    lastT = now;
    const s = app.state;
    if (s.playing) {
      s.t = Math.min(app.engine.HOURS, s.t + dt * s.speed);
      if (s.streaming) s.nowT = s.t;
      if (s.t >= app.engine.HOURS) { s.playing = false; if (s.streaming) { s.streaming = false; setTimeout(() => app.tm.overview(), 800); } }
      renderAll(false);
    } else if (s.mode === 'live' && !s.streaming && s.nowT < app.engine.HOURS) {
      // The live clock advances one simulated minute per second.
      liveAcc += dt;
      if (liveAcc >= 6) {
        liveAcc = 0;
        const follow = Math.abs(s.t - s.nowT) < 0.01;
        s.nowT = Math.min(app.engine.HOURS, Math.round((s.nowT + 0.1) * 10) / 10);
        if (follow) s.t = s.nowT;
        renderAll(false);
      }
    }
    app.layers.tick(now);
    if (s.layers.weather && now - radarTimer > 260) { radarTimer = now; app.radar.render(now); }
    requestAnimationFrame(loop);
  }

  // ── Actions ────────────────────────────────────────────────────────────
  app.select = function (i, opts = {}) {
    const s = app.state;
    s.selected = i;
    app.markers.select(i);
    app.layers.select(i);
    document.getElementById('app').classList.toggle('inspecting', i != null);
    if (i != null) {
      app.inspector.open(i);
      app.sidebar.scrollTo(i);
      if (opts.fly) { app.tm.orbit(false); s.orbit = false; $('orbit').setAttribute('aria-pressed', 'false'); }
    } else app.inspector.close();
    applyPadding();
    if (i != null && opts.fly) setTimeout(() => app.tm.flyToFacility(app.geo.facilities[i]), 30);
    renderCrumbs();
    renderAll(true);
  };
  app.focusAlert = function (i) {
    app.select(i, { fly: true });
    setTimeout(() => app.layers.highlight(i), 700);
  };
  app.setLayer = function (key, on) { app.state.layers[key] = on; applyLayer(key, on); renderAll(true); };
  function applyLayer(key, on) {
    if (key === 'weather') { app.radar.setVisible(on); app.markers.setTypeVisible('weather', on); return; }
    app.layers.setGroup(key, on);
    if (['drainage', 'traffic', 'power', 'hospital'].includes(key)) app.markers.setTypeVisible(key, on);
  }
  app.scrub = function (t) {
    const s = app.state;
    s.t = Math.round(t * 2) / 2;
    if (s.streaming) { s.streaming = false; s.playing = false; }
    renderAll(false);
  };
  app.scrubEnd = function () { renderAll(true); };
  app.togglePlay = function () {
    const s = app.state;
    if (s.t >= app.engine.HOURS - 0.01) s.t = s.mode === 'live' ? s.nowT : 0;
    s.playing = !s.playing;
    if (s.playing) announced = new Set(announcedBefore(s.t));
    renderAll(true);
  };
  function announcedBefore(t) {
    const e = app.engine, k = e.kOf(t), out = [];
    for (let i = 0; i < e.N; i++) if (e.now[k * e.N + i] >= 0.75) out.push(e.kinds[i] === 'pump' ? 'drainage' : e.kinds[i]);
    return out;
  }
  app.trigger = function () {
    const s = app.state;
    if (s.mode !== 'live') setMode('live', true);
    app.select(null);
    s.streaming = true; s.playing = true; s.nowT = 0; s.t = 0; announced = new Set();
    app.tm.overview({ duration: 1200 });
    toast('<b>Replay</b><span>Streaming sensor data from T+0. Forecasts and links update as evidence arrives.</span>');
    app.timeline.invalidate();
    renderAll(true);
  };
  app.reset = function () {
    const s = app.state;
    s.playing = false; s.streaming = false;
    s.mode = 'live'; s.nowT = LIVE_NOW; s.t = LIVE_NOW;
    $('modeLive').setAttribute('aria-pressed', 'true'); $('modeHist').setAttribute('aria-pressed', 'false');
    app.select(null);
    app.setDrawer(null);
    app.tm.orbit(false); s.orbit = false; $('orbit').setAttribute('aria-pressed', 'false');
    app.tm.overview();
    app.timeline.invalidate();
    renderAll(true);
  };
  function setMode(mode, quiet) {
    const s = app.state;
    s.mode = mode; s.playing = false; s.streaming = false;
    $('modeLive').setAttribute('aria-pressed', String(mode === 'live'));
    $('modeHist').setAttribute('aria-pressed', String(mode === 'historical'));
    if (mode === 'live') { s.nowT = LIVE_NOW; s.t = LIVE_NOW; }
    else { s.nowT = app.engine.HOURS; if (!quiet) app.setDrawer('valid'); }
    app.timeline.invalidate();
    renderAll(true);
  }
  app.setDrawer = function (d) {
    const s = app.state;
    s.drawer = s.drawer === d ? null : d;
    const map = { graph: ['drawerGraph', 'btnGraph'], plan: ['drawerPlan', 'btnPlan'], valid: ['drawerValid', 'btnValid'] };
    for (const [k, [el, btn]] of Object.entries(map)) { $(el).hidden = s.drawer !== k; $(btn).setAttribute('aria-pressed', String(s.drawer === k)); }
    app.graph.render(true); app.plan.render(true); app.valid.render(true);
  };
  async function setScenario(id) {
    const s = app.state;
    s.scenario = id; s.playing = false; s.streaming = false;
    const ld = document.createElement('div');
    ld.className = 'loading'; ld.style.background = 'rgba(9,11,14,0.82)';
    ld.innerHTML = `<div class="loading-title">${esc(T.scenarios[id].label)}</div><div class="loading-bar"><i></i></div><div class="loading-step">Re-running the 200-member ensemble and replaying the sensor streams…</div>`;
    $('app').appendChild(ld);
    await nextFrame(); await nextFrame();
    app.engine = T.engine.create(app.geo, { scenario: id });
    precomputePaths();
    app.graph.reset(); app.valid.reset(); app.timeline.invalidate();
    s.nowT = s.mode === 'live' ? LIVE_NOW : app.engine.HOURS;
    s.t = s.nowT;
    renderAll(true);
    if (s.selected != null) app.inspector.open(s.selected);
    ld.classList.add('done'); setTimeout(() => ld.remove(), 600);
    toast(`<b>Scenario</b><span>${esc(T.scenarios[id].blurb)}</span>`);
  }

  function applyPadding() {
    const narrow = window.innerWidth <= 960;
    const left = narrow ? 0 : parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--left-w')) + 10;
    const right = app.state.selected != null && !narrow ? parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--right-w')) + 10 : 10;
    const bottom = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--bottom-h')) + 10;
    app.tm.setPadding({ left, right, bottom, top: 56 });
  }

  // ── Controls ───────────────────────────────────────────────────────────
  function wireControls() {
    $('modeLive').addEventListener('click', () => setMode('live'));
    $('modeHist').addEventListener('click', () => setMode('historical'));
    $('clockTag').addEventListener('click', () => { if (app.state.mode === 'live') { app.state.t = app.state.nowT; renderAll(true); } });
    $('trigger').innerHTML = `${I.bolt} Trigger cascade`;
    $('reset').innerHTML = `${I.reset} Reset`;
    $('orbit').innerHTML = `${I.orbit} Auto-orbit`;
    $('btnGraph').innerHTML = `${I.graph}<span class="lbl">Dependency graph</span>`;
    $('btnPlan').innerHTML = `${I.plan}<span class="lbl">Interventions</span>`;
    $('btnValid').innerHTML = `${I.check}<span class="lbl">Validation</span>`;
    for (const [id, t] of [['btnGraph', 'Dependency graph'], ['btnPlan', 'Interventions'], ['btnValid', 'Validation']]) $(id).title = t;
    $('trigger').addEventListener('click', app.trigger);
    $('reset').addEventListener('click', app.reset);
    $('orbit').addEventListener('click', () => {
      const s = app.state;
      s.orbit = !s.orbit;
      $('orbit').setAttribute('aria-pressed', String(s.orbit));
      app.tm.orbit(s.orbit);
    });
    app.tm.onUserInteract(() => { if (app.state.orbit) { app.state.orbit = false; app.tm.orbit(false); $('orbit').setAttribute('aria-pressed', 'false'); } });
    $('btnGraph').addEventListener('click', () => app.setDrawer('graph'));
    $('btnPlan').addEventListener('click', () => app.setDrawer('plan'));
    $('btnValid').addEventListener('click', () => app.setDrawer('valid'));
    const sel = $('scenario');
    sel.innerHTML = Object.values(T.scenarios).map((s) => `<option value="${s.id}">${esc(s.label)}</option>`).join('');
    sel.value = app.state.scenario;
    sel.addEventListener('change', () => setScenario(sel.value));
    $('scenIco').innerHTML = I.chevron;
    // Map controls
    $('zoomIn').innerHTML = I.plus; $('zoomOut').innerHTML = I.minus; $('north').innerHTML = I.compass; $('tilt').innerHTML = I.tilt;
    $('zoomIn').addEventListener('click', () => app.map.zoomIn());
    $('zoomOut').addEventListener('click', () => app.map.zoomOut());
    $('north').addEventListener('click', () => app.map.easeTo({ bearing: 0, duration: 600 }));
    $('tilt').addEventListener('click', () => app.map.easeTo({ pitch: app.map.getPitch() > 20 ? 0 : 58, duration: 700 }));
    const needle = $('north').querySelector('.compass-needle');
    app.map.on('rotate', () => { needle.style.transform = `rotate(${-app.map.getBearing()}deg)`; });
    // Narrow-screen drawer
    $('drawerBtn').innerHTML = I.menu;
    $('drawerBtn').addEventListener('click', () => $('app').classList.toggle('drawer-open'));
    document.querySelector('.left').addEventListener('click', (e) => { if (e.target.closest('.row')) $('app').classList.remove('drawer-open'); });
    // Keyboard
    window.addEventListener('keydown', (e) => {
      if (e.target.matches('input, select, textarea')) return;
      if (e.key === 'Escape') { if (app.state.drawer) app.setDrawer(null); else if (app.state.selected != null) app.select(null); }
      if (e.key === ' ' && !e.target.closest('button')) { e.preventDefault(); app.togglePlay(); }
    });
    window.addEventListener('resize', () => { applyPadding(); app.timeline.invalidate(); renderAll(true); });
    renderCrumbs();
  }

  root.TWIN.app = app;
  window.addEventListener('DOMContentLoaded', () => init().catch((err) => {
    console.error(err);
    $('loadingStep').textContent = 'Could not start the twin: ' + (err && err.message ? err.message : err);
  }));
})(typeof window !== 'undefined' ? window : globalThis);
