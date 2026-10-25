/* Dark CIM basemap for the OpenMapTiles schema (OpenStreetMap data).

   Low-saturation charcoal ground, slate water, graded grey roads and height-graded
   building massing. Colour is left to the infrastructure and risk layers. */
(function (root) {
  const C = {
    bg: '#0b0d10', land: '#0c0e11', park: '#0e1412', wood: '#0d1311', water: '#0a1723', waterway: '#10293d',
    minor: '#16191e', street: '#1b1f25', primary: '#232830', motorway: '#2a3039', rail: '#1d2026',
    label: '#5b6570', halo: '#0a0c0f',
  };

  function build(opts) {
    const { tiles, glyphs, extent, attribution } = opts;
    const lw = (z0, w0, z1, w1) => ['interpolate', ['exponential', 1.6], ['zoom'], z0, w0, z1, w1];
    return {
      version: 8,
      name: 'Raleigh Twin Dark',
      glyphs,
      sources: {
        omt: { type: 'vector', tiles: [tiles], minzoom: 10, maxzoom: 14, bounds: extent, attribution },
      },
      light: { anchor: 'viewport', color: '#e6edf7', intensity: 0.42, position: [1.3, 200, 40] },
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
        // Infrastructure and cascade layers are inserted here, below the buildings.
        { id: 'building-3d', type: 'fill-extrusion', source: 'omt', 'source-layer': 'building', minzoom: 12.9,
          filter: ['!=', ['get', 'hide_3d'], true],
          paint: {
            'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 6],
              0, '#242a32', 12, '#2b323b', 30, '#353d48', 70, '#444d5a', 160, '#5a6472'],
            'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 12.9, 0, 13.3, ['coalesce', ['get', 'render_height'], 6]],
            'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
            'fill-extrusion-opacity': 0.94,
            'fill-extrusion-vertical-gradient': true,
          } },
        { id: 'road-label', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 14.2,
          filter: ['has', 'name'],
          layout: {
            'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 14, 9.5, 18, 12], 'text-letter-spacing': 0.04, 'text-max-angle': 30,
          },
          paint: { 'text-color': C.label, 'text-halo-color': C.halo, 'text-halo-width': 1.4 } },
      ],
    };
  }

  root.TWIN.style = { build, COLORS: C };
})(typeof window !== 'undefined' ? window : globalThis);
