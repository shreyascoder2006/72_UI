/* The one way pages reach the cascade engine. An engine is built per scenario on first use
   and kept for the scenario in view and the one before it (each holds about 20 MB of
   ensemble state), so switching back is instant and every page reads the same numbers.
   Products built on an engine (analytics, the intervention planner) are attached to it
   once, so no page builds a second copy. */
(function (root) {
  const T = root.TWIN;
  const KEEP = 2;
  const engines = new Map(); // scenario id → engine, most recently used last

  function engine(scenario) {
    if (!T.scenarios[scenario]) throw new Error('Unknown scenario ' + scenario);
    let e = engines.get(scenario);
    if (e) engines.delete(scenario);
    else {
      e = T.engine.create(root.TWIN_GEO, { scenario });
      e.analytics = T.analytics.create(e);
    }
    engines.set(scenario, e);
    while (engines.size > KEEP) engines.delete(engines.keys().next().value);
    return e;
  }
  const planner = (e) => e.planner || (e.planner = T.interventions.create(e));

  T.services = { engine, planner, cached: (scenario) => engines.has(scenario) };
})(typeof window !== 'undefined' ? window : globalThis);
