/* Application orchestrator: state, view computation, render loop and controls. */
(function (root) {
  const T = root.TWIN;
  const C = T.core;
  const { stateOf, RISK_HEX, fmtT, clamp } = C;
  const I = T.icons.UI;
  const LIVE_NOW = 34.5;
  // Each scenario has its own "now" (a reconstruction opens before its peak).
  const liveNowOf = (id) => (T.scenarios[id] && T.scenarios[id].liveNow) || LIVE_NOW;
  const DEFAULT_CITY = T.site.DEFAULT_CITY;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // Let the browser paint (a status line) before heavy work. Hidden tabs and embedded
  // panes get no animation frames, so a timer stands in after 60 ms.
  const nextFrame = () => new Promise((r) => { let done = false; const go = () => { if (!done) { done = true; setTimeout(r, 0); } }; requestAnimationFrame(go); setTimeout(go, 60); });

  const app = {
    geo: null, // the city's data (TWIN_GEOS[city]), chosen at boot
    engine: null,
    state: {
      scenario: null, mode: 'live', nowT: LIVE_NOW, t: LIVE_NOW, playing: false, speed: 2, streaming: false,
      selected: null, drawer: null, orbit: false, crisis: null, leftOpen: false, legendOpen: false,
      viewMode: 'twin', // 'situation' (#/, the briefing) or 'twin' (#/twin, free investigation)
      layers: { drainage: true, traffic: true, power: true, telecom: true, hospital: true, weather: true, flows: true, arcs: false, buildings: true, labels: true, population: false, crises: false },
    },
    view: null,
  };

  const simDate = (t) => new Date(new Date(app.engine.t0).getTime() + t * 3600e3);

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
  // ctx: the shared context from the URL (see site/store.js), applied once the twin is up.
  async function init(ctx = {}) {
    const step = (s) => { $('loadingStep').textContent = s; return nextFrame(); };
    // A city switch reloads the page (map bounds, tiles and meshes are per city).
    const g = (app.geo = T.services.cities().find((c) => c.id === ctx.city) || T.services.geo(DEFAULT_CITY));
    C.setTZ(g.tz, g.tzLabel);
    $('loadingTitle').textContent = `${g.city} Digital Twin`;
    $('brandTitle').textContent = g.city;
    $('brandSub').textContent = g.region;
    $('map').setAttribute('aria-label', `3D map of ${g.city}`);
    T.nav.render(app.state.viewMode === 'situation' ? '/' : '/twin', null);
    $('navBtn').innerHTML = I.menu;
    $('navBtn').addEventListener('click', () => T.nav.toggle());
    const s0 = app.state;
    s0.scenario = ctx.s && T.services.runs(g.id, ctx.s) ? ctx.s : T.services.scenariosFor(g.id)[0].id;
    s0.nowT = s0.t = liveNowOf(s0.scenario);
    await step('Assimilating 72 h of simulated sensor streams · 200-member ensemble…');
    app.engine = T.services.engine(g.id, s0.scenario);
    app.view = computeView();

    await step(`Loading ${g.city} city model · OpenStreetMap buildings, streets and rivers…`);
    const tm = await T.twinmap.create($('map'), app.geo, { ...(root.TWIN_CONFIG || {}), startDate: simDate(app.state.t) });
    app.tm = tm;
    app.map = tm.map;
    app.layers = T.layers.install(tm.map, app.geo, { labelFont: tm.labelFont, slot: tm.slot });
    app.radar = T.radar.install(tm.map, app.geo, 'arcs-confirmed', tm.slot);
    app.markers = T.markers.install(tm.gl, tm.map, app.geo, (i) => app.select(i, { fly: true }));
    // City buildings with facades, roofs and sun shadows (MapLibre; null keeps the style's extrusions).
    const cfg = root.TWIN_CONFIG || {};
    app.buildings = T.buildings.install(tm, app.geo, { enabled: cfg.cityBuildings, shadows: cfg.buildingShadows, shadowSize: cfg.shadowSize });
    // Detailed 3D model of the selected facility; it stays in place after deselection.
    const hideSite = (i) => { T.style.hideSite(tm.map, i); if (app.buildings) app.buildings.hideSite(i); };
    app.heroes = T.heroes.install(tm, app.geo, {
      base: tm.base, modelBundles: (root.TWIN_CONFIG || {}).modelBundles,
      onShow: (i) => hideSite(i), onHide: () => hideSite(null),
    });
    precomputePaths();

    await step('Starting command center…');
    app.sidebar = T.sidebar.create(app);
    app.inspector = T.inspector.create(app);
    app.outlook = T.outlook.create(app);
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
    await app.applyContext(ctx, ['m', 't', 'a', 'c']); // the scenario was applied before the engine was built
    app.setView(app.state.viewMode, { first: true });
    urlReady = true;
    writeUrl(false);
  }

  // ── Shared context (URL) ───────────────────────────────────────────────
  // The twin's scenario, mode, time and selection mirror the shared context: deep links
  // restore them, back/forward replays them, and the twin writes them back as they change.
  let urlReady = false, applying = false, urlTimer = 0;
  function contextOf() {
    const s = app.state;
    const follow = s.mode === 'live' ? s.streaming || Math.abs(s.t - s.nowT) < 0.01 : Math.abs(s.t - app.engine.HOURS) < 0.01;
    return { city: app.geo.id, s: s.scenario, m: s.mode === 'historical' ? 'replay' : null, t: follow ? null : s.t, a: s.selected != null ? app.geo.facilities[s.selected].id : null, c: s.crisis };
  }
  // Coming back to the twin from another page: apply what that page changed.
  app.syncContext = function (ctx) {
    const cur = contextOf();
    const changed = ['city', 's', 't', 'm', 'a', 'c'].filter((k) => (ctx[k] || null) !== (cur[k] || null) && !(k === 's' && ctx.s == null));
    if (changed.length) return app.applyContext(ctx, changed);
    writeUrl(false);
  };
  // push: a new history entry (selection, mode, scenario); otherwise the entry is replaced.
  function writeUrl(push) {
    if (!urlReady || applying || !T.store) return;
    clearTimeout(urlTimer); urlTimer = 0;
    T.store.set(contextOf(), { push });
  }
  function scheduleUrl() { if (urlReady && !urlTimer) urlTimer = setTimeout(() => { urlTimer = 0; writeUrl(false); }, 400); }

  app.applyContext = async function (ctx, changed) {
    const s = app.state;
    if (changed.includes('city') && ctx.city && ctx.city !== app.geo.id && T.services.cities().some((c) => c.id === ctx.city)) {
      location.reload(); // the address bar already holds the new city
      return;
    }
    applying = true;
    try {
      // A new scenario resets the clock, so mode and time are applied again after it.
      const rebuilt = changed.includes('s') && ctx.s && T.services.runs(app.geo.id, ctx.s) && ctx.s !== s.scenario;
      if (rebuilt) {
        $('scenario').value = ctx.s;
        await setScenario(ctx.s);
      }
      if (rebuilt || changed.includes('m')) {
        const mode = ctx.m === 'replay' ? 'historical' : 'live';
        if (mode !== s.mode) setMode(mode, true);
      }
      if (rebuilt || changed.includes('t') || changed.includes('m')) {
        if (ctx.t == null) { s.t = s.mode === 'live' ? s.nowT : app.engine.HOURS; renderAll(true); }
        else { app.scrub(ctx.t); app.scrubEnd(); }
      }
      if (changed.includes('c') && (ctx.c || null) !== s.crisis) app.focusCrisis(ctx.c || null, { fit: ctx.a == null });
      if (changed.includes('a')) {
        const i = ctx.a ? app.geo.facilities.findIndex((f) => f.id === ctx.a) : -1;
        const want = i >= 0 ? i : null;
        if (want !== s.selected) app.select(want, { fly: want != null });
      }
    } finally { applying = false; }
    writeUrl(false); // drops what could not be applied (unknown scenario or facility)
  };

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
    scheduleUrl();
    const key = `${v.k}|${v.kInfo}|${v.mode}|${app.state.scenario}|${app.state.selected}|${app.state.layers.arcs}`;
    renderLight(v);
    if (!force && key === lastKey) return;
    lastKey = key;
    const e = app.engine;
    // Map
    app.markers.update(v.R, v.trust);
    app.heroes.update(v.R);
    app.layers.update(v.R, { diurnal: e.diurnal(v.t), flows: flows(v), arcs: app.state.layers.arcs ? arcs(v) : null });
    if (app.state.layers.weather) drawRadar(v);
    // Panels
    T.nav.render(app.state.viewMode === 'situation' ? '/' : '/twin', { e, an: e.analytics, k: v.kInfo, scen: e.scen });
    app.sidebar.updateList(v.R, v.trust, app.state.selected);
    const kAlert = v.forecastView ? v.kNow : v.k;
    app.sidebar.updateAlerts(e.alerts.filter((a) => a.k <= kAlert), Math.min(v.t, v.tNow));
    app.inspector.update(true);
    renderTop(v);
    app.outlook.render(v, force);
    renderStrip(v);
    renderLegend();
    drawCrises(v);
    app.graph.render();
    app.plan.render();
    app.valid.render();
    if (app.state.playing) detectStageEvents(v);
  }

  let lastSunT = -1;
  function renderLight(v) {
    app.timeline.update(v);
    // Sun, sky and shadows follow the scrubbed time (every ~3 simulated minutes).
    if (Math.abs(v.t - lastSunT) >= 0.05) { lastSunT = v.t; app.tm.setSimTime(simDate(v.t)); }
    const ck = C.clockAt(app.engine.t0, v.t);
    $('clockT').textContent = fmtT(v.t);
    $('clockD').innerHTML = `<span class="clock-scn">SCENARIO · </span>${ck.day} · ${ck.time} ${C.tzLabel()}`;
    const tag = $('clockTag');
    if (v.mode === 'historical') { tag.textContent = 'REPLAY'; tag.className = 'clock-tag'; }
    else if (v.forecastView) { tag.textContent = `FORECAST +${(v.t - v.tNow).toFixed(1)}h`; tag.className = 'clock-tag forecast'; }
    else if (v.t < v.tNow - 0.01) { tag.textContent = `PAST −${(v.tNow - v.t).toFixed(1)}h`; tag.className = 'clock-tag'; }
    else { tag.textContent = app.state.streaming ? 'REPLAY STREAM' : 'SIM NOW'; tag.className = 'clock-tag'; }
    tag.title = v.mode === 'live' && Math.abs(v.t - v.tNow) > 0.01 ? 'Return to the simulated now' : '';
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
    sys.querySelector('.sys-text').textContent = `${e.N} simulated feeds assimilated · ESS ${Math.round(ess)}/${e.M} · ${faults ? faults + ' sensor' + (faults > 1 ? 's' : '') + ' degraded' : 'all sensors healthy'}`;
    sys.title = `Renderer: ${app.tm.renderer}. Effective sample size of the particle filter averaged over facilities.`;
    const pv = e.scen.provenance;
    $('simBadge').title = `${pv ? pv.label + ': ' + e.scen.label + '. ' + pv.note : 'Simulated data.'} Nothing here is a real-time feed.`;
  }

  // Cascade strip: one stage per system, lit when it reaches HIGH, with the time it did
  // (observed) or is expected to (forecast).
  const STAGES = [['weather', 'Hazard'], ['drainage', 'Drainage'], ['traffic', 'Traffic'], ['power', 'Power'], ['telecom', 'Telecom'], ['ems', 'EMS'], ['hospital', 'Hospital']];
  let seqCache = { k: -1, s: '', seq: [] };
  function renderStrip(v) {
    if (app.state.viewMode === 'situation') { forecastStrip(v); return; }
    fsKey = '';
    const e = app.engine;
    if (seqCache.k !== v.kInfo || seqCache.s !== app.state.scenario) seqCache = { k: v.kInfo, s: app.state.scenario, seq: e.cascade(v.kInfo) };
    const first = {};
    for (const c of seqCache.seq) {
      const gk = e.kinds[c.i] === 'pump' ? 'drainage' : e.kinds[c.i];
      if (c.level === 'HIGH RISK' && !(gk in first)) first[gk] = c;
    }
    let nCritGroups = 0;
    const present = (g) => g === 'weather' || e.kinds.some((k) => (k === 'pump' ? 'drainage' : k) === g);
    const html = STAGES.filter(([g]) => present(g)).map(([g, label], n) => {
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
    if (L.crises || app.state.crisis) items.push('<span><i class="ln" style="border-top-style:dashed;border-color:#ee8a2a"></i>Crisis footprint</span>');
    if (L.flows) items.push('<span><i class="ar water"></i>Water flow</span><span><i class="ar trf"></i>Traffic diversion</span><span><i class="ar cas"></i>Cascade spread</span>');
    const open = app.state.legendOpen;
    $('legend').classList.toggle('open', open);
    const toggle = `<button class="legend-toggle" id="legendToggle" type="button" aria-expanded="${open}">${open ? 'Hide legend' : 'Legend'} ${I.chevron}</button>`;
    if (!open) { $('legend').innerHTML = toggle; return; }
    $('legend').innerHTML = `${toggle}<div class="legend-scale"><i style="background:${RISK_HEX.normal}"></i><i style="background:${RISK_HEX.watch}"></i><i style="background:${RISK_HEX.high}"></i><i style="background:${RISK_HEX.critical}"></i></div>
      <div class="legend-labels"><span>NORMAL</span><span>WATCH</span><span>HIGH</span><span>CRITICAL</span></div>
      <div class="legend-items">${items.join('')}</div>`;
  }

  function renderCrumbs() {
    const i = app.state.selected, F = app.geo.facilities, c = app.state.crisis;
    const home = `<button class="home" id="homeBtn">${I.home} City overview</button>`;
    const panel = `<button class="panel-toggle" id="leftToggle" type="button" aria-expanded="${app.state.leftOpen}" aria-controls="leftPanel">${I.menu} ${app.state.leftOpen ? 'Hide assets' : 'Assets & layers'}</button><span class="sep-bar" aria-hidden="true"></span>`;
    const crisis = c ? `<span class="crumb-crisis"><a class="num" data-nav="/crises/${esc(c)}" data-keep="1" href="${esc(T.site.href('/crises/' + c, { c: null }))}" title="Crisis details">${esc(c)}</a><button id="crisisOff" aria-label="Hide crisis ${esc(c)}">${I.close}</button></span>` : '';
    $('crumbs').innerHTML = panel + (i == null
      ? `<span>${esc(app.geo.city)}</span><span class="sep">›</span><span class="cur">All districts</span>`
      : `<button class="crumb" id="crumbCity">${esc(app.geo.city)}</button><span class="sep">›</span><span>${esc(F[i].district)}</span><span class="sep">›</span><span class="cur">${esc(F[i].name)}</span>${home}`) + crisis;
    const hb = $('homeBtn'); if (hb) hb.addEventListener('click', () => { app.select(null); app.tm.overview(); });
    const cc = $('crumbCity'); if (cc) cc.addEventListener('click', () => { app.select(null); app.tm.overview(); });
    const co = $('crisisOff'); if (co) co.addEventListener('click', () => app.focusCrisis(null));
    $('leftToggle').addEventListener('click', () => app.setLeft(!app.state.leftOpen));
  }

  // Crisis footprints (the analytics registry at the issue time) while a crisis is in
  // view or the layer is on; the focused one is drawn stronger.
  let crisisKey = '';
  function drawCrises(v) {
    const s = app.state, on = s.layers.crises || s.crisis != null;
    const key = on ? `${v.kInfo}|${s.crisis}|${s.scenario}` : '';
    if (key === crisisKey) return;
    crisisKey = key;
    if (!on) { app.layers.setCrises([]); return; }
    const F = app.geo.facilities;
    app.layers.setCrises(app.engine.analytics.crises(v.kInfo).list.map((c) => {
      const pts = c.members.map((i) => F[i].lngLat);
      const anchor = [pts.reduce((a, p) => a + p[0], 0) / pts.length, Math.max(...pts.map((p) => p[1])) + 0.006];
      return { ring: T.analytics.footprint(pts), id: c.id, type: c.type, col: RISK_HEX[stateOf(c.maxR).key], focus: c.id === s.crisis, anchor };
    }));
  }
  // Show a crisis from the registry: footprints on, the camera framed on its members.
  app.focusCrisis = function (id, opts = {}) {
    const s = app.state;
    s.crisis = id || null;
    if (id && !s.layers.crises) { s.layers.crises = true; const box = $('ly-crises'); if (box) box.checked = true; }
    crisisKey = '';
    renderCrumbs();
    renderAll(true);
    if (id && opts.fit !== false) {
      const c = app.engine.analytics.crises(app.view.kInfo).list.find((x) => x.id === id);
      if (!c) toast(`<b>Crisis</b><span>${esc(id)} is not in the registry at ${fmtT(app.view.tInfo)}.</span>`);
      else {
        const pts = c.members.map((i) => app.geo.facilities[i].lngLat), pad = 0.012;
        const lng = pts.map((p) => p[0]), lat = pts.map((p) => p[1]);
        app.tm.orbit(false); s.orbit = false; $('orbit').setAttribute('aria-pressed', 'false');
        app.map.fitBounds([[Math.min(...lng) - pad, Math.min(...lat) - pad], [Math.max(...lng) + pad, Math.max(...lat) + pad]], { padding: app.tm.padding, pitch: 52, duration: 1600, maxZoom: 15.2 });
      }
    }
    writeUrl(true);
  };

  // Toasts and camera follow during playback: first critical facility per system.
  let announced = new Set(), lastFly = 0, toastTimer = 0;
  function detectStageEvents(v) {
    const e = app.engine;
    for (let i = 0; i < e.N; i++) {
      const g = e.kinds[i] === 'pump' ? 'drainage' : e.kinds[i];
      if (g === 'weather' || announced.has(g) || v.R[i] < 0.75) continue;
      announced.add(g);
      const names = { drainage: 'Drainage over capacity', traffic: 'Road network gridlock', power: 'Substation outage risk', telecom: 'Mobile network failing', ems: 'EMS response failing', hospital: 'Hospital capacity critical' };
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
    // Another page is in front: the clock and the map hold still.
    if (app.paused) { requestAnimationFrame(loop); return; }
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
    // Situation: reading a forecast trajectory should not be reading a moving target.
    if (i != null && s.viewMode === 'situation' && s.playing) { s.playing = false; s.streaming = false; }
    s.selected = i;
    app.markers.select(i);
    app.layers.select(i);
    document.getElementById('app').classList.toggle('inspecting', i != null);
    if (i != null) {
      app.heroes.focus(i);
      app.inspector.open(i);
      app.sidebar.scrollTo(i);
      if (opts.fly) { app.tm.orbit(false); s.orbit = false; $('orbit').setAttribute('aria-pressed', 'false'); }
    } else app.inspector.close();
    applyPadding();
    if (i != null && opts.fly) setTimeout(() => app.tm.flyToFacility(app.geo.facilities[i]), 30);
    renderCrumbs();
    renderAll(true);
    writeUrl(true);
  };
  app.focusAlert = function (i) {
    app.select(i, { fly: true });
    setTimeout(() => app.layers.highlight(i), 700);
  };
  app.setLayer = function (key, on) { app.state.layers[key] = on; applyLayer(key, on); renderAll(true); };
  function applyLayer(key, on) {
    if (key === 'weather') { app.radar.setVisible(on); app.markers.setTypeVisible('weather', on); return; }
    app.layers.setGroup(key, on);
    if (['drainage', 'traffic', 'power', 'telecom', 'hospital'].includes(key)) app.markers.setTypeVisible(key, on);
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
    toast('<b>Replay</b><span>Replaying the simulated sensor streams from T+0. Forecasts and links update as evidence arrives.</span>');
    app.timeline.invalidate();
    renderAll(true);
  };
  app.reset = function () {
    const s = app.state;
    s.playing = false; s.streaming = false;
    s.mode = 'live'; s.nowT = liveNowOf(s.scenario); s.t = s.nowT;
    $('modeLive').setAttribute('aria-pressed', 'true'); $('modeHist').setAttribute('aria-pressed', 'false');
    app.select(null);
    app.setDrawer(null);
    app.tm.orbit(false); s.orbit = false; $('orbit').setAttribute('aria-pressed', 'false');
    app.tm.overview();
    app.timeline.invalidate();
    renderAll(true);
    writeUrl(true);
  };
  function setMode(mode, quiet) {
    const s = app.state;
    s.mode = mode; s.playing = false; s.streaming = false;
    $('modeLive').setAttribute('aria-pressed', String(mode === 'live'));
    $('modeHist').setAttribute('aria-pressed', String(mode === 'historical'));
    if (mode === 'live') { s.nowT = liveNowOf(s.scenario); s.t = s.nowT; }
    else { s.nowT = app.engine.HOURS; if (!quiet) app.setDrawer('valid'); }
    app.timeline.invalidate();
    renderAll(true);
    writeUrl(true);
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
    ld.innerHTML = `<div class="loading-title">${esc(T.scenarios[id].label)}</div><div class="loading-bar"><i></i></div><div class="loading-step">Re-running the 200-member ensemble and replaying the simulated sensor streams…</div>`;
    if (!T.services.cached(app.geo.id, id)) { $('app').appendChild(ld); await nextFrame(); await nextFrame(); }
    app.engine = T.services.engine(app.geo.id, id);
    precomputePaths();
    app.graph.reset(); app.valid.reset(); app.timeline.invalidate();
    s.nowT = s.mode === 'live' ? liveNowOf(id) : app.engine.HOURS;
    s.t = s.nowT;
    renderAll(true);
    if (s.selected != null) app.inspector.open(s.selected);
    ld.classList.add('done'); setTimeout(() => ld.remove(), 600);
    const pv = T.scenarios[id].provenance;
    toast(`<b>${pv ? esc(pv.label) : 'Scenario'}</b><span>${esc(T.scenarios[id].blurb)}</span>`);
    writeUrl(true);
  }

  // ── Situation: the briefing view of the same twin ──────────────────────
  // The next threshold crossings, in predicted order: recent observed ones (solid) and
  // forecast ones with their probability (dashed). Each facility appears once, at its
  // most severe crossing. Nothing forecast: a muted strip that says so.
  let fsKey = '';
  function forecastStrip(v) {
    const e = app.engine, F = app.geo.facilities, tI = v.tInfo;
    const key = `${v.kInfo}|${app.state.scenario}|${app.state.selected}`;
    if (key === fsKey) return;
    fsKey = key;
    const seq = e.cascade(v.kInfo), keep = (s) => (s.observed ? s.t >= tI - 6 : s.prob >= 0.5 && s.t - tI <= 48);
    const items = [], seen = new Set();
    for (const s of seq) {
      if (seen.has(s.i) || !keep(s)) continue;
      seen.add(s.i);
      items.push(seq.find((q) => q.i === s.i && q.level === 'CRITICAL' && keep(q)) || s);
      if (items.length >= 7) break;
    }
    items.sort((a, b) => a.t - b.t);
    const strip = $('strip');
    strip.classList.toggle('fs-muted', !items.length);
    if (!items.length) { strip.innerHTML = '<span class="fs-empty">No cascade currently forecast</span>'; return; }
    const SYS = { drainage: 'Drainage', pump: 'Drainage', traffic: 'Roads', power: 'Power', telecom: 'Telecom', ems: 'EMS', hospital: 'Hospital' };
    strip.innerHTML = '<span class="fs-lead">Next crossings</span>' + items.map((s, n) => {
      const crit = s.level === 'CRITICAL', ck = C.clockAt(e.t0, s.t);
      return `${n ? '<span class="stage-arrow">→</span>' : ''}<button type="button" class="fs-item ${s.observed ? 'obs' : 'fc'} r-${crit ? 'critical' : 'high'}${app.state.selected === s.i ? ' on' : ''}" data-ev="${s.i}" data-t="${s.t}" title="${esc(F[s.i].name)} · ${crit ? 'CRITICAL' : 'HIGH RISK'} · ${s.observed ? 'observed' : 'forecast, p ' + Math.round(s.prob * 100) + '%'} · ${fmtT(s.t)}">
        <span class="fs-sys">${SYS[e.kinds[s.i]] || ''}</span><span class="fs-name">${esc(F[s.i].name)}</span><span class="fs-t">${s.observed ? 'obs ' : '~'}${ck.time}${s.observed ? '' : ' · ' + Math.round(s.prob * 100) + '%'}</span></button>`;
    }).join('');
  }
  // Frame the leading hazard: the top crisis and the next forecast crossings.
  function focusHazard() {
    const e = app.engine, v = app.view, F = app.geo.facilities;
    const top = e.analytics.crises(v.kInfo).list[0];
    let pts = top ? top.members.map((i) => F[i].lngLat) : [];
    pts = pts.concat(e.cascade(v.kInfo).filter((s) => !s.observed && s.prob >= 0.5).slice(0, 5).map((s) => F[s.i].lngLat));
    if (pts.length < 2) pts = F.map((f, i) => i).filter((i) => e.kinds[i] !== 'weather').sort((a, b) => v.R[b] - v.R[a]).slice(0, 4).map((i) => F[i].lngLat);
    const lng = pts.map((p) => p[0]), lat = pts.map((p) => p[1]), pad = 0.01;
    app.tm.orbit(false); app.state.orbit = false; $('orbit').setAttribute('aria-pressed', 'false');
    app.map.fitBounds([[Math.min(...lng) - pad, Math.min(...lat) - pad], [Math.max(...lng) + pad, Math.max(...lat) + pad]], { padding: app.tm.padding, pitch: 52, bearing: app.tm.OVERVIEW.bearing, duration: 1400, maxZoom: 14.2 });
  }
  let autoCrises = false;
  // Switch between the briefing (Situation) and free investigation (City twin): same map,
  // timeline and inspector; the left panel, strip, overlays and camera change.
  app.setView = function (view, opts = {}) {
    const s = app.state, was = s.viewMode;
    s.viewMode = view;
    $('app').classList.toggle('situation', view === 'situation');
    if (view === 'situation' && !s.layers.crises) { s.layers.crises = true; autoCrises = true; const b = $('ly-crises'); if (b) b.checked = true; }
    if (view !== 'situation' && autoCrises && s.crisis == null) { s.layers.crises = false; autoCrises = false; const b = $('ly-crises'); if (b) b.checked = false; }
    $('strip').classList.remove('fs-muted');
    fsKey = '';
    app.outlook.invalidate();
    renderCrumbs();
    applyPadding();
    renderAll(true);
    if (view === 'situation' && (was !== 'situation' || opts.first) && s.selected == null && s.crisis == null) focusHazard();
    setTimeout(() => window.dispatchEvent(new Event('resize')), 60);
  };
  // Select a forecast event: its facility, the clock at the event, the inspector.
  app.focusEvent = function (i, t) {
    if (t != null) { app.scrub(t); app.scrubEnd(); }
    app.select(i, { fly: true });
  };

  // Open or close the asset, layer and alert panel (wide screens; phones use the drawer).
  app.setLeft = function (on) {
    app.state.leftOpen = !!on;
    $('app').classList.toggle('left-closed', !on);
    renderCrumbs();
    // The timeline and the camera framing follow the panel once it has moved.
    setTimeout(() => window.dispatchEvent(new Event('resize')), 380);
  };

  function applyPadding() {
    const narrow = window.innerWidth <= 960;
    const css = (n) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(n));
    const left = narrow ? 0 : app.state.viewMode === 'situation' ? css('--outlook-w') + 10 : !app.state.leftOpen ? 10 : parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--left-w')) + 10;
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
    sel.innerHTML = T.services.scenariosFor(app.geo.id).map((s) => `<option value="${s.id}">${esc(s.label)}${s.provenance ? ' · ' + esc(s.provenance.kind) : ''}</option>`).join('');
    sel.value = app.state.scenario;
    sel.addEventListener('change', () => setScenario(sel.value));
    // City: scenario, time and selection belong to a city, so they reset with it.
    const csel = $('citySel');
    csel.innerHTML = T.services.cities().map((c) => `<option value="${c.id}">${esc(c.city)}</option>`).join('');
    csel.value = app.geo.id;
    csel.addEventListener('change', () => { T.store.set({ city: csel.value, s: null, t: null, m: null, a: null }, { push: true }); location.reload(); });
    $('scenIco').innerHTML = I.chevron;
    $('cityIco').innerHTML = I.chevron;
    // Map controls
    $('zoomIn').innerHTML = I.plus; $('zoomOut').innerHTML = I.minus; $('north').innerHTML = I.compass; $('tilt').innerHTML = I.tilt;
    $('zoomIn').addEventListener('click', () => app.map.zoomIn());
    $('zoomOut').addEventListener('click', () => app.map.zoomOut());
    $('north').addEventListener('click', () => app.map.easeTo({ bearing: 0, duration: 600 }));
    $('tilt').addEventListener('click', () => app.map.easeTo({ pitch: app.map.getPitch() > 20 ? 0 : 58, duration: 700 }));
    const needle = $('north').querySelector('.compass-needle');
    app.map.on('rotate', () => { needle.style.transform = `rotate(${-app.map.getBearing()}deg)`; });
    // Narrow-screen drawer
    $('strip').addEventListener('click', (ev) => { const b = ev.target.closest('[data-ev]'); if (b) app.focusEvent(+b.dataset.ev, +b.dataset.t); });
    $('legend').addEventListener('click', (ev) => { if (ev.target.closest('#legendToggle')) { app.state.legendOpen = !app.state.legendOpen; renderLegend(); } });
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

  app.toast = toast;
  app.pause = function (on) {
    app.paused = !!on;
    if (on) { app.state.playing = false; if (app.state.orbit) app.tm.orbit(false); }
    else if (app.state.orbit) app.tm.orbit(true);
  };
  // Started by the #/twin page (views/twin.js) with the shared context from the URL.
  app.boot = function (ctx, view = 'twin') {
    app.state.viewMode = view;
    $('app').classList.toggle('situation', view === 'situation');
    init(ctx).catch((err) => {
      console.error(err);
      $('loadingStep').textContent = 'Could not start the twin: ' + (err && err.message ? err.message : err);
    });
  };
  root.TWIN.app = app;
})(typeof window !== 'undefined' ? window : globalThis);
