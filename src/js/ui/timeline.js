/* 72 h predictive timeline: city risk track (observed vs forecast), NOW marker,
   critical-crossing ticks, scrubbing and playback controls. */
(function (root) {
  const C = root.TWIN.core;
  const I = root.TWIN.icons.UI;

  function create(app) {
    const H = app.engine.HOURS;
    const track = document.getElementById('tlTrack');
    const canvas = document.getElementById('tlCanvas');
    const thumb = document.getElementById('tlThumb');
    const thumbT = document.getElementById('tlThumbT');
    const nowEl = document.getElementById('tlNow');
    const axis = document.getElementById('tlAxis');
    const play = document.getElementById('play');
    const speedBtn = document.getElementById('speed');

    // Axis: day names at local midnight, hours every 6 h.
    const parts = [];
    for (let t = 0; t <= H; t += 6) {
      const ck = C.clockAt(app.geo.t0, t);
      const midnight = Math.abs(ck.hour) < 0.01;
      const pos = (t / H) * 100;
      const align = t === 0 ? 'transform:none' : t === H ? 'transform:translateX(-100%)' : '';
      const cls = midnight ? 'day' : Math.round(ck.hour) % 12 === 0 ? 'h12' : 'h6';
      parts.push(`<span class="${cls}" style="left:${pos}%;${align}">${midnight ? ck.day.split(' ')[0] : ck.time}</span>`);
    }
    axis.innerHTML = parts.join('');

    const tFromX = (x) => C.clamp(((x - track.getBoundingClientRect().left) / track.clientWidth) * H, 0, H);
    let dragging = false;
    track.addEventListener('pointerdown', (e) => { dragging = true; track.setPointerCapture(e.pointerId); app.scrub(tFromX(e.clientX)); });
    track.addEventListener('pointermove', (e) => { if (dragging) app.scrub(tFromX(e.clientX)); });
    track.addEventListener('pointerup', () => { dragging = false; app.scrubEnd(); });
    track.setAttribute('tabindex', '0');
    track.setAttribute('role', 'slider');
    track.setAttribute('aria-label', 'Simulation time');
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', String(H));
    track.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 6 : 0.5;
      if (e.key === 'ArrowRight') { app.scrub(Math.min(H, app.state.t + step)); app.scrubEnd(); e.preventDefault(); }
      if (e.key === 'ArrowLeft') { app.scrub(Math.max(0, app.state.t - step)); app.scrubEnd(); e.preventDefault(); }
    });

    play.addEventListener('click', () => app.togglePlay());
    const SPEEDS = [1, 2, 4, 8];
    speedBtn.addEventListener('click', () => {
      const n = SPEEDS[(SPEEDS.indexOf(app.state.speed) + 1) % SPEEDS.length];
      app.state.speed = n;
      speedBtn.textContent = n + '×';
    });
    speedBtn.textContent = app.state.speed + '×';

    let cache = { key: '' };
    function drawTrack(v) {
      const key = `${v.mode}:${v.kNow}:${app.state.scenario}:${track.clientWidth}`;
      if (key === cache.key) return;
      cache.key = key;
      const e = app.engine;
      const city = [];
      for (let k = 0; k < e.K; k += 1) {
        let r;
        if (k <= v.kNow) r = e.cityAt(k).risk;
        else {
          // City index from the forecast issued at NOW.
          const R = e.project(v.kNow, k);
          let mx = 0, sum = 0, n = 0, nc = 0;
          for (let i = 0; i < e.N; i++) { if (e.kinds[i] === 'weather') continue; const w = 4 - e.F[i].tier; mx = Math.max(mx, R[i]); sum += R[i] * w; n += w; if (R[i] >= 0.75) nc++; }
          r = C.clamp(0.5 * (sum / n) + 0.5 * mx - (nc < 2 ? 0.08 : 0) + 0.04 * Math.max(0, nc - 2), 0, 1);
        }
        city.push({ t: k * e.DT, v: r });
      }
      const events = e.cascade(v.kNow).filter((c) => c.level === 'CRITICAL');
      root.TWIN.charts.track(canvas, { hours: H, city, tNow: v.tNow, events });
    }

    function update(v) {
      drawTrack(v);
      thumb.style.left = (v.t / H) * 100 + '%';
      thumbT.textContent = C.fmtT(v.t);
      nowEl.style.left = (v.tNow / H) * 100 + '%';
      nowEl.hidden = v.mode === 'historical';
      track.setAttribute('aria-valuenow', String(v.t));
      play.innerHTML = app.state.playing ? I.pause : I.play;
      play.setAttribute('aria-label', app.state.playing ? 'Pause' : 'Play');
      const s = C.clockAt(app.geo.t0, 0), e2 = C.clockAt(app.geo.t0, H);
      document.getElementById('tlRange').textContent = `${s.day} 00:00 → ${e2.day} 00:00 EDT`;
    }
    return { update, invalidate: () => (cache.key = '') };
  }

  root.TWIN.timeline = { create };
})(typeof window !== 'undefined' ? window : globalThis);
