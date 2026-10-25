/* Shared context for every page, mirrored in the URL hash so any view can be linked to,
   bookmarked and restored with back/forward:

     #/<path>?city=<city>&s=<scenario>&t=<hours>&m=replay&a=<facility id>&c=<crisis id>

   city  city id (raleigh, nagpur)   s  scenario id
   t     view time in hours from T+0 (absent: follow the simulated now)
   m     'replay' for replay         a  selected facility id
   c     crisis shown on the twin's map (its footprint, with the others')

   Views write the context with set(); changes that arrive from the address bar or from
   back/forward are announced to subscribers with on(). set() never echoes to subscribers. */
(function (root) {
  const KEYS = ['city', 's', 't', 'm', 'a', 'c', 'area'];
  let path = '/';
  let ctx = { city: null, s: null, t: null, m: null, a: null, c: null, area: null };
  const subs = [];

  function clean(c) {
    const t = c.t == null || c.t === '' ? null : Number(c.t);
    return {
      city: c.city ? String(c.city).toLowerCase() : null,
      s: c.s || null,
      t: t != null && Number.isFinite(t) ? Math.min(72, Math.max(0, Math.round(t * 2) / 2)) : null,
      m: c.m === 'replay' ? 'replay' : null,
      a: c.a || null,
      c: c.c ? String(c.c).toUpperCase() : null,
      area: c.area ? String(c.area) : null,
    };
  }
  function parse(hash) {
    const h = (hash || '').replace(/^#/, '');
    const q = h.indexOf('?');
    const p = (q < 0 ? h : h.slice(0, q)) || '/';
    const params = new URLSearchParams(q < 0 ? '' : h.slice(q + 1));
    const c = {};
    for (const k of KEYS) c[k] = params.get(k);
    return { path: p.startsWith('/') ? p : '/' + p, ctx: clean(c) };
  }
  function serialize(p, c) {
    const q = new URLSearchParams();
    if (c.city) q.set('city', c.city);
    if (c.s) q.set('s', c.s);
    if (c.t != null) q.set('t', String(c.t));
    if (c.m) q.set('m', c.m);
    if (c.a) q.set('a', c.a);
    if (c.c) q.set('c', c.c);
    const qs = q.toString();
    return '#' + p + (qs ? '?' + qs : '');
  }
  function write(push) {
    const h = serialize(path, ctx);
    if (h === location.hash) return;
    try { history[push ? 'pushState' : 'replaceState'](null, '', h); }
    catch (e) { if (push) location.hash = h; else location.replace(h); } // sandboxed frames may refuse history writes
  }

  // Read the address bar; tell subscribers what changed (path and/or context keys).
  function sync() {
    const next = parse(location.hash);
    const changed = KEYS.filter((k) => next.ctx[k] !== ctx[k]);
    const moved = next.path !== path;
    if (!changed.length && !moved) return;
    path = next.path; ctx = next.ctx;
    for (const fn of subs) fn({ path, ctx: { ...ctx }, changed, moved });
  }

  root.TWIN.store = {
    get path() { return path; },
    get ctx() { return { ...ctx }; },
    // Update the context from a view (push: a new history entry, e.g. a selection;
    // notify: tell subscribers too, for a control that changes what the page shows).
    set(patch, opts = {}) {
      const next = clean({ ...ctx, ...patch });
      const changed = KEYS.filter((k) => next[k] !== ctx[k]);
      ctx = next;
      write(!!opts.push);
      if (opts.notify && changed.length) for (const fn of subs) fn({ path, ctx: { ...ctx }, changed, moved: false });
    },
    // Change page, keeping the context (with an optional patch).
    go(p, opts = {}) {
      path = p;
      if (opts.patch) ctx = clean({ ...ctx, ...opts.patch });
      write(!opts.replace);
      for (const fn of subs) fn({ path, ctx: { ...ctx }, changed: [], moved: true });
    },
    on(fn) { subs.push(fn); },
    // Initial read; afterwards the address bar is watched.
    start() {
      const first = parse(location.hash);
      path = first.path; ctx = first.ctx;
      window.addEventListener('hashchange', sync);
      window.addEventListener('popstate', sync);
      return { path, ctx: { ...ctx } };
    },
    parse, serialize,
  };
})(typeof window !== 'undefined' ? window : globalThis);
