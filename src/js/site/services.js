/* The one way pages reach the cascade engine. An engine is built per city and scenario
   on first use and kept for the one in view and the one before it (each holds about
   20 MB of ensemble state), so switching back is instant and every page reads the same
   numbers. Products built on an engine (analytics, the intervention planner, the
   recommended plan) are attached to it once, so no page builds a second copy. */
(function (root) {
  const T = root.TWIN;
  const KEEP = 2;
  const engines = new Map(); // "city|scenario" → engine, most recently used last
  const pops = new Map();    // city → population model

  const geoOf = (city) => {
    const g = root.TWIN_GEOS && root.TWIN_GEOS[city];
    if (!g) throw new Error('Unknown city ' + city);
    return g;
  };
  // Scenarios a city can run: the ones written for it first, then the generic ones.
  // City-specific scenarios lead, and the first is the city's default. `order` keeps a
  // later-added set (the natural-calamity catalogue) below the originals, so growing the
  // catalogue never moves the scenario a city opens on.
  const scenariosFor = (city) => Object.values(T.scenarios)
    .filter((s) => !s.cities || s.cities.includes(city))
    .sort((a, b) => (a.order || 0) - (b.order || 0) || Number(!!b.cities) - Number(!!a.cities));
  const runs = (city, scenario) => scenariosFor(city).some((s) => s.id === scenario);

  function population(city) {
    if (!pops.has(city)) pops.set(city, T.population.create(geoOf(city)));
    return pops.get(city);
  }

  function engine(city, scenario) {
    const geo = geoOf(city);
    if (!runs(city, scenario)) throw new Error(`Scenario ${scenario} is not available for ${geo.city}`);
    const key = city + '|' + scenario;
    let e = engines.get(key);
    if (e) engines.delete(key);
    else {
      e = T.engine.create(geo, { scenario });
      const pop = population(city);
      e.analytics = T.analytics.create(e, pop.modeled ? { peopleFor: pop.peopleFor } : {});
    }
    engines.set(key, e);
    while (engines.size > KEEP) engines.delete(engines.keys().next().value);
    return e;
  }
  const planner = (e) => e.planner || (e.planner = T.interventions.create(e));
  // The pretrained forecaster's second opinion (second.js); null where it has no run.
  const second = (e) => (e.second !== undefined ? e.second : (e.second = T.second.create(e)));

  // The planner's recommendation within a crew budget at decision step k, with its
  // expected outcome. The search takes seconds, so it runs spread over frames and is
  // kept on the engine: a page that asks again gets the same promise.
  function recommended(e, k, budget = 5) {
    const cache = e.recommended || (e.recommended = new Map());
    const key = k + '|' + budget;
    if (!cache.has(key)) {
      const p = planner(e);
      cache.set(key, p.recommendAsync(k, budget).then((ids) => {
        const out = { k, budget, ids, result: ids.length ? p.evaluate(k, ids) : null };
        // A resolved copy, so a caller that cannot wait (the sidebar chip) can read it.
        (e.recDone || (e.recDone = new Map())).set(key, out);
        return out;
      }));
    }
    return cache.get(key);
  }

  const recommendedNow = (e, k, budget = 5) => (e.recDone && e.recDone.get(k + '|' + budget)) || null;

  T.services = {
    engine, planner, second, recommended, recommendedNow, population, scenariosFor, runs,
    cities: () => Object.values(root.TWIN_GEOS || {}),
    geo: geoOf,
    cached: (city, scenario) => engines.has(city + '|' + scenario),
  };
})(typeof window !== 'undefined' ? window : globalThis);
