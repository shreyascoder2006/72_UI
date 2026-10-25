/* Weather radar overlay: a canvas source georeferenced to the twin extent.

   The rain field comes from the engine (observed storm up to "now", most probable
   member after it). A drifting multi-octave noise texture adds convective structure
   so it reads like a reflectivity composite rather than a smooth gradient. */
(function (root) {
  const COARSE = 96, OUT = 384;
  // Reflectivity-style ramp, desaturated to sit on the dark basemap (mm/h → rgba).
  const STOPS = [
    [0.25, [40, 110, 140, 0]], [0.9, [45, 140, 150, 70]], [2.5, [55, 160, 135, 115]], [5, [70, 175, 115, 135]], [9, [190, 190, 70, 150]],
    [14, [230, 150, 50, 170]], [22, [230, 80, 60, 185]], [35, [200, 70, 160, 200]],
  ];
  function color(v) {
    if (v <= STOPS[0][0]) return [0, 0, 0, 0];
    for (let s = 1; s < STOPS.length; s++) {
      if (v <= STOPS[s][0]) {
        const [a, ca] = STOPS[s - 1], [b, cb] = STOPS[s];
        const t = (v - a) / (b - a);
        return ca.map((x, j) => x + (cb[j] - x) * t);
      }
    }
    return STOPS[STOPS.length - 1][1];
  }

  function noiseTexture(size, seed) {
    const rand = root.TWIN.core.mulberry32(seed);
    const out = new Float32Array(size * size);
    let amp = 1, total = 0;
    for (let oct = 0; oct < 5; oct++) {
      const cells = 4 << oct, grid = new Float32Array((cells + 1) * (cells + 1));
      for (let q = 0; q < grid.length; q++) grid[q] = rand();
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const gx = (x / size) * cells, gy = (y / size) * cells;
        const x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0;
        const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
        const i = y0 * (cells + 1) + x0;
        const v = grid[i] * (1 - sx) * (1 - sy) + grid[i + 1] * sx * (1 - sy) + grid[i + cells + 1] * (1 - sx) * sy + grid[i + cells + 2] * sx * sy;
        out[y * size + x] += v * amp;
      }
      total += amp; amp *= 0.55;
    }
    for (let q = 0; q < out.length; q++) out[q] /= total;
    return out;
  }

  function install(map, geo, before) {
    const [W, S, E, N] = geo.extent;
    const canvas = document.createElement('canvas');
    canvas.width = OUT; canvas.height = OUT;
    const ctx = canvas.getContext('2d');
    const coarse = document.createElement('canvas');
    coarse.width = COARSE; coarse.height = COARSE;
    const cctx = coarse.getContext('2d');
    const img = cctx.createImageData(COARSE, COARSE);
    const NS = 128, noise = noiseTexture(NS, 4242);

    map.addSource('radar', { type: 'canvas', canvas, coordinates: [[W, N], [E, N], [E, S], [W, S]], animate: true });
    map.addLayer({ id: 'radar', type: 'raster', source: 'radar', paint: { 'raster-opacity': 0.62, 'raster-fade-duration': 0, 'raster-resampling': 'linear' } }, before);

    let field = null, heading = 40;
    function draw(rainAt, t, hdg) {
      heading = hdg;
      field = { rainAt, t };
      render(performance.now());
    }
    function render(now) {
      if (!field) return;
      const { rainAt, t } = field;
      const drift = (t * 0.035 + now / 90000) % 1; // texture advects with the storm
      const hr = (heading * Math.PI) / 180;
      const dx = Math.sin(hr) * drift * NS, dy = -Math.cos(hr) * drift * NS;
      const d = img.data;
      let any = false;
      for (let y = 0; y < COARSE; y++) {
        const lat = N - ((y + 0.5) / COARSE) * (N - S);
        for (let x = 0; x < COARSE; x++) {
          const lng = W + ((x + 0.5) / COARSE) * (E - W);
          const base = rainAt(lng, lat, t);
          const nx = (((x / COARSE) * NS - dx) % NS + NS) % NS | 0, ny = (((y / COARSE) * NS - dy) % NS + NS) % NS | 0;
          const n = noise[ny * NS + nx];
          const v = base * (0.35 + 1.5 * n * n);
          const c = color(v);
          const o = (y * COARSE + x) * 4;
          d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = c[3];
          if (c[3] > 0) any = true;
        }
      }
      cctx.putImageData(img, 0, 0);
      ctx.clearRect(0, 0, OUT, OUT);
      if (any) { ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(coarse, 0, 0, OUT, OUT); }
    }
    function setVisible(on) {
      map.setLayoutProperty('radar', 'visibility', on ? 'visible' : 'none');
      const src = map.getSource('radar');
      if (src) on ? src.play() : src.pause();
    }
    return { draw, render, setVisible };
  }

  root.TWIN.radar = { install };
})(typeof window !== 'undefined' ? window : globalThis);
