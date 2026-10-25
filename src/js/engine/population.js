/* Modeled residents (the population grid in the city's data), each cell tied to its
   nearest exposed facility within 1.5 km. One model for every page: the map's
   population massing takes its colour from it, and the crisis registry counts the
   people in a crisis footprint with it, so the twin and the crisis pages agree.
   (Population linkage ported from vizsh/72_hours_CASCADE with permission.) */
(function (root) {
  const { haversine } = root.TWIN.core;
  const REACH = 1500; // m: a cell further than this from every facility is not linked
  const DECAY = 900;  // m: how fast a facility's influence on a cell falls off

  function create(geo) {
    const F = geo.facilities;
    const cells = (geo.population && geo.population.cells) || [];
    const exposed = F.map((f, i) => (f.type !== 'weather' ? i : -1)).filter((i) => i >= 0);
    // link[q] = { i: nearest exposed facility (-1: none in reach), d: metres }
    const link = cells.map(([lng, lat]) => {
      let best = -1, bd = Infinity;
      for (const i of exposed) { const d = haversine([lng, lat], F[i].lngLat); if (d < bd) { bd = d; best = i; } }
      return bd <= REACH ? { i: best, d: bd } : { i: -1, d: Infinity };
    });
    const total = cells.reduce((s, c) => s + c[2], 0);

    // Residents whose nearest exposed facility is in the set (a crisis footprint).
    function peopleFor(set) {
      let n = 0;
      cells.forEach((c, q) => { if (link[q].i >= 0 && set.has(link[q].i)) n += c[2]; });
      return n;
    }
    // Residents living where the linked facility is at HIGH RISK or CRITICAL.
    function atRisk(R) {
      let high = 0, crit = 0;
      cells.forEach((c, q) => {
        const l = link[q];
        if (l.i < 0) return;
        const w = Math.exp(-l.d / DECAY);
        const e = R[l.i] * w + (1 - w) * 0.2;
        if (e >= 0.75) crit += c[2]; else if (e >= 0.55) high += c[2];
      });
      return { high, crit, total };
    }

    return { modeled: cells.length > 0, cells, cell: (geo.population && geo.population.cell) || 450, link, total, DECAY, peopleFor, atRisk };
  }

  root.TWIN.population = { create };
})(typeof window !== 'undefined' ? window : globalThis);
