/* Small planar geometry helpers in a local metric frame (adequate at city scale). */
(function (root) {
  const { haversine } = root.TWIN.core;

  function frame(center) {
    const kx = 111320 * Math.cos((center[1] * Math.PI) / 180), ky = 110540;
    return {
      fwd: (p) => [(p[0] - center[0]) * kx, (p[1] - center[1]) * ky],
      inv: (q) => [q[0] / kx + center[0], q[1] / ky + center[1]],
    };
  }

  // Polygon ring around a polyline, half-width w metres, mitred joins (capped).
  function bufferLine(coords, w, F) {
    const pts = coords.map(F.fwd);
    if (pts.length < 2) return null;
    const left = [], right = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[i], c = pts[Math.min(pts.length - 1, i + 1)];
      let n1x = -(b[1] - a[1]), n1y = b[0] - a[0];
      let n2x = -(c[1] - b[1]), n2y = c[0] - b[0];
      const l1 = Math.hypot(n1x, n1y) || 1, l2 = Math.hypot(n2x, n2y) || 1;
      n1x /= l1; n1y /= l1; n2x /= l2; n2y /= l2;
      if (i === 0) { n1x = n2x; n1y = n2y; }
      if (i === pts.length - 1) { n2x = n1x; n2y = n1y; }
      let mx = n1x + n2x, my = n1y + n2y;
      const ml = Math.hypot(mx, my) || 1;
      mx /= ml; my /= ml;
      const cos = mx * n1x + my * n1y;
      const k = w / Math.max(0.45, cos);
      left.push([b[0] + mx * k, b[1] + my * k]);
      right.push([b[0] - mx * k, b[1] - my * k]);
    }
    const ring = left.concat(right.reverse());
    ring.push(ring[0]);
    return ring.map(F.inv);
  }

  function nearestDist(coords, p) {
    let best = Infinity;
    for (const c of coords) best = Math.min(best, haversine(c, p));
    return best;
  }

  // Gentle arc between two points (quadratic Bezier bowed to the right of travel).
  function arc(a, b, bend, n = 24, F) {
    const A = F.fwd(a), B = F.fwd(b);
    const mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2;
    const dx = B[0] - A[0], dy = B[1] - A[1];
    const L = Math.hypot(dx, dy) || 1;
    const cx = mx + (dy / L) * L * bend, cy = my - (dx / L) * L * bend;
    const out = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      out.push(F.inv([u * u * A[0] + 2 * u * t * cx + t * t * B[0], u * u * A[1] + 2 * u * t * cy + t * t * B[1]]));
    }
    return out;
  }

  // Width expression in metres for line layers drawn on the ground plane.
  function metersExpr(lat, metersExpr_) {
    const K = 156543.03 * Math.cos((lat * Math.PI) / 180);
    return ['interpolate', ['exponential', 2], ['zoom'],
      10, ['*', metersExpr_, Math.pow(2, 10) / K],
      22, ['*', metersExpr_, Math.pow(2, 22) / K]];
  }

  root.TWIN.geom = { frame, bufferLine, nearestDist, arc, metersExpr };
})(typeof window !== 'undefined' ? window : globalThis);
