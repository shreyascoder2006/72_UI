/* Dark CIM basemap for the OpenMapTiles schema (OpenStreetMap data).

   Low-saturation charcoal ground, slate water and graded grey roads. Colour is left to
   the infrastructure and risk layers. Buildings carry the realism:
     • facade tones by building class (from OSM land use, see tools/enrich_buildings.py)
       with per-building variation, roofs as a separate cap in roofing materials,
     • a soft contact shadow at every footprint and sun-cast ground shadows (shadows.js),
     • a sun light, sky gradient and horizon haze that follow the simulation clock
       (applyDaylight), so shading shifts as the timeline is scrubbed. */
(function (root) {
  const C = {
    bg: '#0b0d10', land: '#0c0e11', park: '#0e1412', wood: '#0d1311', water: '#0a1723', waterway: '#10293d',
    minor: '#16191e', street: '#1b1f25', primary: '#232830', motorway: '#2a3039', rail: '#1d2026',
    label: '#5b6570', halo: '#0a0c0f',
  };
  // Facade tones per class: [low-rise, high-rise]. Residential gets three families
  // (brick, render, painted siding) so neighbourhoods do not read as one material.
  const FACADE = {
    residential: [['#30302f', '#3c3b39'], ['#2c2a28', '#3a3531'], ['#2a2e33', '#373d44']],
    commercial: ['#28303a', '#3e4957'], industrial: ['#2e2f2d', '#3c3d3a'],
    civic: ['#322f2b', '#433e37'], hospital: ['#353b41', '#4c545d'], other: ['#2a2e33', '#3a4048'],
  };
  const ROOF = { residential: '#25272a', commercial: '#3a3e43', industrial: '#373b3f', civic: '#34373a', hospital: '#42474d', other: '#2f3236' };
  const BUILDING_LAYERS = ['building-ao', 'building-shadows', 'building-3d', 'building-roof', 'facility-3d', 'facility-roof'];
  const MINZ = 12.9;

  const H = ['coalesce', ['get', 'render_height'], ['get', 'h'], 6];
  const H0 = ['coalesce', ['get', 'render_min_height'], ['get', 'mh'], 0];
  const CLS = ['coalesce', ['get', 'class'], ['get', 'c'], 'other'];
  // Buildings rise from the ground as the city model comes into view.
  const grow = (v) => ['interpolate', ['linear'], ['zoom'], MINZ, 0, MINZ + 0.4, v];
  const variant = ['%', ['round', ['*', H, 2]], 3];
  function facadeColor() {
    const at = (k) => ['match', CLS,
      'residential', ['match', variant, 0, FACADE.residential[0][k], 1, FACADE.residential[1][k], FACADE.residential[2][k]],
      'commercial', FACADE.commercial[k], 'industrial', FACADE.industrial[k], 'civic', FACADE.civic[k], 'hospital', FACADE.hospital[k],
      FACADE.other[k]];
    return ['interpolate', ['linear'], H, 0, at(0), 60, at(1)];
  }
  const roofColor = () => ['match', CLS, ...Object.entries(ROOF).filter(([k]) => k !== 'other').flat(), ROOF.other];

  function buildingLayers(id, source, sourceLayer, filter) {
    const src = sourceLayer ? { source, 'source-layer': sourceLayer } : { source };
    return [
      { id: `${id}-3d`, type: 'fill-extrusion', ...src, minzoom: MINZ, filter,
        paint: {
          'fill-extrusion-color': facadeColor(),
          'fill-extrusion-height': grow(H), 'fill-extrusion-base': grow(H0),
          'fill-extrusion-opacity': 1, 'fill-extrusion-vertical-gradient': true,
        } },
      // Roof cap: a thin slab in roofing material on top of each building.
      { id: `${id}-roof`, type: 'fill-extrusion', ...src, minzoom: 14.2, filter,
        paint: {
          'fill-extrusion-color': roofColor(),
          'fill-extrusion-base': grow(H), 'fill-extrusion-height': grow(['+', H, 0.35]),
          'fill-extrusion-opacity': 1, 'fill-extrusion-vertical-gradient': false,
        } },
    ];
  }

  function build(opts) {
    const { tiles, glyphs, extent, attribution, sites } = opts;
    const lw = (z0, w0, z1, w1) => ['interpolate', ['exponential', 1.6], ['zoom'], z0, w0, z1, w1];
    const notHidden = ['!=', ['get', 'hide_3d'], true];
    const [bld3d, bldRoof] = buildingLayers('building', 'omt', 'building', notHidden);
    const [fac3d, facRoof] = buildingLayers('facility', 'sites', null, ['!=', ['get', 'fi'], -1]);
    return {
      version: 8,
      name: 'Cascade Twin Dark',
      glyphs,
      sources: {
        omt: { type: 'vector', tiles: [tiles], minzoom: 10, maxzoom: 14, bounds: extent, attribution },
        // Footprints at hero-model sites, lifted out of the tiles so they can be hidden
        // while the facility's 3D model stands in their place.
        sites: { type: 'geojson', data: sitesGeoJSON(sites || []) },
      },
      light: { anchor: 'map', color: '#fff4e6', intensity: 0.5, position: [1.15, 210, 45] },
      sky: skySpec('day'),
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': C.bg } },
        { id: 'landuse', type: 'fill', source: 'omt', 'source-layer': 'landuse',
          paint: { 'fill-color': ['match', ['get', 'class'], ['commercial', 'retail', 'industrial'], '#0e1014', ['school', 'university', 'hospital'], '#0f1115', C.land], 'fill-opacity': 0.9 } },
        { id: 'landcover', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: ['in', ['get', 'class'], ['literal', ['wood', 'grass', 'farmland', 'wetland']]],
          paint: { 'fill-color': ['match', ['get', 'class'], 'wood', C.wood, C.park], 'fill-opacity': 0.85 } },
        { id: 'park', type: 'fill', source: 'omt', 'source-layer': 'park', paint: { 'fill-color': C.park, 'fill-opacity': 0.8 } },
        { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', filter: ['!=', ['get', 'class'], 'swimming_pool'], paint: { 'fill-color': C.water } },
        { id: 'waterway', type: 'line', source: 'omt', 'source-layer': 'waterway',
          paint: { 'line-color': C.waterway, 'line-width': lw(10, 0.4, 17, 2.4) } },
        { id: 'aeroway', type: 'fill', source: 'omt', 'source-layer': 'aeroway', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#101317' } },
        { id: 'rail', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ['==', ['get', 'class'], 'rail'],
          paint: { 'line-color': C.rail, 'line-width': lw(12, 0.5, 17, 1.6), 'line-dasharray': [3, 2] } },
        { id: 'road-minor', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 12.5,
          filter: ['in', ['get', 'class'], ['literal', ['minor', 'service', 'track']]],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': C.minor, 'line-width': lw(12.5, 0.4, 18, 7) } },
        { id: 'road-street', type: 'line', source: 'omt', 'source-layer': 'transportation',
          filter: ['in', ['get', 'class'], ['literal', ['tertiary', 'secondary']]],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': C.street, 'line-width': lw(11, 0.5, 18, 11) } },
        { id: 'road-primary', type: 'line', source: 'omt', 'source-layer': 'transportation',
          filter: ['in', ['get', 'class'], ['literal', ['primary', 'trunk']]],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': C.primary, 'line-width': lw(10, 0.7, 18, 14) } },
        { id: 'road-motorway', type: 'line', source: 'omt', 'source-layer': 'transportation',
          filter: ['==', ['get', 'class'], 'motorway'],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': C.motorway, 'line-width': lw(10, 0.9, 18, 17) } },
        // Contact shadow: a soft dark rim where walls meet the ground.
        { id: 'building-ao', type: 'line', source: 'omt', 'source-layer': 'building', minzoom: 14, filter: notHidden,
          paint: { 'line-color': '#000000', 'line-width': lw(14, 1.5, 18, 16), 'line-blur': lw(14, 1.5, 18, 16),
            'line-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0, 14.6, 0.55] } },
        // Sun-cast ground shadows (custom layer, shadows.js) go here; infrastructure and
        // cascade layers are inserted after them, below the buildings.
        bld3d, bldRoof, fac3d, facRoof,
        { id: 'road-label', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 14.2,
          filter: ['has', 'name'],
          layout: {
            'symbol-placement': 'line', 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name_en'], ['get', 'name:latin'], ['get', 'name']], 'text-font': ['Noto Sans Regular'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 14, 9.5, 18, 12], 'text-letter-spacing': 0.04, 'text-max-angle': 30,
          },
          paint: { 'text-color': C.label, 'text-halo-color': C.halo, 'text-halo-width': 1.4 } },
      ],
    };
  }

  function sitesGeoJSON(sites) {
    const features = [];
    for (const s of sites) for (const fp of s.footprints || []) {
      features.push({ type: 'Feature', properties: { fi: s.fi, h: fp.h, mh: fp.mh, c: fp.c }, geometry: { type: 'Polygon', coordinates: fp.g } });
    }
    return { type: 'FeatureCollection', features };
  }
  // Hide the lifted footprint of facility i (null shows all).
  function hideSite(map, i) {
    const f = ['!=', ['get', 'fi'], i == null ? -1 : i];
    for (const id of ['facility-3d', 'facility-roof']) if (map.getLayer(id)) map.setFilter(id, f);
  }

  // ── Daylight ─────────────────────────────────────────────────────────────
  // Muted to stay inside the command-center palette while still reading as time of day.
  const SKY = {
    day: { 'sky-color': '#20324a', 'horizon-color': '#56697f', 'sky-horizon-blend': 0.6, haze: [86, 104, 124, 0.30] },
    dawn: { 'sky-color': '#1d2540', 'horizon-color': '#9a7464', 'sky-horizon-blend': 0.7, haze: [150, 114, 100, 0.24] },
    dusk: { 'sky-color': '#1c2036', 'horizon-color': '#a8664c', 'sky-horizon-blend': 0.7, haze: [160, 100, 76, 0.24] },
    night: { 'sky-color': '#06080d', 'horizon-color': '#18202f', 'sky-horizon-blend': 0.6, haze: [24, 32, 48, 0.34] },
  };
  for (const s of Object.values(SKY)) Object.assign(s, { 'fog-color': s['horizon-color'], 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.5, 'atmosphere-blend': 0 });
  const LIGHT = {
    day: { color: '#fff4e6', intensity: 0.55 }, dawn: { color: '#ffc89e', intensity: 0.46 },
    dusk: { color: '#ffb184', intensity: 0.46 }, night: { color: '#8fa6d6', intensity: 0.24 },
  };
  const skySpec = (phase) => { const { haze, ...s } = SKY[phase]; return s; };

  function applyDaylight(map, sun, phase) {
    const up = sun.elevation > 0;
    // Below the horizon the scene is lit by a high, cool sky light instead of the sun.
    const position = up ? [1.15, sun.azimuth, Math.min(88, 90 - sun.elevation)] : [1.15, 200, 40];
    map.setLight({ anchor: 'map', position, ...LIGHT[phase] });
    if (map.setSky) map.setSky(skySpec(phase));
    const haze = hazeOf(map);
    if (haze) { const [r, g, b, a] = SKY[phase].haze; haze.style.setProperty('--haze', `rgba(${r},${g},${b},${a})`); }
  }

  // Horizon haze: MapLibre only fogs terrain, so distance haze over the flat city is a
  // gradient overlay pinned to the horizon line (the same line the sky is drawn from).
  const hazes = new WeakMap();
  function hazeOf(map) { return hazes.get(map); }
  function attach(map) {
    const el = document.createElement('div');
    el.className = 'twin-haze';
    const canvas = map.getCanvas();
    canvas.parentNode.insertBefore(el, canvas.nextSibling);
    hazes.set(map, el);
    const place = () => {
      const tr = map.transform;
      const h = canvas.clientHeight;
      const hor = tr && tr.getHorizon ? h / 2 - tr.getHorizon() : -h;
      el.style.width = `${canvas.clientWidth}px`; el.style.height = `${h}px`;
      el.style.setProperty('--hy', `${Math.round(hor)}px`);
      el.style.opacity = String(Math.max(0, Math.min(1, (map.getPitch() - 30) / 25)));
    };
    map.on('move', place); map.on('resize', place);
    place();
  }

  root.TWIN.style = { build, attach, applyDaylight, hideSite, BUILDING_LAYERS, COLORS: C };
})(typeof window !== 'undefined' ? window : globalThis);
