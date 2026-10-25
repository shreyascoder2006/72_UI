/* Map bootstrap: renderer selection, offline tiles, camera, and the layer stack.

   Renderers (same API surface, see README):
     • Mapbox GL JS v3, when TWIN_CONFIG.mapboxToken is set: Mapbox dark-v11 restyled,
       3D buildings from Mapbox Streets.
     • MapLibre GL JS (the open-source continuation of Mapbox GL JS) otherwise, on the
       OpenStreetMap vector tiles baked into data/tiles, served through a twin://
       protocol so the twin works offline and inside sandboxed frames. If the local
       files cannot be fetched (e.g. opened from file://) it falls back to live
       OpenFreeMap tiles. */
(function (root) {
  const OVERVIEW = { center: [-78.6440, 35.7990], zoom: 13.05, pitch: 58, bearing: -20 };
  const MAPBOX_VER = '3.7.0';

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
    const map = new gl.Map({ container, style: 'mapbox://styles/mapbox/dark-v11', ...OVERVIEW, antialias: true, attributionControl: false, minZoom: 10.6, maxZoom: 18.5, maxPitch: 75, projection: 'mercator' });
    await new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error('Mapbox style timeout')), 12000);
      map.once('style.load', () => { clearTimeout(to); res(); });
      map.on('error', (e) => { if (e && e.error && /401|403|token/i.test(String(e.error.message || e.error.status))) { clearTimeout(to); rej(e.error); } });
    });
    // Desaturate the Mapbox style toward the twin palette and add massing.
    const C = root.TWIN.style.COLORS;
    for (const l of map.getStyle().layers) {
      try {
        if (l.type === 'background') map.setPaintProperty(l.id, 'background-color', C.bg);
        if (l.id.startsWith('water')) l.type === 'fill' ? map.setPaintProperty(l.id, 'fill-color', C.water) : null;
        if (l.id === 'building') map.setLayoutProperty(l.id, 'visibility', 'none');
      } catch (e) { /* layer without that property */ }
    }
    const firstSymbol = map.getStyle().layers.find((l) => l.type === 'symbol');
    map.addLayer({
      id: 'building-3d', type: 'fill-extrusion', source: 'composite', 'source-layer': 'building', minzoom: 12.5, filter: ['==', ['get', 'extrude'], 'true'],
      paint: {
        'fill-extrusion-color': ['interpolate', ['linear'], ['get', 'height'], 0, '#242a32', 12, '#2b323b', 30, '#353d48', 70, '#444d5a', 160, '#5a6472'],
        'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-base': ['get', 'min_height'], 'fill-extrusion-opacity': 0.94,
      },
    }, firstSymbol && firstSymbol.id);
    return { gl, map, renderer: 'Mapbox GL JS ' + gl.version, labelFont: ['DIN Pro Bold', 'Arial Unicode MS Bold'] };
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
            if (u.startsWith('tiles/')) return { data: await fromBundle('tiles', u.slice(6)) };
            const [, stack, range] = u.split('/');
            return { data: await fromBundle('fonts', slug(stack.split(',')[0]) + '/' + range) };
          }
          let path;
          if (u.startsWith('tiles/')) path = base + 'data/' + u + '.pbf';
          else { const [, stack, range] = u.split('/'); path = base + 'data/fonts/' + slug(stack.split(',')[0]) + '/' + range + '.pbf'; }
          try {
            const r = await fetch(path, { signal: abort && abort.signal });
            if (!r.ok) return { data: new ArrayBuffer(0) };
            return { data: await r.arrayBuffer() };
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
    const style = root.TWIN.style.build({ tiles, glyphs, extent: geo.extent, attribution: geo.attribution });
    const map = new gl.Map({
      container, style, ...OVERVIEW, antialias: true, attributionControl: false, minZoom: 10.6, maxZoom: 18.5, maxPitch: 75,
      maxBounds: [[W - 0.07, S - 0.06], [E + 0.07, N + 0.06]], fadeDuration: 120, dragRotate: true, pitchWithRotate: true,
    });
    await new Promise((res) => map.once('load', res));
    return { gl, map, renderer: `MapLibre GL JS ${gl.getVersion ? gl.getVersion() : ''} · ${local ? 'offline OSM tiles' : 'OpenFreeMap'}`, labelFont: ['Noto Sans Bold'] };
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
      const zoom = { hospital: 15.6, power: 15.8, traffic: 15.9, drainage: 15.9, weather: 14.8 }[f.type] || 15.8;
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

    return {
      ...M, OVERVIEW, setPadding, flyToFacility, overview, orbit,
      onUserInteract: (cb) => interactListeners.push(cb),
      get padding() { return padding; },
    };
  }

  root.TWIN.twinmap = { create, OVERVIEW };
})(typeof window !== 'undefined' ? window : globalThis);
