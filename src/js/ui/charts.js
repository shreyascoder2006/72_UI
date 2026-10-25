/* Canvas charts: risk ring, forecast with uncertainty band, trend bars, timeline track.
   All drawing is DPR-aware and reads colours from the CSS tokens. */
(function (root) {
  const { RISK_HEX, stateOf } = root.TWIN.core;
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  function prep(canvas, h) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth || canvas.parentElement.clientWidth;
    const H = h || canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(H * dpr);
    }
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, H);
    return { g, w, h: H };
  }

  function ring(canvas, v, sd) {
    const { g, w, h } = prep(canvas, 96);
    const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 7;
    const col = RISK_HEX[stateOf(v).key];
    g.lineCap = 'round';
    // threshold ticks
    g.strokeStyle = 'rgba(255,255,255,0.07)'; g.lineWidth = 6;
    g.beginPath(); g.arc(cx, cy, r, -Math.PI / 2, Math.PI * 1.5); g.stroke();
    for (const th of [0.35, 0.55, 0.75]) {
      const a = -Math.PI / 2 + th * Math.PI * 2;
      g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * (r - 6), cy + Math.sin(a) * (r - 6)); g.lineTo(cx + Math.cos(a) * (r + 6), cy + Math.sin(a) * (r + 6)); g.stroke();
    }
    // uncertainty arc
    if (sd) {
      g.strokeStyle = col + '40'; g.lineWidth = 10;
      g.beginPath(); g.arc(cx, cy, r, -Math.PI / 2 + Math.max(0, v - sd) * Math.PI * 2, -Math.PI / 2 + Math.min(1, v + sd) * Math.PI * 2); g.stroke();
    }
    g.strokeStyle = col; g.lineWidth = 6;
    if (v >= 0.75) { g.shadowColor = col; g.shadowBlur = 10; }
    g.beginPath(); g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.max(0.005, v) * Math.PI * 2); g.stroke();
    g.shadowBlur = 0;
  }

  // series: [{t, mean, p10, p90}] (forecast from tNow); past: [{t, v}] analysis; truth optional.
  function forecast(canvas, o) {
    const { g, w, h } = prep(canvas, 132);
    const pad = { l: 26, r: 8, t: 8, b: 18 };
    const X = (t) => pad.l + ((t - o.t0) / (o.t1 - o.t0)) * (w - pad.l - pad.r);
    const Y = (v) => pad.t + (1 - v) * (h - pad.t - pad.b);
    g.font = '500 9px ' + css('--font-mono');
    // threshold bands
    const bands = [[0.75, 1, RISK_HEX.critical], [0.55, 0.75, RISK_HEX.high], [0.35, 0.55, RISK_HEX.watch]];
    for (const [a, b, c] of bands) { g.fillStyle = c + '0d'; g.fillRect(pad.l, Y(b), w - pad.l - pad.r, Y(a) - Y(b)); }
    g.strokeStyle = 'rgba(255,255,255,0.06)'; g.lineWidth = 1;
    g.fillStyle = css('--text-4');
    for (const v of [0, 0.35, 0.55, 0.75, 1]) {
      g.beginPath(); g.moveTo(pad.l, Y(v) + 0.5); g.lineTo(w - pad.r, Y(v) + 0.5); g.stroke();
      g.fillText(String(Math.round(v * 100)), 2, Y(v) + 3);
    }
    // time axis
    g.fillStyle = css('--text-3');
    const step = o.t1 - o.t0 > 40 ? 12 : 6;
    for (let t = Math.ceil(o.t0 / step) * step; t <= o.t1; t += step) {
      g.fillText('T+' + t, X(t) - 10, h - 5);
      g.strokeStyle = 'rgba(255,255,255,0.04)'; g.beginPath(); g.moveTo(X(t) + 0.5, pad.t); g.lineTo(X(t) + 0.5, h - pad.b); g.stroke();
    }
    // forecast band
    if (o.series && o.series.length > 1) {
      g.fillStyle = 'rgba(121,167,227,0.14)';
      g.beginPath();
      o.series.forEach((s, j) => (j ? g.lineTo(X(s.t), Y(s.p90)) : g.moveTo(X(s.t), Y(s.p90))));
      for (let j = o.series.length - 1; j >= 0; j--) g.lineTo(X(o.series[j].t), Y(o.series[j].p10));
      g.closePath(); g.fill();
      g.setLineDash([4, 3]); g.strokeStyle = css('--accent'); g.lineWidth = 1.5;
      g.beginPath(); o.series.forEach((s, j) => (j ? g.lineTo(X(s.t), Y(s.mean)) : g.moveTo(X(s.t), Y(s.mean)))); g.stroke();
      g.setLineDash([]);
    }
    // truth (historical replay only)
    if (o.truth) {
      g.strokeStyle = 'rgba(255,255,255,0.28)'; g.lineWidth = 1; g.setLineDash([1.5, 2.5]);
      g.beginPath(); o.truth.forEach((p, j) => (j ? g.lineTo(X(p.t), Y(p.v)) : g.moveTo(X(p.t), Y(p.v)))); g.stroke(); g.setLineDash([]);
    }
    // analysis (past), coloured by state
    if (o.past && o.past.length > 1) {
      g.lineWidth = 1.8;
      for (let j = 1; j < o.past.length; j++) {
        const a = o.past[j - 1], b = o.past[j];
        g.strokeStyle = RISK_HEX[stateOf(b.v).key];
        g.beginPath(); g.moveTo(X(a.t), Y(a.v)); g.lineTo(X(b.t), Y(b.v)); g.stroke();
      }
    }
    // now and view markers
    if (o.tNow != null) {
      g.strokeStyle = 'rgba(255,77,79,0.8)'; g.setLineDash([3, 3]); g.lineWidth = 1;
      g.beginPath(); g.moveTo(X(o.tNow) + 0.5, pad.t); g.lineTo(X(o.tNow) + 0.5, h - pad.b); g.stroke(); g.setLineDash([]);
    }
    if (o.tView != null) {
      g.fillStyle = '#fff';
      const v = o.vView;
      g.beginPath(); g.arc(X(o.tView), Y(v), 3.2, 0, Math.PI * 2); g.fill();
    }
  }

  function bars(canvas, values, labels, opts = {}) {
    const { g, w, h } = prep(canvas, opts.height || 92);
    const pad = { l: 22, r: 4, t: 6, b: 16 };
    const n = values.length, bw = (w - pad.l - pad.r) / n;
    const Y = (v) => pad.t + (1 - v) * (h - pad.t - pad.b);
    g.font = '500 9px ' + css('--font-mono');
    g.fillStyle = css('--text-4');
    for (const v of [0, 0.5, 1]) {
      g.strokeStyle = 'rgba(255,255,255,0.06)'; g.beginPath(); g.moveTo(pad.l, Y(v) + 0.5); g.lineTo(w - pad.r, Y(v) + 0.5); g.stroke();
      g.fillText(String(Math.round(v * 100)), 2, Y(v) + 3);
    }
    const base = css('--chart-bar');
    for (let j = 0; j < n; j++) {
      const v = values[j];
      if (v == null) continue;
      const x = pad.l + j * bw + bw * 0.18, bh = Y(0) - Y(v);
      g.fillStyle = v >= 0.75 ? RISK_HEX.critical : base;
      g.globalAlpha = j === n - 1 ? 1 : 0.82;
      g.fillRect(x, Y(v), bw * 0.64, bh);
    }
    g.globalAlpha = 1;
    g.fillStyle = css('--text-3');
    labels.forEach((lb, j) => { if (lb) g.fillText(lb, pad.l + j * bw + bw * 0.5 - g.measureText(lb).width / 2, h - 4); });
  }

  // Timeline track: city risk area coloured by state, forecast hatch, event ticks.
  function track(canvas, o) {
    const { g, w, h } = prep(canvas);
    const X = (t) => (t / o.hours) * w;
    const Y = (v) => h - 2 - v * (h - 8);
    // forecast region hatch
    if (o.tNow < o.hours) {
      g.save(); g.beginPath(); g.rect(X(o.tNow), 0, w - X(o.tNow), h); g.clip();
      g.strokeStyle = 'rgba(255,255,255,0.045)'; g.lineWidth = 1;
      for (let x = -h; x < w; x += 6) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + h, 0); g.stroke(); }
      g.restore();
    }
    g.fillStyle = 'rgba(255,255,255,0.03)'; g.fillRect(0, 0, w, h);
    // day separators
    g.strokeStyle = 'rgba(255,255,255,0.08)';
    for (let t = 0; t <= o.hours; t += 6) { g.beginPath(); g.moveTo(X(t) + 0.5, t % 24 === 0 ? 0 : h - 6); g.lineTo(X(t) + 0.5, h); g.stroke(); }
    // risk area
    const pts = o.city;
    for (let j = 1; j < pts.length; j++) {
      const a = pts[j - 1], b = pts[j];
      const col = RISK_HEX[stateOf(b.v).key];
      const fut = b.t > o.tNow + 1e-6;
      g.fillStyle = col + (fut ? '30' : '55');
      g.beginPath(); g.moveTo(X(a.t), h); g.lineTo(X(a.t), Y(a.v)); g.lineTo(X(b.t), Y(b.v)); g.lineTo(X(b.t), h); g.closePath(); g.fill();
      g.strokeStyle = col; g.globalAlpha = fut ? 0.55 : 1; g.lineWidth = 1.3;
      g.beginPath(); g.moveTo(X(a.t), Y(a.v)); g.lineTo(X(b.t), Y(b.v)); g.stroke(); g.globalAlpha = 1;
    }
    // event ticks (critical crossings)
    for (const ev of o.events) {
      g.fillStyle = ev.observed ? RISK_HEX.critical : RISK_HEX.critical + '88';
      g.fillRect(X(ev.t) - 1, 0, 2, 5);
    }
  }

  root.TWIN.charts = { ring, forecast, bars, track, prep };
})(typeof window !== 'undefined' ? window : globalThis);
