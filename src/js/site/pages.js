/* What the pages other than the twin share: reading the context into a city, scenario
   and issue time, the site header and its navigation, links that carry the context, a
   toast, and a light SVG map of the city with crisis footprints (no WebGL, so a page
   never builds a second 3D map). */
(function (root) {
  const T = root.TWIN;
  const C = T.core;
  const { stateOf, RISK_HEX, fmtT } = C;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  const DEFAULT_CITY = 'nagpur'; // what a link without a city opens on a fresh load
  const LIVE_NOW = 34.5;

  // ── Context ────────────────────────────────────────────────────────────
  // A link without a city or scenario keeps the ones the twin is running, as the twin
  // itself does; with no twin yet, the defaults.
  function resolve(ctx) {
    const a = T.app && T.app.engine ? T.app : null;
    const geo = T.services.cities().find((c) => c.id === (ctx.city || (a && a.geo.id))) || T.services.geo(DEFAULT_CITY);
    const s = ctx.s || (a && a.geo.id === geo.id ? a.state.scenario : null);
    const scen = s && T.services.runs(geo.id, s) ? T.scenarios[s] : T.services.scenariosFor(geo.id)[0];
    return { geo, scen, mode: ctx.m === 'replay' ? 'historical' : 'live' };
  }
  const liveNowOf = (scen) => scen.liveNow || LIVE_NOW;
  // The simulated now: the twin's clock when it runs the same city and scenario (it
  // advances while the twin is open), otherwise the scenario's opening moment.
  function nowOf(r) {
    if (r.mode === 'historical') return T.engine.HOURS;
    const a = T.app;
    if (a && a.engine && a.geo.id === r.geo.id && a.state.scenario === r.scen.id && a.state.mode === 'live' && !a.state.streaming) return a.state.nowT;
    return liveNowOf(r.scen);
  }
  // Engine and issue time for a page. Pages show what was known at the issue time, so a
  // time after the simulated now is read as now. Building an engine takes a few seconds.
  async function load(ctx, status) {
    const r = resolve(ctx);
    C.setTZ(r.geo.tz, r.geo.tzLabel);
    if (!T.services.cached(r.geo.id, r.scen.id)) {
      if (status) status(`Running the 200-member ensemble for ${r.scen.label} · ${r.geo.city}…`);
      await nextFrame(); await nextFrame();
    }
    const e = T.services.engine(r.geo.id, r.scen.id);
    const nowT = nowOf(r);
    const k = e.kOf(ctx.t != null ? Math.min(ctx.t, nowT) : nowT);
    return { ...r, e, an: e.analytics, nowT, k, t: k * e.DT, follow: ctx.t == null || ctx.t >= nowT };
  }
  // Write the resolved city and scenario back, so the address is a complete link.
  function settle(L) {
    const c = T.store.ctx;
    if (c.city !== L.geo.id || c.s !== L.scen.id) T.store.set({ city: L.geo.id, s: L.scen.id });
  }

  const clock = (e, t) => { const ck = C.clockAt(e.t0, t); return `${ck.day} · ${ck.time} ${C.tzLabel()}`; };
  const clockShort = (e, t) => { const ck = C.clockAt(e.t0, t); return `${ck.day.slice(0, 3)} ${ck.time}`; };

  // ── Links ──────────────────────────────────────────────────────────────
  // A link to a page with the current context, a patch applied (null drops a key).
  function href(path, patch = {}) {
    return T.store.serialize(path, { ...T.store.ctx, ...patch });
  }
  // Navigation links take the context at the moment they are used (pointerdown and focus
  // cover middle-click and copying the link; click covers everything else).
  for (const ev of ['pointerdown', 'focusin', 'click']) document.addEventListener(ev, fresh, true);
  function fresh(ev) {
    const a = ev.target.closest && ev.target.closest('a[data-nav]');
    if (a) a.href = href(a.dataset.nav, a.dataset.keep ? {} : { c: null });
  }

  const TABS = [['/', 'Overview'], ['/crises', 'Crises'], ['/twin', '3D twin']];
  function tabs(el, active) {
    el.innerHTML = TABS.map(([p, label]) => {
      const on = p === active || (p === '/crises' && active.startsWith('/crises'));
      return `<a data-nav="${p}" href="${esc(href(p, { c: null }))}"${on ? ' aria-current="page"' : ''}>${label}</a>`;
    }).join('');
  }

  // ── Site shell ─────────────────────────────────────────────────────────
  function show() {
    $('site').hidden = false;
    $('app').classList.add('view-off');
    $('page').scrollTop = 0;
  }
  // Header: brand, navigation, city and scenario, time mode and the issue time.
  function header(active, L) {
    const g = L ? L.geo : resolve(T.store.ctx).geo;
    const top = $('siteTop');
    top.innerHTML = `
      <a class="brand" data-nav="/" href="${esc(href('/', { c: null }))}" aria-label="Overview">
        <svg class="brand-mark" viewBox="0 0 26 26" aria-hidden="true"><path d="M13 1.5 23 7.25v11.5L13 24.5 3 18.75V7.25z" fill="none" stroke="#79a7e3" stroke-width="1.4"/><path d="M8 17V11.5l3-1.7V17M12.6 17V8.6l3-1.7V17M17.2 17v-5.2l2.2-1.2" fill="none" stroke="#e4e8ee" stroke-width="1.4" stroke-linejoin="round"/></svg>
        <span class="brand-text"><span class="brand-title">${esc(g.city)} Digital Twin</span><span class="brand-sub">Cascade Intelligence · ${esc(g.region)}</span></span>
      </a>
      <nav class="site-tabs" id="siteTabs" aria-label="Pages"></nav>
      <div class="site-ctx">
        <label class="select"><select id="pgCity" class="glass" aria-label="City"></select><span>${T.icons.UI.chevron}</span></label>
        <label class="select"><select id="pgScen" class="glass" aria-label="Scenario"></select><span>${T.icons.UI.chevron}</span></label>
        <div class="mode-toggle" role="group" aria-label="Time mode">
          <button id="pgLive" aria-pressed="${!L || L.mode === 'live'}" title="The scenario's current moment: forecasts use only data up to now."><span class="live-dot"></span>Now</button>
          <button id="pgHist" aria-pressed="${!!L && L.mode === 'historical'}" title="The whole 72 h, as replayed with the scenario's hidden ground truth.">Replay</button>
        </div>
        <span class="site-time num" id="pgTime">${L ? timeLabel(L) : ''}</span>
        <span class="sim-badge" tabindex="0" title="${L ? esc(provenance(L)) : 'Simulated data.'}"><span class="sim-long">Simulation</span><span class="sim-short">Sim</span></span>
      </div>`;
    tabs($('siteTabs'), active);
    const cs = $('pgCity');
    cs.innerHTML = T.services.cities().map((c) => `<option value="${c.id}">${esc(c.city)}</option>`).join('');
    cs.value = g.id;
    cs.addEventListener('change', () => { T.store.set({ city: cs.value, s: null, t: null, m: null, a: null, c: null }, { push: true, notify: true }); });
    const ss = $('pgScen');
    ss.innerHTML = T.services.scenariosFor(g.id).map((s) => `<option value="${s.id}">${esc(s.label)}${s.provenance ? ' · ' + esc(s.provenance.kind) : ''}</option>`).join('');
    ss.value = L ? L.scen.id : T.services.scenariosFor(g.id)[0].id;
    ss.addEventListener('change', () => { T.store.set({ s: ss.value, t: null, a: null, c: null }, { push: true, notify: true }); });
    $('pgLive').addEventListener('click', () => { T.store.set({ m: null, t: null }, { push: true, notify: true }); });
    $('pgHist').addEventListener('click', () => { T.store.set({ m: 'replay', t: null }, { push: true, notify: true }); });
  }
  function timeLabel(L) {
    const tag = L.mode === 'historical' ? 'Replay' : L.follow ? 'Sim now' : `Past −${(L.nowT - L.t).toFixed(1)}h`;
    return `<b>${fmtT(L.t)}</b><span class="site-clock"> · SCENARIO · ${clock(L.e, L.t)}</span><span class="site-tag">${tag}</span>`;
  }
  const provenance = (L) => {
    const pv = L.scen.provenance;
    return `${pv ? pv.label + ': ' + L.scen.label + '. ' + pv.note : 'Simulated data.'} Nothing here is a real-time feed.`;
  };

  // Page body while an engine is built, and on failure.
  function busy(msg) {
    $('page').innerHTML = `<div class="pg-busy"><div class="loading-bar"><i></i></div><p>${esc(msg)}</p></div>`;
  }
  function fail(err) {
    console.error(err);
    $('page').innerHTML = `<div class="pg-busy"><p>Could not build this page: ${esc(err && err.message ? err.message : err)}</p></div>`;
  }

  let toastTimer = 0;
  function toast(html) {
    const el = $('siteToast');
    el.innerHTML = html; el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 4200);
  }

  // ── SVG city map with crisis footprints ───────────────────────────────
  // Equirectangular in metres around the city centre; y grows downward.
  function projector(geo) {
    const [lng0, lat0] = geo.center;
    const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110540;
    return ([lng, lat]) => [(lng - lng0) * kx, -(lat - lat0) * ky];
  }
  const baseCache = new Map();
  function basemap(geo) {
    if (baseCache.has(geo.id)) return baseCache.get(geo.id);
    const P = projector(geo);
    const d = (pts) => 'M' + pts.map((p) => P(p).map((v) => Math.round(v)).join(' ')).join('L');
    const MAJOR = new Set(['motorway', 'trunk', 'primary']);
    const roads = geo.corridors.filter((s) => MAJOR.has(s.c)).map((s) => d(s.g)).join('');
    const minor = geo.corridors.filter((s) => !MAJOR.has(s.c)).map((s) => d(s.g)).join('');
    const rivers = geo.drainage.filter((s) => s.m).map((s) => d(s.g)).join('');
    const creeks = geo.drainage.filter((s) => !s.m).map((s) => d(s.g)).join('');
    const out = { P, svg: `<path class="mm-minor" d="${minor}"/><path class="mm-creek" d="${creeks}"/><path class="mm-river" d="${rivers}"/><path class="mm-road" d="${roads}"/>` };
    baseCache.set(geo.id, out);
    return out;
  }
  // opts: { L, R (risk per facility), crises (registry list), focus (crisis id),
  //         fit (crisis to frame), link (crisis id → href), label }
  function cityMap(opts) {
    const { L } = opts, geo = L.geo, F = geo.facilities;
    const { P, svg } = basemap(geo);
    const [x0, y1] = P([geo.extent[0], geo.extent[1]]), [x1, y0] = P([geo.extent[2], geo.extent[3]]);
    let box = [x0, y0, x1 - x0, y1 - y0];
    const rings = (opts.crises || []).map((c) => ({ c, ring: T.analytics.footprint(c.members.map((i) => F[i].lngLat)).map(P) }));
    if (opts.fit) {
      const r = rings.find((x) => x.c.id === opts.fit);
      if (r) {
        const xs = r.ring.map((p) => p[0]), ys = r.ring.map((p) => p[1]);
        let w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
        const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
        const aspect = box[2] / box[3];
        w = Math.max(w * 1.25, 5000); h = Math.max(h * 1.25, w / aspect); w = Math.max(w, h * aspect);
        box = [cx - w / 2, cy - h / 2, w, h];
      }
    }
    const scale = box[2] / 600; // text and dot sizes for a map about 600 px across; strokes are in screen px
    const fp = rings.map(({ c, ring }) => {
      const col = RISK_HEX[stateOf(c.maxR).key];
      const focus = opts.focus ? c.id === opts.focus : true;
      const pts = ring.map((p) => p.map((v) => Math.round(v)).join(',')).join(' ');
      const top = ring.reduce((a, p) => (p[1] < a[1] ? p : a), ring[0]);
      const shape = `<polygon points="${pts}" fill="${col}" fill-opacity="${focus ? 0.14 : 0.05}" stroke="${col}" stroke-opacity="${focus ? 0.95 : 0.45}" stroke-width="${focus ? 2.2 : 1.2}" stroke-dasharray="5 3.5" vector-effect="non-scaling-stroke"/>
        <text x="${Math.round(top[0])}" y="${Math.round(top[1] - 8 * scale)}" fill="${col}" font-size="${11 * scale}" stroke="#0b0e12" stroke-width="${2.5 * scale}" paint-order="stroke" text-anchor="middle" class="mm-label">${esc(c.id)}</text>`;
      return opts.link ? `<a href="${esc(opts.link(c.id))}" aria-label="${esc(c.id + ' · ' + c.type)}">${shape}</a>` : shape;
    }).join('');
    const R = opts.R;
    const dots = F.map((f, i) => {
      if (f.type === 'weather') return '';
      const [x, y] = P(f.lngLat);
      const col = R ? RISK_HEX[stateOf(R[i]).key] : '#6a737e';
      return `<circle cx="${Math.round(x)}" cy="${Math.round(y)}" r="${(f.tier === 1 ? 2.8 : 2) * scale}" fill="${col}" stroke="#090b0e" stroke-width="0.8" vector-effect="non-scaling-stroke"><title>${esc(f.name)}</title></circle>`;
    }).join('');
    return `<svg class="citymap" viewBox="${box.map((v) => Math.round(v)).join(' ')}" role="img" aria-label="${esc(opts.label || `Map of ${geo.city} with crisis footprints`)}">
      ${svg}${fp}${dots}</svg>`;
  }

  T.site = {
    DEFAULT_CITY, LIVE_NOW, liveNowOf, resolve, nowOf, load, settle, clock, clockShort, href, tabs, show, header, timeLabel, provenance,
    busy, fail, toast, cityMap, esc, nextFrame,
  };
})(typeof window !== 'undefined' ? window : globalThis);
