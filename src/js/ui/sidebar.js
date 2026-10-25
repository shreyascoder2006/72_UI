/* Left sidebar: asset list grouped by layer, GIS layer switches, alert feed. */
(function (root) {
  const { stateOf, TYPES } = root.TWIN.core;
  const I = root.TWIN.icons.UI;
  const ORDER = ['drainage', 'traffic', 'power', 'hospital', 'weather'];
  const LAYERS = [
    { key: 'drainage', label: 'Drainage', sw: '#3f93d8' },
    { key: 'traffic', label: 'Traffic', sw: '#3fb27f' },
    { key: 'power', label: 'Power grid', sw: '#b39af0' },
    { key: 'hospital', label: 'Hospitals & EMS', sw: '#e5484d' },
    { key: 'weather', label: 'Weather radar', sw: '#c9be55' },
    { key: 'flows', label: 'Cascade flows', sw: '#f2575c' },
    { key: 'arcs', label: 'Dependency arcs', sw: '#79a7e3' },
    { key: 'buildings', label: '3D buildings', sw: '#4b525c' },
  ];
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function create(app) {
    const F = app.geo.facilities;
    const $assets = document.getElementById('assets');
    const $alerts = document.getElementById('alerts');
    const $layers = document.getElementById('layers');
    document.getElementById('searchIco').innerHTML = I.search;
    document.getElementById('assetCount').textContent = F.length;

    // Layers
    $layers.innerHTML = LAYERS.map((l) => `
      <label class="sw"><input type="checkbox" id="ly-${l.key}" data-key="${l.key}" ${app.state.layers[l.key] ? 'checked' : ''}>
      <span class="sw-track"></span><span class="sw-swatch" style="background:${l.sw}"></span><span>${l.label}</span></label>`).join('');
    $layers.addEventListener('change', (e) => { const k = e.target.dataset.key; if (k) app.setLayer(k, e.target.checked); });
    document.getElementById('layersAll').addEventListener('click', () => {
      for (const l of LAYERS) if (l.key !== 'arcs') { app.setLayer(l.key, true); document.getElementById('ly-' + l.key).checked = true; }
    });

    // Asset list
    const collapsed = new Set();
    const rows = [];
    function buildList() {
      $assets.innerHTML = '';
      for (const type of ORDER) {
        const idx = F.map((f, i) => (f.type === type ? i : -1)).filter((i) => i >= 0)
          .sort((a, b) => F[a].tier - F[b].tier || F[a].name.localeCompare(F[b].name));
        const head = document.createElement('button');
        head.className = 'grp-head';
        head.setAttribute('aria-expanded', 'true');
        head.innerHTML = `${I.chevron}<span>${TYPES[type].label}</span><span class="grp-alert" data-crit></span><span class="grp-n">${idx.length}</span>`;
        head.addEventListener('click', () => {
          const open = head.getAttribute('aria-expanded') === 'true';
          head.setAttribute('aria-expanded', String(!open));
          open ? collapsed.add(type) : collapsed.delete(type);
          filter();
        });
        $assets.appendChild(head);
        head._type = type;
        for (const i of idx) {
          const f = F[i];
          const b = document.createElement('button');
          b.className = 'row r-normal';
          b.dataset.i = i;
          b.innerHTML = `<span class="row-name">${esc(f.name)}</span>
            <span class="row-sub">${esc(f.district)} · <span class="mono">${esc(f.sensor)}</span></span>
            <span class="row-risk"><span class="val">—</span><span class="dot"></span></span>`;
          b.addEventListener('click', () => app.select(i, { fly: true }));
          $assets.appendChild(b);
          rows[i] = { el: b, val: b.querySelector('.val'), state: 'normal', type, text: `${f.name} ${f.district} ${f.id} ${f.sensor} ${f.subtype}`.toLowerCase(), head };
        }
      }
    }
    buildList();
    const $search = document.getElementById('search');
    function filter() {
      const q = $search.value.trim().toLowerCase();
      for (const r of rows) r.el.hidden = (q ? !r.text.includes(q) : collapsed.has(r.type));
    }
    $search.addEventListener('input', filter);

    function updateList(R, trust, selected) {
      const crit = {};
      let nCrit = 0;
      rows.forEach((r, i) => {
        const st = stateOf(R[i]).key;
        if (st !== r.state) { r.el.classList.replace('r-' + r.state, 'r-' + st); r.state = st; }
        r.val.textContent = Math.round(R[i] * 100) + '%';
        r.el.setAttribute('aria-current', String(i === selected));
        const flt = trust[i] < 0.5;
        if (flt !== !!r.fault) {
          r.fault = flt;
          const name = r.el.querySelector('.row-name');
          name.innerHTML = esc(F[i].name) + (flt ? '<span class="fault">SENSOR</span>' : '');
        }
        if (st === 'critical' && F[i].type !== 'weather') { crit[r.type] = (crit[r.type] || 0) + 1; nCrit++; }
      });
      for (const h of $assets.querySelectorAll('.grp-head')) h.querySelector('[data-crit]').textContent = crit[h._type] ? `${crit[h._type]} CRIT` : '';
      document.getElementById('assetCrit').textContent = nCrit ? `${nCrit} critical` : 'all nominal';
    }
    function scrollTo(i) {
      const r = rows[i];
      if (!r || r.el.hidden) return;
      // Scroll only the list (not its ancestors), clear of the sticky group header.
      const c = $assets.getBoundingClientRect(), b = r.el.getBoundingClientRect();
      if (b.top < c.top + 32) $assets.scrollTop += b.top - c.top - 32;
      else if (b.bottom > c.bottom) $assets.scrollTop += b.bottom - c.bottom + 8;
    }

    // Alerts
    let lastKey = '';
    function updateAlerts(list, tRef) {
      const key = list.length + ':' + Math.round(tRef * 2);
      if (key === lastKey) return;
      lastKey = key;
      const recent = list.filter((a) => tRef - a.t <= 6).length;
      document.getElementById('alertCount').textContent = recent;
      if (!list.length) { $alerts.innerHTML = '<div class="empty">No alerts. All monitored systems are within normal bands.</div>'; return; }
      $alerts.innerHTML = list.slice(-40).reverse().map((a, n) => {
        const f = F[a.i];
        const ago = tRef - a.t;
        const when = ago < 0.25 ? 'NOW' : ago < 1 ? Math.round(ago * 60) + 'M<br>AGO' : (ago < 10 ? ago.toFixed(1) : Math.round(ago)) + 'H<br>AGO';
        let cls = 'sev-' + a.sev, icon = I.alert, title = esc(a.title), text = esc(a.text);
        if (a.kind === 'state') icon = a.sev === 'critical' ? I.siren : I.alert;
        if (a.kind === 'forecast') icon = I.forecast;
        if (a.kind === 'sensor') icon = I.sensor;
        if (a.kind === 'report') {
          icon = I.report;
          const ok = a.conf >= 0.5;
          if (!ok) cls += ' unverified';
          title = `Citizen report<span class="badge ${ok ? 'ok' : 'bad'}">${ok ? 'Corroborated' : 'Unverified'} ${Math.round(a.conf * 100)}%</span>`;
          text = esc(a.text) + (ok ? '' : a.tr < 0.5
            ? `. Local gauge ${esc(f.sensor)} is unreliable; holding for corroboration.`
            : `. Contradicted by ${esc(f.sensor)} and neighbouring sensors.`);
        }
        if (a.kind === 'state') { title = esc(f.name); }
        return `<button class="alert ${cls}" data-n="${list.length - 1 - n}" data-i="${a.i}">
          <span class="alert-ico">${icon}</span>
          <span class="alert-title">${title}</span>
          <span class="alert-time">${when}</span>
          <span class="alert-text">${text}</span>
          <span class="alert-loc">${esc(f.district)} · ${esc(f.id)} · ${root.TWIN.core.fmtT(a.t)}</span>
        </button>`;
      }).join('');
    }
    $alerts.addEventListener('click', (e) => {
      const b = e.target.closest('.alert');
      if (b) app.focusAlert(+b.dataset.i);
    });

    return { updateList, updateAlerts, scrollTo, LAYERS };
  }

  root.TWIN.sidebar = { create };
})(typeof window !== 'undefined' ? window : globalThis);
