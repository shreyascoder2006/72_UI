/* Live sensor feed: a procedural rendering per facility type, driven by its state.
   Traffic camera (vehicles slow and bunch with congestion), culvert camera with a
   staff gauge, SCADA one-line, hospital bed board, EMS unit board, radar scope. */
(function (root) {
  const { RISK_HEX, stateOf, mulberry32, clamp } = root.TWIN.core;

  function create(canvas) {
    const g = canvas.getContext('2d');
    let W = 0, H = 0, raf = 0, st = null, t0 = performance.now();
    const rand = mulberry32(99);
    const cars = Array.from({ length: 34 }, (_, i) => ({ lane: i % 4, pos: rand(), len: 0.035 + rand() * 0.02, hue: rand() }));
    const drops = Array.from({ length: 90 }, () => ({ x: rand(), y: rand(), s: 0.5 + rand() }));
    const grain = document.createElement('canvas');
    grain.width = 128; grain.height = 72;
    {
      const gg = grain.getContext('2d'), im = gg.createImageData(128, 72);
      for (let q = 0; q < im.data.length; q += 4) { const v = rand() * 255; im.data[q] = im.data[q + 1] = im.data[q + 2] = v; im.data[q + 3] = 18; }
      gg.putImageData(im, 0, 0);
    }

    function size() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w) return false;
      if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      W = w; H = h;
      return true;
    }

    function frame(now) {
      raf = requestAnimationFrame(frame);
      if (!st || !size()) return;
      const t = (now - t0) / 1000;
      if (st.offline) return offline(t);
      ({ traffic: traffic, drainage: drainage, pump: pump, power: power, hospital: hospital, ems: ems, weather: weather })[st.kind](t);
      // film grain + scanlines + vignette
      g.globalAlpha = 0.9; g.drawImage(grain, (t * 37) % 7 - 7, (t * 53) % 5 - 5, W + 14, H + 10); g.globalAlpha = 1;
      g.fillStyle = 'rgba(0,0,0,0.12)'; for (let y = 0; y < H; y += 3) g.fillRect(0, y, W, 1);
      const vg = g.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.7);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)');
      g.fillStyle = vg; g.fillRect(0, 0, W, H);
    }

    function offline(t) {
      g.fillStyle = '#0a0b0d'; g.fillRect(0, 0, W, H);
      for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.12})`; g.fillRect(Math.random() * W, Math.random() * H, 2, 1); }
      g.fillStyle = '#8a939e'; g.font = '600 11px ' + getComputedStyle(document.documentElement).getPropertyValue('--font-mono');
      g.textAlign = 'center'; g.fillText('NO SIGNAL', W / 2, H / 2 + 4); g.textAlign = 'left';
    }

    // Top-down camera over a signalized junction.
    function traffic(t) {
      const r = st.risk, flood = st.flood || 0;
      g.fillStyle = '#1a1c1f'; g.fillRect(0, 0, W, H);
      const road = H * 0.42, cx = W / 2, cy = H / 2;
      g.fillStyle = '#26292d'; g.fillRect(0, cy - road / 2, W, road); g.fillRect(cx - road / 2, 0, road, H);
      // markings
      g.strokeStyle = 'rgba(230,230,210,0.5)'; g.setLineDash([10, 9]); g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(0, cy); g.lineTo(cx - road / 2, cy); g.moveTo(cx + road / 2, cy); g.lineTo(W, cy); g.moveTo(cx, 0); g.lineTo(cx, cy - road / 2); g.moveTo(cx, cy + road / 2); g.lineTo(cx, H); g.stroke(); g.setLineDash([]);
      g.fillStyle = 'rgba(235,235,220,0.55)';
      for (let k = 0; k < 6; k++) { g.fillRect(cx - road / 2 - 14, cy - road / 2 + 3 + k * (road / 6), 10, road / 12); g.fillRect(cx + road / 2 + 4, cy - road / 2 + 3 + k * (road / 6), 10, road / 12); }
      // vehicles: speed falls and spacing tightens with congestion
      const speed = 0.11 * (1 - 0.92 * clamp((r - 0.25) / 0.65, 0, 1));
      const lanes = [[0, cy - road * 0.3, 1], [0, cy - road * 0.1, 1], [0, cy + road * 0.1, -1], [0, cy + road * 0.3, -1]];
      for (const c of cars) {
        c.pos = (c.pos + speed * (0.7 + c.hue * 0.5) * 0.016 * (c.lane < 2 ? 1 : 1)) % 1;
        const horiz = c.lane % 2 === 0;
        const L = c.lane, dir = L < 2 ? 1 : -1;
        let x, y, w, h;
        if (L === 0 || L === 2) { x = (dir > 0 ? c.pos : 1 - c.pos) * (W + 40) - 20; y = lanes[L === 0 ? 0 : 2][1]; w = c.len * W * 1.2; h = road * 0.12; }
        else { y = (dir > 0 ? c.pos : 1 - c.pos) * (H + 40) - 20; x = cx + (L === 1 ? -road * 0.2 : road * 0.2); w = road * 0.12; h = c.len * H * 1.6; }
        g.fillStyle = `hsl(${200 + c.hue * 40}, 8%, ${48 + c.hue * 30}%)`;
        g.fillRect(x - w / 2, y - h / 2, w, h);
        if (c.hue > 0.55) { g.strokeStyle = r > 0.55 ? 'rgba(238,138,42,0.9)' : 'rgba(80,220,140,0.8)'; g.lineWidth = 1; g.strokeRect(x - w / 2 - 3, y - h / 2 - 3, w + 6, h + 6); }
      }
      if (flood > 0.05) { g.fillStyle = `rgba(60,120,170,${0.35 * flood})`; g.fillRect(0, cy - road / 2, W, road); }
      rain(t);
    }

    // Culvert camera with a staff gauge.
    function drainage(t) {
      const r = st.risk;
      g.fillStyle = '#121416'; g.fillRect(0, 0, W, H);
      g.fillStyle = '#2a2d31'; g.beginPath(); g.moveTo(0, H * 0.18); g.lineTo(W * 0.32, H * 0.3); g.lineTo(W * 0.32, H); g.lineTo(0, H); g.fill();
      g.beginPath(); g.moveTo(W, H * 0.18); g.lineTo(W * 0.68, H * 0.3); g.lineTo(W * 0.68, H); g.lineTo(W, H); g.fill();
      g.fillStyle = '#0b0c0d'; g.beginPath(); g.ellipse(W / 2, H * 0.55, W * 0.16, H * 0.24, 0, 0, Math.PI * 2); g.fill();
      // staff gauge
      const gx = W * 0.76, gTop = H * 0.12, gBot = H * 0.94;
      g.fillStyle = '#d9d4c3'; g.fillRect(gx, gTop, 12, gBot - gTop);
      g.fillStyle = '#b4372f';
      for (let k = 0; k <= 16; k++) { const y = gBot - (k / 16) * (gBot - gTop); g.fillRect(gx, y - 1, k % 4 === 0 ? 12 : 6, 2); }
      // water
      const lvl = gBot - (0.12 + 0.8 * r) * (gBot - gTop);
      const wg = g.createLinearGradient(0, lvl, 0, H);
      wg.addColorStop(0, 'rgba(90,120,135,0.92)'); wg.addColorStop(1, 'rgba(40,60,70,0.95)');
      g.fillStyle = wg;
      g.beginPath(); g.moveTo(0, H);
      for (let x = 0; x <= W; x += 6) g.lineTo(x, lvl + Math.sin(x * 0.06 + t * 3) * 1.6 + Math.sin(x * 0.17 - t * 5) * 0.8);
      g.lineTo(W, H); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(220,235,240,0.35)'; g.lineWidth = 1;
      for (let k = 0; k < 7; k++) { const x = ((t * 40 + k * 70) % (W + 40)) - 20; g.beginPath(); g.moveTo(x, lvl + 6 + k * 3); g.lineTo(x + 18, lvl + 6 + k * 3); g.stroke(); }
      rain(t);
    }

    function pump(t) {
      const r = st.risk;
      scadaBg();
      labelR('WET WELL · PUMP STATUS', 18);
      g.strokeStyle = '#3a4048'; g.strokeRect(14, 30, 34, H - 46);
      g.fillStyle = 'rgba(74,149,220,0.75)'; const lv = (H - 48) * clamp(0.15 + r * 0.85, 0, 1); g.fillRect(15, H - 17 - lv, 32, lv);
      for (let p = 0; p < 3; p++) {
        const on = r > 0.25 + p * 0.2, x = 74 + p * 62;
        g.strokeStyle = on ? RISK_HEX[stateOf(r).key] : '#3a4048'; g.lineWidth = 2;
        g.beginPath(); g.arc(x + 16, 54, 14, 0, Math.PI * 2); g.stroke();
        if (on) { g.save(); g.translate(x + 16, 54); g.rotate(t * 6 * (1 + p * 0.2)); g.beginPath(); g.moveTo(-9, 0); g.lineTo(9, 0); g.moveTo(0, -9); g.lineTo(0, 9); g.stroke(); g.restore(); }
        label(`P${p + 1} ${on ? 'RUN' : 'STBY'}`, x + 2, 86);
      }
      trace(t, r, 74, H - 30, W - 88, 22);
    }

    function power(t) {
      const r = st.risk;
      scadaBg();
      g.strokeStyle = '#7d8794'; g.lineWidth = 3; g.beginPath(); g.moveTo(16, 26); g.lineTo(W - 16, 26); g.stroke();
      labelR(st.voltage ? st.voltage + ' BUS' : 'BUS', 18);
      const feeders = 5;
      for (let k = 0; k < feeders; k++) {
        const x = 30 + k * ((W - 60) / (feeders - 1));
        const load = clamp(r * (0.8 + 0.4 * Math.sin(k * 1.7)) + 0.05 * Math.sin(t * 2 + k), 0, 1);
        const trip = r > 0.78 && k === 1;
        g.strokeStyle = trip ? '#e5484d' : '#7d8794'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(x, 26); g.lineTo(x, 44); g.stroke();
        g.fillStyle = trip ? 'transparent' : '#7d8794'; g.strokeRect(x - 5, 44, 10, 10); if (!trip) g.fillRect(x - 5, 44, 10, 10);
        g.beginPath(); g.moveTo(x, 54); g.lineTo(x, H - 50); g.stroke();
        const bh = (H - 70) * 0.45;
        g.fillStyle = '#1d2228'; g.fillRect(x - 6, H - 44, 12, -bh);
        g.fillStyle = trip ? '#3a4048' : RISK_HEX[stateOf(load).key]; g.fillRect(x - 6, H - 44, 12, -bh * (trip ? 0 : load));
        label(trip ? 'OPEN' : Math.round(load * 100) + '%', x - 12, H - 30);
      }
    }

    function hospital(t) {
      const r = st.risk;
      scadaBg();
      const cols = 14, rows = 6, cw = (W - 28) / cols, ch = (H - 44) / rows;
      const occ = clamp(0.55 + 0.45 * r, 0, 1);
      const rnd = mulberry32(7);
      labelR(`CENSUS ${Math.round(occ * 100)}% · ED BOARDING ${Math.round(Math.max(0, r - 0.4) * 60)}`, 18);
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const v = rnd();
        const filled = v < occ + 0.03 * Math.sin(t + x);
        g.fillStyle = filled ? (v < occ - 0.35 ? '#3a4552' : RISK_HEX[stateOf(r).key] + 'cc') : '#1b1f24';
        g.fillRect(14 + x * cw + 1, 28 + y * ch + 1, cw - 3, ch - 3);
      }
    }

    function ems(t) {
      const r = st.risk;
      scadaBg();
      labelR('UNIT STATUS', 18);
      const units = 12, committed = Math.round(units * clamp(0.25 + r * 0.8, 0, 1));
      for (let u = 0; u < units; u++) {
        const x = 14 + (u % 6) * ((W - 28) / 6), y = 30 + Math.floor(u / 6) * 40;
        const busy = u < committed;
        g.fillStyle = busy ? (u < committed - 3 ? '#e5484d' : '#ee8a2a') : '#3fb27f';
        g.globalAlpha = busy && Math.sin(t * 4 + u) > 0.6 ? 0.6 : 1;
        g.fillRect(x, y, (W - 28) / 6 - 6, 30); g.globalAlpha = 1;
        g.fillStyle = '#0b0d10'; g.font = '600 10px ' + mono(); g.fillText('M' + (11 + u), x + 5, y + 19);
      }
      label(`AVG RESPONSE ${(6.5 + r * 11).toFixed(1)} MIN`, 14, H - 12);
    }

    function weather(t) {
      const r = st.risk;
      g.fillStyle = '#05080a'; g.fillRect(0, 0, W, H);
      const cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.46;
      g.strokeStyle = 'rgba(80,200,140,0.18)'; g.lineWidth = 1;
      for (let k = 1; k <= 4; k++) { g.beginPath(); g.arc(cx, cy, (R * k) / 4, 0, Math.PI * 2); g.stroke(); }
      g.beginPath(); g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R); g.stroke();
      const rnd = mulberry32(3);
      for (let k = 0; k < 60 * r + 4; k++) {
        const a = rnd() * Math.PI * 2, d = rnd() * R * 0.95, s = 3 + rnd() * 10 * r;
        const v = rnd();
        g.fillStyle = v > 0.8 ? 'rgba(230,90,60,0.55)' : v > 0.5 ? 'rgba(220,190,70,0.45)' : 'rgba(70,180,120,0.4)';
        g.beginPath(); g.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, s, 0, Math.PI * 2); g.fill();
      }
      const a = t * 1.6;
      const sw = g.createConicGradient ? g.createConicGradient(a - 0.6, cx, cy) : null;
      if (sw) { sw.addColorStop(0, 'rgba(80,220,150,0)'); sw.addColorStop(0.09, 'rgba(80,220,150,0.28)'); sw.addColorStop(0.1, 'rgba(80,220,150,0)'); g.fillStyle = sw; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill(); }
      g.strokeStyle = 'rgba(120,240,170,0.8)'; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); g.stroke();
      label(`${(st.rain || 0).toFixed(1)} mm/h`, 10, H - 10);
    }

    function rain(t) {
      const rr = clamp((st.rain || 0) / 25, 0, 1);
      if (rr < 0.02) return;
      g.strokeStyle = `rgba(200,215,230,${0.15 + rr * 0.3})`; g.lineWidth = 1;
      g.beginPath();
      const n = Math.floor(drops.length * rr);
      for (let k = 0; k < n; k++) {
        const d = drops[k];
        const y = ((d.y + t * 1.6 * d.s) % 1) * H, x = ((d.x + t * 0.15) % 1) * W;
        g.moveTo(x, y); g.lineTo(x - 2, y + 9 * d.s);
      }
      g.stroke();
    }
    function scadaBg() {
      g.fillStyle = '#0b0e11'; g.fillRect(0, 0, W, H);
      g.strokeStyle = 'rgba(255,255,255,0.035)';
      for (let x = 0; x < W; x += 16) { g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, H); g.stroke(); }
      for (let y = 0; y < H; y += 16) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(W, y + 0.5); g.stroke(); }
    }
    function trace(t, r, x, y, w, h) {
      g.strokeStyle = RISK_HEX[stateOf(r).key]; g.lineWidth = 1.2; g.beginPath();
      for (let k = 0; k <= 60; k++) { const v = clamp(r + 0.08 * Math.sin(k * 0.4 + t * 2) + 0.04 * Math.sin(k * 1.3 - t * 3), 0, 1); const px = x + (k / 60) * w, py = y + h - v * h; k ? g.lineTo(px, py) : g.moveTo(px, py); }
      g.stroke();
    }
    const mono = () => getComputedStyle(document.documentElement).getPropertyValue('--font-mono');
    function label(s, x, y) { g.fillStyle = '#9aa4b0'; g.font = '500 10px ' + mono(); g.fillText(s, x, y); }
    function labelR(s, y) { g.fillStyle = '#9aa4b0'; g.font = '500 10px ' + mono(); g.textAlign = 'right'; g.fillText(s, W - 10, y); g.textAlign = 'left'; }

    return {
      set(state) { st = state; },
      start() { if (!raf) raf = requestAnimationFrame(frame); },
      stop() { cancelAnimationFrame(raf); raf = 0; },
    };
  }

  root.TWIN.feed = { create };
})(typeof window !== 'undefined' ? window : globalThis);
