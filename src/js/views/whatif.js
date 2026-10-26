/* What-if at #/whatif: pick a place, an event and its size; the page builds the chain
   of effects it could set off, as a knowledge graph drawn step by step, with the real
   facilities near the place attached to each effect (engine/whatif.js).

   Independent of the 3D twin and of the 72-hour engine: this is template reasoning over
   a fixed knowledge base, scaled by severity, and the page says so. Where the engine has
   a full scenario of the same kind for the city, it links to it. */
(function (root) {
  const T = root.TWIN;
  const C = T.core, S = T.site, W = T.whatif;
  const { esc } = S;
  const $ = (id) => document.getElementById(id);
  const pct = (p) => Math.round(p * 100) + '%';
  const ENGINE_SCEN = { rain: ['monsoon2023', 'flash', 'tropical'], heat: ['heat'], chemical: ['chlorine'], grid: ['blackout'], crowd: ['festival'] };

  let token = 0, geo = null, places = [], state = null, result = null, selected = null;

  // Places to start from: monitored districts, OpenStreetMap neighbourhoods, facilities.
  function placesOf(g) {
    const out = new Map(), F = g.facilities.filter((f) => f.type !== 'weather');
    out.set('centre', { key: 'centre', name: `${g.city} centre`, kind: 'city centre', lngLat: g.center });
    for (const d of [...new Set(F.map((f) => f.district))]) {
      const own = F.filter((f) => f.district === d);
      out.set('d:' + d.toLowerCase(), { key: 'd:' + d, name: d, kind: 'area', lngLat: [own.reduce((s, f) => s + f.lngLat[0], 0) / own.length, own.reduce((s, f) => s + f.lngLat[1], 0) / own.length] });
    }
    const osm = (root.TWIN_PLACES && root.TWIN_PLACES[g.id]) || { places: [] };
    for (const [name, cls, lng, lat] of osm.places) if (!out.has('d:' + name.toLowerCase())) out.set('p:' + name.toLowerCase(), { key: 'p:' + name, name, kind: cls, lngLat: [lng, lat] });
    for (const f of F) out.set('f:' + f.id, { key: 'f:' + f.id, name: f.name, kind: f.subtype || f.type, lngLat: f.lngLat, fac: f });
    return [...out.values()];
  }
  const findPlace = (names) => { for (const n of names) { const p = places.find((x) => x.name.toLowerCase() === n.toLowerCase() || x.name.toLowerCase().startsWith(n.toLowerCase())); if (p) return p; } return places[0]; };
  // Fixed starting points: one per kind of event, at places that exist in this city.
  function presets() {
    const hosp = places.find((p) => p.fac && p.fac.type === 'hospital' && p.fac.subtype !== 'EMS station' && p.fac.tier === 1) || places.find((p) => p.fac && p.fac.type === 'hospital');
    const N = geo.id === 'nagpur';
    return [
      { cal: 'rain', mag: 115, place: findPlace(N ? ['Dharampeth'] : ['Mordecai', 'Capital Blvd corridor']) },
      { cal: 'quake', mag: 6.2, place: findPlace(N ? ['Sitabuldi'] : ['Downtown']) },
      { cal: 'outbreak', mag: 12, place: hosp || places[0] },
      { cal: 'heat', mag: N ? 47 : 41, place: places[0] },
      { cal: 'chemical', mag: 2, place: findPlace(N ? ['Seminary Hills'] : ['Lake Boone']) },
      { cal: 'grid', mag: 40, place: places[0] },
      { cal: 'crowd', mag: N ? 300000 : 60000, place: findPlace(N ? ['Futala', 'Gandhi Sagar', 'Mahal'] : ['Downtown']) },
    ];
  }
  const presetLabel = (p) => `${fmtMag(p.cal, p.mag)} · ${p.place.name}`;
  function fmtMag(cal, m) {
    return { rain: `${m} mm rain`, quake: `M${(+m).toFixed(1)} earthquake`, outbreak: `${m} outbreak cases`, heat: `${m} °C heat`, chemical: `${m} t gas release`, grid: `${m}% substations lost`, crowd: `${(+m).toLocaleString('en-US')} crowd` }[cal];
  }

  // ── Page ───────────────────────────────────────────────────────────────
  async function render(ctx) {
    const my = ++token;
    S.header('/whatif');
    let L;
    try { L = await S.load(ctx, S.busy); } catch (err) { S.fail(err); return; }
    if (my !== token) return;
    S.settle(L); S.header('/whatif', L);
    if (!geo || geo.id !== L.geo.id) { geo = L.geo; places = placesOf(geo); state = null; result = null; selected = null; }
    if (!state) { const p = presets()[0]; state = { cal: p.cal, mag: p.mag, place: p.place }; }
    $('page').innerHTML = `
      <div class="pg-wrap wi-wrap">
        <header class="pg-head wi-head">
          <h1>What-if simulator</h1>
          <p class="pg-lede">Choose a place in ${esc(geo.city)}, an event and how big it is. The chain of effects it could set off is drawn as a knowledge graph, each effect tied to the real facilities nearest the place.</p>
        </header>
        <section class="bd-card wi-form" aria-label="Scenario">
          <div class="wi-field wi-loc"><label for="wiPlace">Location</label>
            <div class="wi-search"><span aria-hidden="true">${T.icons.UI.search}</span><input id="wiPlace" type="search" autocomplete="off" value="${esc(state.place.name)}" aria-controls="wiMatches"></div>
            <ul class="wi-matches" id="wiMatches" hidden></ul></div>
          <div class="wi-field"><label for="wiCal">Event</label>
            <label class="select"><select id="wiCal">${Object.entries(W.KB).map(([k, v]) => `<option value="${k}"${k === state.cal ? ' selected' : ''}>${esc(v.label)}</option>`).join('')}</select><span>${T.icons.UI.chevron}</span></label></div>
          <div class="wi-field wi-mag"><label for="wiMag">Size <span class="faint" id="wiUnit"></span></label>
            <div class="wi-magrow"><input id="wiMag" type="number"><input id="wiMagR" type="range" aria-label="Size"><span class="wi-band" id="wiBand"></span></div></div>
          <button type="button" class="btn wi-go" id="wiGo">Build the cascade</button>
          <div class="wi-presets" aria-label="Examples"><span>Examples</span>${presets().map((p, n) => `<button type="button" data-preset="${n}">${esc(presetLabel(p))}</button>`).join('')}</div>
        </section>
        <div class="wi-main">
          <section class="bd-card wi-graph-card" aria-labelledby="wiH"><div class="bd-h"><h2 id="wiH">Cascade knowledge graph</h2><span class="bd-sub-r" id="wiSum"></span></div><div id="wiGraph" class="wi-graph"></div><p class="bd-legend" id="wiLegend"></p></section>
          <aside class="bd-card wi-insp" id="wiInsp" aria-live="polite"></aside>
        </div>
        <section class="bd-card wi-pipe-card" aria-labelledby="wiPh"><div class="bd-h"><h2 id="wiPh">Pipeline, in the order effects begin</h2></div><div id="wiPipe"></div></section>
        <p class="wi-note">Template reasoning, not a forecast: the chain comes from a fixed knowledge base of how each kind of event typically cascades through city systems, scaled by the severity you enter, with times and likelihoods as typical values. Sites are the nearest facilities, schools and pharmacies in the city's OpenStreetMap data. <span id="wiEngine"></span></p>
      </div>`;
    wire();
    syncForm();
    build();
  }

  function syncForm() {
    const kb = W.KB[state.cal];
    const mag = $('wiMag'), r = $('wiMagR');
    for (const el of [mag, r]) { el.min = kb.min; el.max = kb.max; el.step = kb.step; }
    mag.value = state.mag; r.value = state.mag;
    $('wiUnit').textContent = `(${kb.unit})`;
    const b = W.bandOf(kb, state.mag);
    $('wiBand').textContent = kb.bandNames[b];
    $('wiBand').className = `wi-band b${b}`;
    $('wiBand').title = kb.scale;
  }
  function wire() {
    const q = $('wiPlace'), list = $('wiMatches');
    const pick = (key) => { state.place = places.find((p) => p.key === key) || state.place; q.value = state.place.name; list.hidden = true; };
    q.addEventListener('focus', () => q.select());
    q.addEventListener('input', () => {
      const s = q.value.trim().toLowerCase();
      if (!s) { list.hidden = true; return; }
      const hits = places.filter((p) => p.name.toLowerCase().startsWith(s)).concat(places.filter((p) => !p.name.toLowerCase().startsWith(s) && p.name.toLowerCase().includes(s))).slice(0, 8);
      list.innerHTML = hits.length ? hits.map((p) => `<li><button type="button" data-key="${esc(p.key)}">${esc(p.name)}<span>${esc(p.kind)}</span></button></li>`).join('') : '<li class="wi-nohit">No place by that name in the city model.</li>';
      list.hidden = false;
    });
    q.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { const b = list.querySelector('[data-key]'); if (b) { pick(b.dataset.key); build(); } } if (ev.key === 'Escape') list.hidden = true; });
    list.addEventListener('click', (ev) => { const b = ev.target.closest('[data-key]'); if (b) pick(b.dataset.key); });
    $('wiCal').addEventListener('change', (ev) => { state.cal = ev.target.value; state.mag = W.KB[state.cal].def; syncForm(); });
    const setMag = (v) => { state.mag = +v; syncForm(); };
    $('wiMag').addEventListener('change', (ev) => setMag(ev.target.value));
    $('wiMagR').addEventListener('input', (ev) => setMag(ev.target.value));
    $('wiGo').addEventListener('click', build);
    document.querySelector('.wi-presets').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-preset]');
      if (!b) return;
      const p = presets()[+b.dataset.preset];
      state = { cal: p.cal, mag: p.mag, place: p.place };
      $('wiCal').value = p.cal; $('wiPlace').value = p.place.name; syncForm(); build();
    });
    const graph = $('wiGraph');
    graph.addEventListener('click', (ev) => { const n = ev.target.closest('[data-node]'); selectNode(n ? n.dataset.node : null); });
    graph.addEventListener('keydown', (ev) => { if (ev.key !== 'Enter' && ev.key !== ' ') return; const n = ev.target.closest('[data-node]'); if (n) { ev.preventDefault(); selectNode(n.dataset.node); } });
    $('wiPipe').addEventListener('click', (ev) => { const r = ev.target.closest('[data-node]'); if (r) selectNode(r.dataset.node); });
  }

  // ── Build and draw ─────────────────────────────────────────────────────
  function build() {
    result = W.generate(geo, state.place, state.cal, state.mag);
    selected = result.nodes[0] ? result.nodes[0].id : null;
    drawGraph(true);
    drawInspector();
    drawPipe();
    const kb = W.KB[state.cal];
    $('wiSum').innerHTML = `${esc(fmtMag(state.cal, result.magnitude))} at ${esc(state.place.name)} · <b>${esc(result.bandName)}</b> · ${result.nodes.length} effects across ${result.systems.length} systems, over about ${C.fmtDur(Math.max(1, result.last))}`;
    $('wiLegend').innerHTML = result.systems.map((s) => `<span class="wi-lk"><i style="background:${W.SYSTEMS[s].col}"></i>${W.SYSTEMS[s].label}</span>`).join('') + `<span class="wi-lk-n">Severity scale: ${esc(kb.scale)}.</span>`;
    const scen = (ENGINE_SCEN[state.cal] || []).find((id) => T.services.runs(geo.id, id));
    $('wiEngine').innerHTML = scen ? `The 72-hour engine has a full simulation of this kind of event for ${esc(geo.city)}: <a href="${esc(S.href('/', { s: scen, t: null, a: null, c: null }))}">${esc(T.scenarios[scen].label)} in Situation →</a>` : 'The 72-hour engine has no simulation of this kind of event; this graph is the only view of it here.';
  }

  // Columns by stage; within a column, by onset. Positions are fixed for a result, so
  // selecting a node never moves the layout.
  let layout = null;
  function drawGraph(animate) {
    const r = result, colW = 184, nodeW = 166, nodeH = 50, gapY = 16, padX = 14, top = 34;
    const cols = W.STAGES.map((_, s) => r.nodes.filter((n) => n.stage === s));
    const rows = Math.max(1, ...cols.map((c) => c.length));
    const H = top + rows * (nodeH + gapY) + 10, Wd = padX * 2 + (W.STAGES.length - 1) * colW + nodeW;
    const pos = new Map();
    cols.forEach((c, s) => {
      const off = (rows - c.length) * (nodeH + gapY) / 2;
      c.forEach((n, j) => pos.set(n.id, { x: padX + s * colW, y: top + off + j * (nodeH + gapY), n }));
    });
    layout = pos;
    const order = new Map(r.nodes.map((n, k) => [n.id, k]));
    const sel = selected, linked = new Set(sel ? r.edges.filter((e) => e.from === sel || e.to === sel).flatMap((e) => [e.from, e.to]) : []);
    let g = W.STAGES.map((s, k) => `<text x="${padX + k * colW + nodeW / 2}" y="16" text-anchor="middle" class="wi-stage">${s}</text>`).join('');
    for (const e of r.edges) {
      const a = pos.get(e.from), b = pos.get(e.to);
      const fwd = b.x > a.x;
      const x1 = fwd ? a.x + nodeW : a.x + nodeW / 2, y1 = fwd ? a.y + nodeH / 2 : a.y + (b.y > a.y ? nodeH : 0);
      const x2 = fwd ? b.x : b.x + nodeW / 2, y2 = fwd ? b.y + nodeH / 2 : b.y + (b.y > a.y ? 0 : nodeH);
      const d = fwd ? `M${x1} ${y1}C${x1 + 40} ${y1} ${x2 - 40} ${y2} ${x2} ${y2}` : `M${x1} ${y1}C${x1 + 70} ${(y1 + y2) / 2} ${x2 + 70} ${(y1 + y2) / 2} ${x2} ${y2}`;
      const on = sel && (e.from === sel || e.to === sel);
      const delay = (Math.max(order.get(e.from), order.get(e.to)) * 110 + 60);
      g += `<path d="${d}" class="wi-edge${on ? ' on' : ''}${sel && !on ? ' dim' : ''}${animate ? ' grow' : ''}" style="animation-delay:${delay}ms" marker-end="url(#wiArr${on ? 'On' : ''})" pathLength="1"><title>${esc(r.nodes.find((n) => n.id === e.from).label)} → ${esc(r.nodes.find((n) => n.id === e.to).label)}: ${esc(e.how)}</title></path>`;
    }
    for (const n of r.nodes) {
      const p = pos.get(n.id), col = W.SYSTEMS[n.sys].col, on = n.id === sel, dim = sel && !on && !linked.has(n.id);
      const words = n.label.split(' '), lines = ['', ''];
      for (const w of words) { const ln = lines[0].length + w.length < 27 || !lines[0] ? 0 : 1; lines[ln] = (lines[ln] ? lines[ln] + ' ' : '') + w; }
      if (lines[1].length > 27) lines[1] = lines[1].slice(0, 26) + '…';
      g += `<g class="wi-node${on ? ' on' : ''}${dim ? ' dim' : ''}${animate ? ' pop' : ''}" style="animation-delay:${order.get(n.id) * 110}ms" transform="translate(${p.x} ${p.y})" data-node="${n.id}" tabindex="0" role="button" aria-label="${esc(n.label)}, ${n.likely}, from T+${n.t} h">
        <rect width="${nodeW}" height="${nodeH}" rx="6" style="--sc:${col}"/><rect width="4" height="${nodeH}" rx="2" fill="${col}"/>
        <text x="12" y="${lines[1] ? 18 : 24}" class="wi-nl">${esc(lines[0])}</text>${lines[1] ? `<text x="12" y="31" class="wi-nl">${esc(lines[1])}</text>` : ''}
        <text x="12" y="${nodeH - 6}" class="wi-nm">T+${n.t} h · ${n.likely}${n.sites.length ? ` · ${n.sites.length} site${n.sites.length > 1 ? 's' : ''}` : ''}</text>
        <title>${esc(n.label)} · ${W.SYSTEMS[n.sys].label} · from about T+${n.t} h · ${n.likely} (${pct(n.p)})</title></g>`;
    }
    $('wiGraph').innerHTML = `<svg viewBox="0 0 ${Wd} ${H}" class="wi-svg" role="group" aria-label="Knowledge graph of cascading effects">
      <defs><marker id="wiArr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L8 4L0 8z" class="wi-mk"/></marker><marker id="wiArrOn" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L8 4L0 8z" class="wi-mk on"/></marker></defs>${g}</svg>`;
  }
  function selectNode(id) { selected = id; drawGraph(false); drawInspector(); drawPipe(); }

  function drawInspector() {
    const r = result, n = r.nodes.find((x) => x.id === selected);
    if (!n) { $('wiInsp').innerHTML = '<p class="ni-empty">Select an effect to see why it happens, when, and where.</p>'; return; }
    const causes = r.edges.filter((e) => e.to === n.id).map((e) => ({ e, n: r.nodes.find((x) => x.id === e.from) }));
    const leads = r.edges.filter((e) => e.from === n.id).map((e) => ({ e, n: r.nodes.find((x) => x.id === e.to) }));
    const dist = (d) => (d < 1000 ? `${Math.round(d / 10) * 10} m` : `${(d / 1000).toFixed(1)} km`);
    $('wiInsp').innerHTML = `
      <p class="wi-sys" style="color:${W.SYSTEMS[n.sys].col}">${W.SYSTEMS[n.sys].label} · ${W.STAGES[n.stage]}</p>
      <h3>${esc(n.label)}</h3>
      <div class="wi-facts"><div><span>Begins</span><b>${n.t === 0 ? 'at once' : `~T+${n.t} h`}</b></div><div><span>Likelihood</span><b>${cap(n.likely)} <small>${pct(n.p)}</small></b></div></div>
      <p class="wi-desc">${esc(n.desc)}</p>
      ${causes.length ? `<h4>Caused by</h4><ul class="wi-rel">${causes.map((c) => `<li><button type="button" data-node="${c.n.id}">${esc(c.n.label)}</button><span>${esc(c.e.how)}</span></li>`).join('')}</ul>` : ''}
      ${leads.length ? `<h4>Leads to</h4><ul class="wi-rel">${leads.map((c) => `<li><button type="button" data-node="${c.n.id}">${esc(c.n.label)}</button><span>${esc(c.e.how)}</span></li>`).join('')}</ul>` : ''}
      ${n.sites.length ? `<h4>Real sites near ${esc(state.place.name)}</h4><ul class="wi-sites">${n.sites.map((s) => `<li>${s.id ? `<a href="${esc(S.href('/twin', { a: s.id, c: null }))}">${esc(s.name)}</a>` : esc(s.name)}<span>${dist(s.d)}</span></li>`).join('')}</ul>` : ''}
      ${n.act ? `<h4>What helps</h4><p class="wi-act">${esc(n.act)}</p>` : ''}`;
    $('wiInsp').querySelectorAll('[data-node]').forEach((b) => b.addEventListener('click', () => selectNode(b.dataset.node)));
  }
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  function drawPipe() {
    const r = result, list = r.nodes.slice().sort((a, b) => a.t - b.t || a.stage - b.stage);
    $('wiPipe').innerHTML = `<ol class="wi-pipe">${list.map((n) => `<li class="${n.id === selected ? 'on' : ''}" data-node="${n.id}" tabindex="0">
        <span class="wi-pt num">${n.t === 0 ? 'T+0' : `T+${n.t} h`}</span><span class="wi-ps" style="color:${W.SYSTEMS[n.sys].col}">${W.SYSTEMS[n.sys].label}</span>
        <span class="wi-pl">${esc(n.label)}</span><span class="wi-pp">${n.likely} · ${pct(n.p)}</span>
        <span class="wi-pq">${n.sites.slice(0, 2).map((s) => esc(s.name)).join(', ')}</span></li>`).join('')}</ol>
      ${r.skipped.length ? `<p class="bd-note">Not reached at this severity: ${r.skipped.map(esc).join('; ')}.</p>` : ''}`;
  }

  T.router.register('/whatif', {
    title: 'What-if',
    mount(ctx) { S.show(); render(ctx); },
    unmount() { token++; },
    update(ctx, changed) { if (changed.includes('city')) render(ctx); },
  });
})(typeof window !== 'undefined' ? window : globalThis);
