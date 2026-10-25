/* The site's primary navigation: one permanent column on the left, present on every
   page including the 3D twin, so the whole product is reachable from anywhere.

   FEATURES below is the single source of truth for what the site is: the order an
   operator works through, grouped Operations → Assurance → Public. A feature is listed
   here before it exists, with the phase that builds it, but only `live` ones are drawn,
   so the sidebar never advertises a page you cannot open.

   Each row carries a live chip computed from the engine at the issue time (the crisis
   count, the city's state), never a stored number, so scrubbing the clock moves the
   sidebar with the rest of the site. Chips come from cached engine products, so
   re-rendering costs nothing after the first call. */
(function (root) {
  const T = root.TWIN;
  const C = T.core;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const COLLAPSE_KEY = 'twin.nav.collapsed';

  // chip(L) runs with a loaded page context { e, an, k, … } or null before one exists.
  const FEATURES = [
    {
      path: '/', icon: 'situation', label: 'Situation', group: 'Operations', live: true,
      desc: 'What is happening now, in computed sentences',
      chip: (L) => { const st = C.stateOf(L.e.cityAt(L.k).risk); return { text: st.label, tone: st.key }; },
    },
    {
      path: '/crises', icon: 'crises', label: 'Crises', group: 'Operations', live: true,
      desc: 'The crisis registry, couplings and contention',
      match: (p) => p === '/crises' || p.startsWith('/crises/'),
      chip: (L) => { const n = L.an.crises(L.k).list.length; return n ? { text: String(n) } : null; },
    },
    {
      path: '/twin', icon: 'twin', label: 'City twin', group: 'Operations', live: true,
      desc: 'The 3D operations room',
      chip: (L) => (T.store.ctx.a ? { text: T.store.ctx.a } : null),
    },
    { path: '/graph', icon: 'dependencies', label: 'Dependencies', group: 'Operations', phase: 6, desc: 'The learned dependency graph' },
    {
      path: '/plan', icon: 'response', label: 'Response', group: 'Operations', live: true,
      desc: 'What to do with the crews available, and by when',
      chip: (L) => {
        const r = T.services.recommendedNow(L.e, L.k);
        return r && r.result ? { text: '−' + Math.round(r.result.reduction * 100) + '%' } : null;
      },
    },
    {
      path: '/warnings', icon: 'warnings', label: 'Warnings', group: 'Operations', live: true,
      desc: 'Situation reports, CAP alerts and public SMS',
      chip: (L) => { const n = L.an.crises(L.k).list.length; return n ? { text: String(n) } : null; },
    },
    { path: '/redteam', icon: 'redteam', label: 'Red team', group: 'Assurance', phase: 5, desc: 'Attack the twin’s own inputs' },
    { path: '/method', icon: 'method', label: 'Method', group: 'Assurance', phase: 9, desc: 'How the forecast is made, and how it is scored' },
    { path: '/area', icon: 'area', label: 'My area', group: 'Public', phase: 7, desc: 'The same forecast, in plain language' },
  ];
  const shown = () => FEATURES.filter((f) => f.live);
  const GROUPS = ['Operations', 'Assurance', 'Public'];

  let active = '/', lastL = null, built = false;

  const isOn = (f, path) => (f.match ? f.match(path) : f.path === path);

  function collapsed() {
    try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch (e) { return false; }
  }
  function setCollapsed(on) {
    document.body.classList.toggle('nav-tight', on);
    const b = $('navCollapse');
    if (b) { b.setAttribute('aria-pressed', String(on)); b.title = on ? 'Expand the sidebar' : 'Collapse the sidebar'; }
    try { localStorage.setItem(COLLAPSE_KEY, on ? '1' : '0'); } catch (e) { /* private window: not worth failing over */ }
    // The views either side are sized from --nav-w, so they re-measure as if resized.
    window.dispatchEvent(new Event('resize'));
  }

  function build() {
    const el = $('nav');
    if (!el) return;
    const groups = GROUPS.map((g) => {
      const items = shown().filter((f) => f.group === g);
      if (!items.length) return '';
      return `<div class="nav-group" role="group" aria-label="${g}">
        <div class="nav-group-title">${g}</div>
        ${items.map(itemHTML).join('')}
      </div>`;
    }).join('');
    el.innerHTML = `
      <a class="nav-brand" data-nav="/" href="#/" aria-label="Cascade Intelligence">
        <svg class="brand-mark" viewBox="0 0 26 26" aria-hidden="true"><path d="M13 1.5 23 7.25v11.5L13 24.5 3 18.75V7.25z" fill="none" stroke="#79a7e3" stroke-width="1.4"/><path d="M8 17V11.5l3-1.7V17M12.6 17V8.6l3-1.7V17M17.2 17v-5.2l2.2-1.2" fill="none" stroke="#e4e8ee" stroke-width="1.4" stroke-linejoin="round"/></svg>
        <span class="nav-brand-text"><b>Cascade</b><span>Intelligence</span></span>
      </a>
      <nav class="nav-items" id="navItems" aria-label="Features">${groups}</nav>
      <div class="nav-foot">
        <button class="nav-collapse" id="navCollapse" aria-pressed="false" aria-label="Collapse the sidebar">${T.icons.UI.chevron}</button>
      </div>`;
    $('navCollapse').addEventListener('click', () => setCollapsed(!document.body.classList.contains('nav-tight')));
    // On a phone the sidebar is an overlay; any navigation, the scrim or Escape close it.
    el.addEventListener('click', (ev) => { if (ev.target.closest('a')) close(); });
    const scrim = $('navScrim');
    if (scrim) scrim.addEventListener('click', close);
    window.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && document.body.classList.contains('nav-open')) close(); });
    setCollapsed(collapsed());
    built = true;
  }

  function itemHTML(f) {
    const on = isOn(f, active);
    return `<a class="nav-item" data-nav="${f.path}" data-path="${f.path}" href="#${f.path}"${on ? ' aria-current="page"' : ''} title="${esc(f.label + ' · ' + f.desc)}">
      <span class="nav-ico" aria-hidden="true">${T.icons.NAV[f.icon]}</span>
      <span class="nav-label">${esc(f.label)}</span>
      <span class="nav-chip" data-chip="${f.path}"></span>
    </a>`;
  }

  // Mark the current feature and refresh every chip. L is the page's loaded context, or
  // null while one is being built; chips simply stay empty until it arrives.
  function render(path, L) {
    if (!built) build();
    if (path) active = path;
    if (L !== undefined) lastL = L;
    const el = $('navItems');
    if (!el) return;
    for (const f of shown()) {
      const a = el.querySelector(`.nav-item[data-path="${f.path}"]`);
      if (!a) continue;
      if (isOn(f, active)) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
      const slot = a.querySelector('.nav-chip');
      let chip = null;
      if (f.chip && lastL) { try { chip = f.chip(lastL); } catch (e) { chip = null; } }
      slot.className = 'nav-chip' + (chip && chip.tone ? ' r-' + chip.tone : '');
      slot.textContent = chip ? chip.text : '';
    }
  }

  const open = () => document.body.classList.add('nav-open');
  const close = () => document.body.classList.remove('nav-open');
  const toggle = () => document.body.classList.toggle('nav-open');

  T.nav = { FEATURES, render, build, toggle, open, close, setCollapsed, planned: () => FEATURES.filter((f) => !f.live) };
})(typeof window !== 'undefined' ? window : globalThis);
