/* Map bootstrap: renderer selection, offline tiles, camera, and the layer stack.

   Renderers (same API surface, see README):
     • Mapbox GL JS v3, when TWIN_CONFIG.mapboxToken is set: the Mapbox Standard style
       (real 3D buildings, facades, landmarks, shadows, atmosphere), its light preset
       following the simulation clock and its palette pulled toward the dark CIM look.
     • MapLibre GL JS (the open-source continuation of Mapbox GL JS) otherwise, on the
       OpenStreetMap vector tiles baked into data/tiles, served through a twin://
       protocol so the twin works offline and inside sandboxed frames. If the local
       files cannot be fetched (e.g. opened from file://) it falls back to live
       OpenFreeMap tiles. */
(function (root) {
  const OVERVIEW = { center: [-78.6440, 35.7990], zoom: 13.05, pitch: 58, bearing: -20 };
  const MAPBOX_VER = '3.31.0';
  // Mapbox Standard configuration: realistic geometry and lighting, desaturated
  // command-center palette, no consumer POI clutter.
  const STANDARD = {
    theme: 'monochrome', font: 'Barlow',
    show3dObjects: true, show3dBuildings: true, show3dFacades: true, show3dLandmarks: true, show3dTrees: true,
    showPointOfInterestLabels: false, showTransitLabels: false, showPedestrianRoads: false,
    showLandmarkIcons: false, showLandmarkIconLabels: false, showAdminBoundaries: false,
    showPlaceLabels: true, showRoadLabels: true,
    colorBuildings: '#3b4149', colorLand: '#101215', colorGreenspace: '#121a16', colorWater: '#0c1925',
    colorRoads: '#2b3037', colorTrunks: '#323841', colorMotorways: '#3a414b',
    colorCommercial: '#15181c', colorIndustrial: '#151719', colorMedical: '#17191d', colorEducation: '#16181b',
    colorPlaceLabels: '#9aa4b0', colorRoadLabels: '#6e7783',
  };

  function baseURL(cfg) {
    if (cfg.dataBase) return cfg.dataBase.replace(/\/?$/, '/');
    return new URL('.', location.href).href;
  }
  const slug = (s) => decodeURIComponent(s).toLowerCase().replace(/\s+/g, '-');

  function z10Tile(c) {
    const n = 1024, x = Math.floor(((c[0] + 180) / 360) * n);
    const y = Math.floor(((1 - Math.asinh(Math.tan((c[1] * Math.PI) / 180)) / Math.PI) / 2) * n);
    return `10/${x}/${y}`;
  }

  async function localTilesAvailable(base, geo, cfg) {
    if (location.protocol === 'file:') return false;
    try {
      if (cfg.tileBundles) return (await fetch(base + cfg.tileBundles)).ok;
      const r = await fetch(base + 'data/tiles/' + z10Tile(geo.center) + '.pbf', { cache: 'force-cache' });
      return r.ok && (await r.arrayBuffer()).byteLength > 0;
    } catch (e) { return false; }
  }

  // Bundled mode (single-page builds): tiles and glyphs are packed as base64 in a few
  // JSON files listed by an index, for hosts that only serve text and web media types.
  function bundleReader(base, indexPath) {
    let index = null;
    const bundles = {};
    const decode = (s) => { const bin = atob(s), out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out.buffer; };
    return async function read(kind, key) {
      index = index || fetch(base + indexPath).then((r) => r.json());
      const idx = await index;
      const name = idx[kind][key];
      if (!name) return new ArrayBuffer(0);
      bundles[name] = bundles[name] || fetch(base + idx.bundles[name]).then((r) => r.json());
      const s = (await bundles[name])[key];
      return s ? decode(s) : new ArrayBuffer(0); // a fresh buffer each time: MapLibre transfers it
    };
  }

  // Every building-zoom tile MapLibre loads is also handed (as a copy: MapLibre transfers
  // the original to its worker) to listeners such as the city-buildings renderer.
  const tileStore = new Map(), tileListeners = [];
  function tapTile(key, buf) {
    if (buf.byteLength && +key.split('/')[0] >= 13 && !tileStore.has(key)) {
      const copy = buf.slice(0);
      tileStore.set(key, copy);
      for (const cb of tileListeners) cb(key, copy);
    }
    return buf;
  }
  function onTile(cb) { for (const [k, b] of tileStore) cb(k, b); tileListeners.push(cb); }

  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  }
  function loadCss(href) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l); }

  async function createMapbox(container, geo, cfg) {
    if (!root.mapboxgl) {
      loadCss(`https://api.mapbox.com/mapbox-gl-js/v${MAPBOX_VER}/mapbox-gl.css`);
      await loadScript(`https://api.mapbox.com/mapbox-gl-js/v${MAPBOX_VER}/mapbox-gl.js`);
    }
    const gl = root.mapboxgl;
    gl.accessToken = cfg.mapboxToken;
    const lightPreset = root.TWIN.core.dayPhase(root.TWIN.core.sunPosition(cfg.startDate || new Date(), geo.center[1], geo.center[0]));
    const map = new gl.Map({
      container, style: 'mapbox://styles/mapbox/standard', config: { basemap: { ...STANDARD, lightPreset } },
      ...OVERVIEW, antialias: true, attributionControl: false, minZoom: 10.6, maxZoom: 18.5, maxPitch: 75, projection: 'mercator',
    });
    try {
      await new Promise((res, rej) => {
        const to = setTimeout(() => rej(new Error('Mapbox style timeout')), 15000);
        map.once('style.load', () => { clearTimeout(to); res(); });
        map.on('error', (e) => { if (e && e.error && /401|403|token/i.test(String(e.error.message || e.error.status))) { clearTimeout(to); rej(e.error); } });
      });
    } catch (e) {
      map.remove(); // release its WebGL context and render loop before MapLibre takes over
      throw e;
    }
    // Re-assert the configuration property by property: older style revisions ignore
    // unknown keys in the constructor, and each call is harmless if a key is absent.
    for (const [k, v] of Object.entries({ ...STANDARD, lightPreset })) {
      try { map.setConfigProperty('basemap', k, v); } catch (e) { /* property not in this Standard revision */ }
    }
    // Standard supplies its own 3D buildings, so no fill-extrusion layer is added here.
    // Custom layers go into its slots: 'middle' sits above roads and behind 3D buildings.
    return { gl, map, mode: 'mapbox', slot: true, lightPreset, renderer: `Mapbox GL JS ${gl.version} · Standard`, labelFont: ['DIN Pro Bold', 'Arial Unicode MS Bold'] };
  }

  async function createMapLibre(container, geo, cfg) {
    const gl = root.maplibregl;
    const base = baseURL(cfg);
    const want = cfg.tiles || 'auto';
    const local = want === 'local' || (want === 'auto' && (await localTilesAvailable(base, geo, cfg)));
    let tiles, glyphs;
    if (local) {
      if (!root.__twinProtocol) {
        const fromBundle = cfg.tileBundles ? bundleReader(base, cfg.tileBundles) : null;
        gl.addProtocol('twin', async (params, abort) => {
          const u = params.url.slice('twin://'.length);
          if (fromBundle) {
            if (u.startsWith('tiles/')) return { data: tapTile(u.slice(6), await fromBundle('tiles', u.slice(6))) };
            const [, stack, range] = u.split('/');
            return { data: await fromBundle('fonts', slug(stack.split(',')[0]) + '/' + range) };
          }
          let path;
          if (u.startsWith('tiles/')) path = base + 'data/' + u + '.pbf';
          else { const [, stack, range] = u.split('/'); path = base + 'data/fonts/' + slug(stack.split(',')[0]) + '/' + range + '.pbf'; }
          try {
            const r = await fetch(path, { signal: abort && abort.signal });
            if (!r.ok) return { data: new ArrayBuffer(0) };
            const buf = await r.arrayBuffer();
            return { data: u.startsWith('tiles/') ? tapTile(u.slice(6), buf) : buf };
          } catch (e) {
            if (e.name === 'AbortError') throw e;
            return { data: new ArrayBuffer(0) };
          }
        });
        root.__twinProtocol = true;
      }
      tiles = 'twin://tiles/{z}/{x}/{y}';
      glyphs = 'twin://fonts/{fontstack}/{range}';
    } else {
      tiles = 'https://tiles.openfreemap.org/planet/20261018_080001_pt/{z}/{x}/{y}.pbf';
      glyphs = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
    }
    const [W, S, E, N] = geo.extent;
    const style = root.TWIN.style.build({ tiles, glyphs, extent: geo.extent, attribution: geo.attribution, sites: geo.sites });
    const map = new gl.Map({
      container, style, ...OVERVIEW, antialias: true, attributionControl: false, minZoom: 10.6, maxZoom: 18.5, maxPitch: 75,
      maxBounds: [[W - 0.07, S - 0.06], [E + 0.07, N + 0.06]], fadeDuration: 120, dragRotate: true, pitchWithRotate: true,
    });
    await new Promise((res) => map.once('load', res));
    root.TWIN.style.attach(map);
    return { gl, map, mode: 'maplibre', slot: false, onTile: local ? onTile : null, renderer: `MapLibre GL JS ${gl.getVersion ? gl.getVersion() : ''} · ${local ? 'offline OSM tiles' : 'OpenFreeMap'}`, labelFont: ['Noto Sans Bold'] };
  }

  async function create(container, geo, cfg = {}) {
    let M = null;
    if (cfg.mapboxToken) {
      try { M = await createMapbox(container, geo, cfg); }
      catch (e) { console.warn('Mapbox GL JS unavailable, falling back to MapLibre:', e); container.innerHTML = ''; M = null; }
    }
    if (!M) M = await createMapLibre(container, geo, cfg);
    const { gl, map } = M;
    map.addControl(new gl.AttributionControl({ compact: true, customAttribution: geo.attribution }), 'bottom-right');

    let padding = { top: 48, bottom: 110, left: 330, right: 10 };
    function setPadding(p) { padding = { ...padding, ...p }; map.easeTo({ padding, duration: 350 }); }

    function flyToFacility(f, opts = {}) {
      // Close enough for the facility's hero model to read (see heroes.js).
      const zoom = (f.subtype === 'EMS station' ? 17.5 : f.subtype === 'Pumping station' ? 17.9 : { hospital: 16.5, power: 17.3, traffic: 17.7, drainage: 15.9, weather: 18.1 }[f.type]) || 17;
      map.flyTo({ center: f.lngLat, zoom: opts.zoom || zoom, pitch: 62, bearing: map.getBearing() + (opts.turn || 0), duration: opts.duration || 1200, curve: 1.42, padding, essential: true });
    }
    function overview(opts = {}) {
      map.flyTo({ ...OVERVIEW, padding, duration: opts.duration || 1400, curve: 1.3, essential: true });
    }

    let orbitOn = false, last = 0;
    function orbitFrame(t) {
      if (!orbitOn) return;
      const dt = last ? t - last : 16; last = t;
      map.setBearing(map.getBearing() + dt * 0.0055);
      requestAnimationFrame(orbitFrame);
    }
    function orbit(on) { orbitOn = on; last = 0; if (on) requestAnimationFrame(orbitFrame); }
    const interactListeners = [];
    for (const ev of ['dragstart', 'wheel', 'touchstart', 'pitchstart']) map.on(ev, (e) => { if (e.originalEvent) interactListeners.forEach((cb) => cb()); });

    // Daylight follows the simulation clock: Mapbox switches its Standard light preset,
    // MapLibre gets a computed sun for its light, sky and ground shadows; the hero-model
    // layer subscribes for its own lighting.
    const daylightListeners = [];
    let daylight = null, preset = M.lightPreset || null;
    function setSimTime(date) {
      const sun = root.TWIN.core.sunPosition(date, geo.center[1], geo.center[0]);
      const phase = root.TWIN.core.dayPhase(sun);
      if (daylight && Math.abs(daylight.sun.elevation - sun.elevation) < 0.05 && Math.abs(daylight.sun.azimuth - sun.azimuth) < 0.05) return;
      daylight = { sun, phase, date };
      if (M.mode === 'mapbox') {
        if (phase !== preset) { preset = phase; try { map.setConfigProperty('basemap', 'lightPreset', phase); } catch (e) { /* older style */ } }
      } else root.TWIN.style.applyDaylight(map, sun, phase);
      for (const cb of daylightListeners) cb(daylight);
    }

    return {
      ...M, OVERVIEW, base: baseURL(cfg), setPadding, flyToFacility, overview, orbit, setSimTime,
      onUserInteract: (cb) => interactListeners.push(cb),
      onDaylight: (cb) => { daylightListeners.push(cb); if (daylight) cb(daylight); },
      get daylight() { return daylight; },
      get padding() { return padding; },
    };
  }

  root.TWIN.twinmap = { create, OVERVIEW };
})(typeof window !== 'undefined' ? window : globalThis);
