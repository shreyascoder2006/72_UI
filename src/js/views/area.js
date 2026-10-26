/* My area at #/area: the same forecast, for someone who lives there.

   No risk indices, no Cascade-R, no facility IDs unless you ask. You give a
   neighbourhood (search or your phone's location) and get, in order:
   - one sentence on whether to worry and when, with the rain now against the rain
     coming (the observed storm, then the ensemble's view of it);
   - how it reaches you: the chain from the hazard through the drains, roads, power,
     mobile network, ambulances and hospital you depend on, each step with its time,
     how likely it is and the learned link that carries it;
   - your places: nearby schools and colleges (OpenStreetMap) and whether their access
     is forecast to be cut, the nearest hospital, pharmacies;
   - what to do and by when, in the city's languages, and text to share;
   - today's real weather forecast for the spot (Open-Meteo), kept apart from the
     simulation;
   - the next 36 hours per system, and roads to avoid.
   Everything except the real forecast is the same engine at the same issue time as the
   operations pages; only the words change. */
(function (root) {
  const T = root.TWIN;
  const C = T.core, S = T.site, V = T.crisisView;
  const { stateOf, fmtT, haversine } = C;
  const { esc } = S;
  const $ = (id) => document.getElementById(id);
  const HOURS = 36, NEAR_M = 2200, MIN_NEAR = 3, PLACES_M = 1600;
  const STORE = 'twin.area.';

  let token = 0, lang = null;

  // ── Where: districts of monitored facilities and OpenStreetMap neighbourhoods ──
  function placesOf(geo) {
    const out = new Map();
    const fac = geo.facilities.filter((f) => f.type !== 'weather');
    for (const d of [...new Set(fac.map((f) => f.district))]) {
      const own = fac.filter((f) => f.district === d);
      out.set(d.toLowerCase(), { name: d, kind: 'district', lngLat: [own.reduce((s, f) => s + f.lngLat[0], 0) / own.length, own.reduce((s, f) => s + f.lngLat[1], 0) / own.length] });
    }
    const osm = (root.TWIN_PLACES && root.TWIN_PLACES[geo.id]) || { places: [] };
    for (const [name, cls, lng, lat] of osm.places) if (!out.has(name.toLowerCase())) out.set(name.toLowerCase(), { name, kind: cls, lngLat: [lng, lat] });
    return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  const inCity = (geo, [lng, lat]) => lng >= geo.extent[0] && lng <= geo.extent[2] && lat >= geo.extent[1] && lat <= geo.extent[3];
  // Facilities serving a point: everything within 2.2 km, or the nearest three.
  function near(geo, P) {
    const all = geo.facilities.map((f, i) => ({ f, i, d: haversine(P, f.lngLat) })).filter((x) => x.f.type !== 'weather').sort((a, b) => a.d - b.d);
    const within = all.filter((x) => x.d <= NEAR_M);
    return within.length >= MIN_NEAR ? within : all.slice(0, MIN_NEAR);
  }
  const remember = (city, name) => { try { localStorage.setItem(STORE + city, name); } catch (e) { /* private window */ } };
  const recalled = (city) => { try { return localStorage.getItem(STORE + city); } catch (e) { return null; } };

  async function render(ctx) {
    const my = ++token, alive = () => my === token;
    S.header('/area');
    let L;
    try { L = await S.load(ctx, S.busy); } catch (err) { S.fail(err); return; }
    if (!alive()) return;
    S.settle(L); S.header('/area', L);
    const { e, an, k } = L, geo = L.geo, F = e.F;
    const cfg = T.comms.cityCfg(geo);
    if (!lang || !cfg.langs.includes(lang)) lang = cfg.langs[0];
    const places = placesOf(geo);
    const find = (n) => n && places.find((p) => p.name.toLowerCase() === String(n).toLowerCase());
    const place = find(ctx.area) || find(recalled(geo.id)) || pickBusiest(L, places) || places[0];
    remember(geo.id, place.name);
    const area = place.name, P = place.lngLat;
    const facs = near(geo, P);
    const R = e.stateAt(k).risk;

    // Forecast risk per facility, hourly, from now to +36 h.
    const steps = [];
    for (let h = 0; h <= HOURS; h++) {
      const kk = Math.min(e.K - 1, k + Math.round(h / e.DT));
      steps.push({ h, kk, R: kk <= k ? R : e.project(k, kk) });
    }
    if (!alive()) return;
    const worst = facs.map((x) => ({ ...x, peak: Math.max(...steps.map((s) => s.R[x.i])), now: R[x.i] })).sort((a, b) => b.peak - a.peak);
    const lead = worst[0];
    const reg = an.crises(k);
    const crisis = reg.list.find((c) => facs.some((x) => c.members.includes(x.i)));
    const family = crisis ? crisis.family : familyOfKind(e.kinds[lead.i]);
    const st = stateOf(lead.peak);
    const onset = steps.find((s) => s.R[lead.i] >= 0.55);
    const advice = T.comms.TXT[lang][family] || T.comms.TXT[lang].flood;
    const seq = e.cascade(k);
    const firstOf = new Map();
    for (const s of seq) if (s.level === 'HIGH RISK' && !firstOf.has(s.i)) firstOf.set(s.i, s);
    const rain = rainOutlook(L, P);
    const care = careOf(L, P, facs);
    const chain = chainOf(L, facs, care, firstOf);
    const mine = placesNear(L, P, seq);
    const todo = todoOf(L, cfg, chain, mine, firstOf);

    $('page').innerHTML = `
      <div class="pg-wrap ar-page">
        <header class="pg-head">
          <p class="pg-kicker">${esc(geo.city)} · <span>${esc(L.scen.label)}</span></p>
          <h1>My area</h1>
          <div class="ar-find">
            <label class="ar-search"><span aria-hidden="true">${T.icons.UI.search}</span>
              <input id="arQuery" type="search" value="${esc(area)}" placeholder="Your neighbourhood, e.g. Dharampeth" autocomplete="off" aria-label="Your neighbourhood" aria-controls="arMatches"></label>
            <button class="btn ar-locate" id="arLocate" type="button">${PIN} Use my location</button>
            <ul class="ar-matches" id="arMatches" hidden></ul>
          </div>
          <p class="pg-asof" id="arWhere">${esc(area)} · forecast issued ${V.at(L, L.t)}</p>
        </header>

        <section class="ar-verdict r-${st.key}">
          <div class="ar-verdict-dot"><span class="dot"></span></div>
          <div>
            <h2>${esc(verdict(L, area, st, lead, onset, family))}</h2>
            <p>${esc(detail(L, lead, onset, steps))}</p>
            ${rain ? rainHtml(L, rain) : ''}
          </div>
        </section>

        <section class="pg-sec" aria-labelledby="arChain">
          <h2 id="arChain">How it reaches you</h2>
          ${chainHtml(L, chain, rain, area)}
        </section>

        <section class="pg-sec" aria-labelledby="arDo">
          <div class="ar-do-head">
            <h2 id="arDo">What to do, and by when</h2>
            ${cfg.langs.length > 1 ? `<div class="seg" id="arLang">${cfg.langs.map((l) => `<button data-l="${l}" aria-pressed="${l === lang}">${esc(T.comms.LANG_NAME[l])}</button>`).join('')}</div>` : ''}
          </div>
          <ol class="ar-todo" lang="${lang}">${todo.map((x) => `<li><span class="ar-by">${x.by == null ? '' : x.by <= L.t ? 'Now' : 'By ' + esc(S.clockShort(e, x.by).slice(4))}</span><span>${esc(x.text)}</span></li>`).join('')}</ol>
          <p class="ar-advice" lang="${lang}">${esc(advice[1].replace('{ems}', cfg.ems))}</p>
          <div class="pg-actions"><button class="btn" id="arShare" type="button">${SHARE} Copy a message to share</button><span class="pg-note" id="arShared" aria-live="polite"></span></div>
        </section>

        <section class="pg-sec" aria-labelledby="arPlaces">
          <h2 id="arPlaces">Your places</h2>
          ${placesHtml(L, mine, care, steps)}
        </section>

        <section class="pg-sec" aria-labelledby="arReal">
          <h2 id="arReal">Today's real weather <span class="ml-tag">live</span></h2>
          <div id="arRealBody"><p class="pg-note">Fetching today's forecast for ${esc(area)}…</p></div>
        </section>

        <section class="pg-sec" aria-labelledby="arNext">
          <h2 id="arNext">The next ${HOURS} hours near you</h2>
          <p class="pg-note">One row per system that serves ${esc(area)}. Each block is one hour, coloured by the forecast state of the facility you depend on.</p>
          ${strip(L, worst, steps)}
        </section>

        <section class="pg-sec" aria-labelledby="arRoads">
          <h2 id="arRoads">Roads to avoid</h2>
          ${roads(L, worst, steps)}
        </section>

        <section class="pg-sec prov" aria-labelledby="arProv">
          <h2 id="arProv">What this is</h2>
          <p>Decision support from a simulation, not an official warning. ${esc(S.provenance(L))} In a real emergency follow ${esc(geo.city)}'s own alerts and call ${cfg.help}.</p>
          <p>Your area's forecast comes from the ${facs.length} monitored facilities within ${(NEAR_M / 1000).toFixed(1)} km of ${esc(area)}, run on the same 200-member ensemble as the operations pages, using only what was known at ${fmtT(L.t)}. Schools, colleges, pharmacies and neighbourhood names are OpenStreetMap; whether a school's access is cut is read from the nearest monitored road or crossing, so it is modeled, not reported.</p>
        </section>
      </div>`;

    wireFind(ctx, geo, places);
    const ls = $('arLang');
    if (ls) ls.addEventListener('click', (ev) => { const b = ev.target.closest('[data-l]'); if (b) { lang = b.dataset.l; render(ctx); } });
    $('arShare').addEventListener('click', () => share(L, area, st, lead, onset, family, todo));
    realWeather(P, area).then((html) => { if (alive()) $('arRealBody').innerHTML = html; });
  }

  // ── Finding a place: search, then the phone's location ─────────────────
  function wireFind(ctx, geo, places) {
    const q = $('arQuery'), list = $('arMatches'), where = $('arWhere');
    const go = (name) => { list.hidden = true; T.store.set({ area: name }, { push: true, notify: true }); };
    const show = () => {
      const s = q.value.trim().toLowerCase();
      if (!s) { list.hidden = true; return; }
      const hits = places.filter((p) => p.name.toLowerCase().startsWith(s)).concat(places.filter((p) => !p.name.toLowerCase().startsWith(s) && p.name.toLowerCase().includes(s))).slice(0, 8);
      list.innerHTML = hits.length ? hits.map((p) => `<li><button type="button" data-n="${esc(p.name)}">${esc(p.name)}<span>${p.kind === 'district' ? 'monitored area' : esc(p.kind)}</span></button></li>`).join('') : '<li class="ar-nohit">No place by that name in the city model.</li>';
      list.hidden = false;
    };
    q.addEventListener('input', show);
    q.addEventListener('focus', () => q.select());
    q.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { const b = list.querySelector('button[data-n]'); if (b) go(b.dataset.n); }
      if (ev.key === 'Escape') list.hidden = true;
    });
    list.addEventListener('click', (ev) => { const b = ev.target.closest('button[data-n]'); if (b) go(b.dataset.n); });
    $('arLocate').addEventListener('click', () => {
      if (!navigator.geolocation) { where.textContent = 'This browser cannot share its location. Search for your neighbourhood instead.'; return; }
      where.textContent = 'Finding you…';
      navigator.geolocation.getCurrentPosition((pos) => {
        const P = [pos.coords.longitude, pos.coords.latitude];
        if (!inCity(geo, P)) { where.textContent = `You appear to be outside the area this ${geo.city} model covers. Search for a neighbourhood instead.`; return; }
        const best = places.map((p) => ({ p, d: haversine(P, p.lngLat) })).sort((a, b) => a.d - b.d)[0];
        go(best.p.name);
      }, () => { where.textContent = 'Location was not shared. Search for your neighbourhood instead.'; }, { timeout: 10000, maximumAge: 600000 });
    });
  }

  // Open on the area with the most to say, so the page is never blank-looking.
  function pickBusiest(L, places) {
    const R = L.e.stateAt(L.k).risk;
    let best = null;
    for (const p of places.filter((x) => x.kind === 'district')) {
      const peak = Math.max(...near(L.geo, p.lngLat).map((x) => R[x.i]));
      if (!best || peak > best.peak) best = { p, peak };
    }
    return best && best.peak >= 0.35 ? best.p : null;
  }
  const familyOfKind = (kind) => ({ drainage: 'flood', pump: 'flood', power: 'grid', telecom: 'comms', traffic: 'gridlock', hospital: 'health', ems: 'health' }[kind] || 'flood');

  function verdict(L, area, st, lead, onset, family) {
    const word = { flood: 'Flooding', grid: 'Power cuts', comms: 'Mobile network problems', toxic: 'A gas release', crowd: 'Crowd disruption', gridlock: 'Traffic disruption', health: 'Pressure on hospitals' }[family];
    if (st.key === 'normal') return `No disruption is expected in ${area}.`;
    if (st.key === 'watch') return `${word} is possible in ${area}, but not likely.`;
    const when = onset ? (onset.h <= 0 ? 'now' : `from about ${S.clockShort(L.e, L.t + onset.h)}`) : 'later today';
    return `${word} ${st.key === 'critical' ? 'is likely' : 'is possible'} in ${area} ${when}.`;
  }
  function detail(L, lead, onset, steps) {
    const peak = steps.reduce((a, s) => (s.R[lead.i] > a.R[lead.i] ? s : a), steps[0]);
    const name = L.e.F[lead.i].name;
    if (lead.peak < 0.35) return `The monitored sites near you stay within normal limits for the next ${HOURS} hours.`;
    return `${name} is the site nearest you under most pressure, worst at about ${S.clockShort(L.e, L.t + peak.h)}.`
      + (onset && onset.h > 0 ? ` You have roughly ${C.fmtDur(onset.h)} before it becomes serious.` : '');
  }

  // ── Rain now against rain coming ───────────────────────────────────────
  // Now: the observed storm at this spot (what radar shows). Coming: each ensemble
  // member's storm, weighted by how well it matches the evidence so far.
  function rainOutlook(L, P) {
    const e = L.e, k = L.k;
    const wx = e.idx['WX-DTN'] != null ? e.idx['WX-DTN'] : e.kinds.indexOf('weather');
    if (wx < 0) return null;
    const w = e.wAt(k, wx);
    const now = Math.max(0, e.rainField(e.radarParams(L.t, k), P[0], P[1], L.t));
    // Each member's own 24 h: its total, its wettest hour and when; members disagree on
    // timing, so peaks are taken per member before averaging, not hour by hour.
    const totals = [], peaks = [], when = [];
    for (let m = 0; m < e.M; m++) {
      let tot = 0, pk = 0, ph = 1;
      for (let h = 1; h <= 24; h++) { const r = Math.max(0, e.rainField(e.members[m].sp, P[0], P[1], L.t + h)); tot += r; if (r > pk) { pk = r; ph = h; } }
      totals.push([tot, w[m]]); peaks.push([pk, w[m]]); when.push([ph, w[m]]);
    }
    const q = (pairs, p) => C.quantile(pairs.slice().sort((a, b) => a[0] - b[0]), p);
    const peak = { h: Math.round(q(when, 0.5)), med: q(peaks, 0.5), p90: q(peaks, 0.9) };
    return { now, peak, total: q(totals, 0.5), total90: q(totals, 0.9), maxP90: peak.p90 };
  }
  // Hourly rain intensity in words (American Meteorological Society bands).
  const rainWord = (r) => (r < 0.1 ? 'no rain' : r < 2.5 ? 'light rain' : r < 7.6 ? 'moderate rain' : r < 50 ? 'heavy rain' : 'violent rain');
  const mm = (x) => (x < 10 ? x.toFixed(1) : Math.round(x));
  function rainHtml(L, r) {
    if (r.maxP90 < 0.2 && r.now < 0.1) return '';
    const coming = r.peak.med < 0.1
      ? `${r.maxP90 >= 2.5 ? `Probably dry, but there is a 1-in-10 chance of up to ${mm(r.maxP90)} mm in an hour.` : 'Little or no rain expected.'}`
      : `Likely, peaking around ${mm(r.peak.med)} mm an hour at ${S.clockShort(L.e, L.t + r.peak.h).slice(4)}; about ${mm(r.total)} mm over the 24 hours${r.total90 > r.total * 1.3 ? ` (1-in-10 chance of ${mm(r.total90)} mm or more)` : ''}.`;
    return `<div class="ar-rain">
      <div><span class="caps">Rain now</span><b>${cap(rainWord(r.now))}</b><span>${r.now >= 0.1 ? `${mm(r.now)} mm an hour` : 'nothing falling'}</span></div>
      <div class="ar-rain-arrow" aria-hidden="true">→</div>
      <div><span class="caps">Next 24 hours</span><b>${r.peak.med < 0.1 ? 'Mostly dry' : cap(rainWord(r.peak.med))}</b><span>${coming}</span></div>
    </div>`;
  }
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  // ── How it reaches you ─────────────────────────────────────────────────
  // The hospital and ambulance station people here would use, even if beyond 2.2 km.
  function careOf(L, P, facs) {
    const F = L.geo.facilities;
    const nearestOf = (pred) => F.map((f, i) => ({ f, i, d: haversine(P, f.lngLat) })).filter((x) => pred(x.f)).sort((a, b) => a.d - b.d)[0] || null;
    return {
      hospital: nearestOf((f) => f.type === 'hospital' && f.subtype !== 'EMS station'),
      ems: nearestOf((f) => f.type === 'hospital' && f.subtype === 'EMS station'),
    };
  }
  const STEP = {
    drainage: (n) => `${n} overflows`, pump: (n) => `${n} cannot keep up`, traffic: (n) => `Traffic at ${n} slows or stops`,
    power: (n) => `${n} at risk: power cuts nearby`, telecom: (n) => `Mobile sites at ${n} fail or run on batteries`,
    ems: (n) => `Ambulances from ${n} are delayed`, hospital: (n) => `${n} under pressure: longer waits, possible diversion`,
  };
  const SYS_WORD = { drainage: 'Water', pump: 'Water', traffic: 'Roads', power: 'Power', telecom: 'Phones', ems: 'Ambulance', hospital: 'Hospital' };
  function likely(s) { return s.observed ? 'already happening' : s.prob >= 0.7 ? 'likely' : s.prob >= 0.4 ? 'possible' : 'unlikely but possible'; }
  function chainOf(L, facs, care, firstOf) {
    const e = L.e, F = e.F;
    const ids = new Set(facs.map((x) => x.i));
    if (care.hospital) ids.add(care.hospital.i);
    if (care.ems) ids.add(care.ems.i);
    const nodes = [...ids].filter((i) => firstOf.has(i)).map((i) => ({ i, s: firstOf.get(i) })).sort((a, b) => a.s.t - b.s.t).slice(0, 7);
    const eps = e.edgesAt(L.k);
    nodes.forEach((n, x) => {
      // The learned link from an earlier step that carries the stress here, if any.
      let via = null;
      for (const q of e.inEdges[n.i]) {
        const from = e.E[q].from, earlier = nodes.slice(0, x).find((m) => m.i === from);
        if (earlier && eps[q].status !== 'pruned' && (!via || eps[q].mean > via.mean)) via = { from, mean: eps[q].mean, mech: e.E[q].mechanism };
      }
      n.via = via;
      if (!via) { const top = e.explain(L.k, n.i).drivers.find((d) => d.kind === 'hazard'); n.cause = top ? top.label : null; }
      n.text = (STEP[e.kinds[n.i]] || ((m) => m))(F[n.i].name);
      n.care = care.hospital && n.i === care.hospital.i ? 'your nearest hospital' : care.ems && n.i === care.ems.i ? 'your ambulance station' : null;
    });
    return nodes;
  }
  function chainHtml(L, chain, rain, area) {
    const e = L.e, F = e.F;
    if (!chain.length) return `<p class="empty">Nothing that serves ${esc(area)} is forecast to cross HIGH RISK in the next 72 hours.</p>`;
    const first = rain && rain.peak.med >= 2.5 ? `<li class="ar-step hazard"><span class="ar-t">${esc(S.clockShort(e, L.t + rain.peak.h).slice(4))}</span><span class="ar-sys">Rain</span>
      <div><b>${cap(rainWord(rain.peak.med))} over ${esc(area)}</b><span>about ${mm(rain.peak.med)} mm an hour at its peak · forecast</span></div></li>` : '';
    return `<ol class="ar-chain">${first}${chain.map((n) => `<li class="ar-step r-${n.s.observed ? 'high' : n.s.prob >= 0.7 ? 'high' : 'watch'}">
        <span class="ar-t">${n.s.observed && n.s.t <= L.t ? 'Now' : esc(S.clockShort(e, n.s.t).slice(4))}</span>
        <span class="ar-sys">${SYS_WORD[e.kinds[n.i]] || ''}</span>
        <div><b>${esc(n.text)}</b>
          <span>${likely(n.s)}${n.s.observed ? '' : ` (${Math.round(n.s.prob * 100)}%)`}${n.care ? ` · ${n.care}` : ''}${n.via ? ` · because ${esc(lowerFirst(n.via.mech))} (from ${esc(F[n.via.from].name)})` : n.cause ? ` · driven by ${esc(n.cause.toLowerCase())}` : ''}</span></div></li>`).join('')}</ol>
      <p class="pg-note">First time each facility that serves you reaches HIGH RISK. "Because" is a dependency the model learned from the sensor streams, not one it was given.</p>`;
  }
  const lowerFirst = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

  // ── Your places ────────────────────────────────────────────────────────
  // Schools and colleges near you, with the nearest monitored road or crossing to each
  // and when (if) it is forecast to reach HIGH RISK; pharmacies by distance.
  function placesNear(L, P, seq) {
    const e = L.e, F = e.F;
    const osm = (root.TWIN_PLACES && root.TWIN_PLACES[L.geo.id]) || { pois: [] };
    const first = new Map();
    for (const s of seq) if (s.level === 'HIGH RISK' && !first.has(s.i)) first.set(s.i, s);
    const access = F.map((f, i) => i).filter((i) => e.kinds[i] === 'traffic' || e.kinds[i] === 'drainage');
    const at = (cls) => osm.pois.filter((p) => p[0] === cls).map(([c, name, lng, lat]) => ({ cls: c, name, lngLat: [lng, lat], d: haversine(P, [lng, lat]) })).sort((a, b) => a.d - b.d);
    const schools = at('school').concat(at('college')).sort((a, b) => a.d - b.d).filter((s) => s.d <= PLACES_M).slice(0, 6).map((s) => {
      const road = access.map((i) => ({ i, d: haversine(s.lngLat, F[i].lngLat) })).filter((x) => x.d <= 1200).sort((a, b) => a.d - b.d)[0];
      return { ...s, road: road ? { i: road.i, ev: first.get(road.i) || null } : null };
    });
    return { schools, pharmacies: at('pharmacy').slice(0, 2) };
  }
  function placesHtml(L, mine, care, steps) {
    const e = L.e, F = e.F;
    const km = (d) => (d < 1000 ? `${Math.round(d / 10) * 10} m` : `${(d / 1000).toFixed(1)} km`);
    const schoolRow = (s) => {
      const ev = s.road && s.road.ev;
      const status = !s.road ? '<span class="faint">no monitored road nearby</span>'
        : !ev ? `<span class="ok">access clear</span> <span class="faint">· ${esc(F[s.road.i].name)}</span>`
        : `<span class="${ev.observed || ev.prob >= 0.7 ? 'bad' : 'warn'}">access ${ev.observed ? 'disrupted now' : `${likely(ev)} to be cut from ${esc(S.clockShort(e, ev.t).slice(4))}`}</span> <span class="faint">· ${esc(F[s.road.i].name)}</span>`;
      return `<li><span class="ar-pl-kind">${s.cls === 'college' ? 'College' : 'School'}</span><div><b>${esc(s.name)}</b><span>${km(s.d)} · ${status}</span></div></li>`;
    };
    const h = care.hospital;
    const hState = (hh) => { const s = steps.find((q) => q.h === hh) || steps[steps.length - 1]; return stateOf(s.R[h.i]); };
    return `<div class="pg-grid two ar-places">
      <div>
        <h3 class="ar-h3">Schools and colleges within ${(PLACES_M / 1000).toFixed(1)} km</h3>
        ${mine.schools.length ? `<ul class="ar-pl">${mine.schools.map(schoolRow).join('')}</ul>` : '<p class="empty">None mapped in OpenStreetMap this close.</p>'}
      </div>
      <div>
        <h3 class="ar-h3">Hospital and medicines</h3>
        ${h ? `<p class="ar-hosp-name"><b>${esc(F[h.i].name)}</b><span class="pg-note"> · ${km(h.d)}${F[h.i].beds ? ` · ${F[h.i].beds} beds` : ''}</span></p>
          <div class="ar-hosp-states">${[[0, 'Now'], [6, 'In 6 h'], [12, 'In 12 h']].map(([hh, label]) => { const st = hState(hh); return `<div><span class="caps">${label}</span><span class="pill r-${st.key}"><span class="dot"></span>${st.label}</span></div>`; }).join('')}</div>
          <p class="pg-note">A hospital at HIGH RISK or CRITICAL is still open; it means longer waits and possible diversion.</p>` : '<p class="empty">No hospital is monitored in this city model.</p>'}
        ${mine.pharmacies.length ? `<ul class="ar-pl">${mine.pharmacies.map((p) => `<li><span class="ar-pl-kind">Pharmacy</span><div><b>${esc(p.name)}</b><span>${km(p.d)}</span></div></li>`).join('')}</ul>` : ''}
      </div>
    </div>`;
  }

  // ── What to do, by when ────────────────────────────────────────────────
  const TODO = {
    power: { en: 'Charge phones and power banks. Power cuts may start near you from {t}.', hi: 'फ़ोन और पावर बैंक चार्ज कर लें। {t} से आपके इलाके में बिजली जा सकती है।', mr: 'फोन आणि पॉवर बँक चार्ज करून ठेवा. {t} पासून तुमच्या भागात वीज जाऊ शकते.', es: 'Cargue teléfonos y baterías. Puede haber cortes de luz cerca de usted desde las {t}.' },
    telecom: { en: 'Write {ems} and your family’s numbers on paper; the mobile network may fail from {t}.', hi: '{ems} और परिवार के नंबर कागज़ पर लिख लें; {t} से मोबाइल नेटवर्क बंद हो सकता है।', mr: '{ems} आणि कुटुंबाचे नंबर कागदावर लिहून ठेवा; {t} पासून मोबाइल नेटवर्क बंद होऊ शकते.', es: 'Anote el {ems} y los números de su familia en papel; la red móvil puede fallar desde las {t}.' },
    drainage: { en: 'Move vehicles and valuables off low ground before {t}; stay away from {name}.', hi: '{t} से पहले गाड़ियाँ और ज़रूरी सामान निचली जगहों से हटा लें; {name} से दूर रहें।', mr: '{t} पूर्वी वाहने आणि महत्त्वाचे सामान सखल भागातून हलवा; {name} पासून दूर राहा.', es: 'Antes de las {t}, retire vehículos y objetos de valor de zonas bajas; aléjese de {name}.' },
    traffic: { en: 'Make trips before {t}; {name} is expected to be blocked after that.', hi: '{t} से पहले यात्रा कर लें; उसके बाद {name} पर रास्ता बंद रहने की आशंका है।', mr: '{t} पूर्वी प्रवास उरकून घ्या; त्यानंतर {name} येथे रस्ता बंद राहण्याची शक्यता आहे.', es: 'Haga sus viajes antes de las {t}; después se espera que {name} esté bloqueado.' },
    school: { en: 'Ask {name} about classes: its access may be cut from {t}.', hi: 'कक्षाओं के बारे में {name} से पूछ लें: {t} से वहाँ का रास्ता बंद हो सकता है।', mr: 'वर्गांबद्दल {name} कडे चौकशी करा: {t} पासून तिथला रस्ता बंद होऊ शकतो.', es: 'Pregunte en {name} por las clases: su acceso puede quedar cortado desde las {t}.' },
    hospital: { en: 'If you need regular treatment, go before {t}; {name} is expected to be under pressure after that.', hi: 'अगर नियमित इलाज चाहिए तो {t} से पहले जाएँ; उसके बाद {name} पर दबाव रहने की आशंका है।', mr: 'नियमित उपचार हवे असल्यास {t} पूर्वी जा; त्यानंतर {name} वर ताण येण्याची शक्यता आहे.', es: 'Si necesita tratamiento regular, vaya antes de las {t}; después {name} estará saturado.' },
    ems: { en: 'Ambulances may be slow from {t}; know which neighbour has a vehicle.', hi: '{t} से एम्बुलेंस देर से पहुँच सकती है; जान लें किस पड़ोसी के पास गाड़ी है।', mr: '{t} पासून रुग्णवाहिका उशिरा येऊ शकते; कोणत्या शेजाऱ्याकडे वाहन आहे ते माहिती ठेवा.', es: 'Las ambulancias pueden tardar desde las {t}; sepa qué vecino tiene vehículo.' },
    now: { en: '{name} is already affected: keep away and check before you travel.', hi: '{name} पहले से प्रभावित है: दूर रहें और निकलने से पहले जानकारी लें।', mr: '{name} आधीच बाधित आहे: दूर राहा आणि निघण्यापूर्वी माहिती घ्या.', es: '{name} ya está afectado: manténgase lejos y consulte antes de salir.' },
    always: { en: 'In an emergency call {help}; ambulance {ems}.', hi: 'आपात स्थिति में {help} पर कॉल करें; एम्बुलेंस {ems}।', mr: 'आपत्कालीन स्थितीत {help} वर कॉल करा; रुग्णवाहिका {ems}.', es: 'En una emergencia llame al {help}; ambulancia {ems}.' },
  };
  function todoOf(L, cfg, chain, mine, firstOf) {
    const e = L.e, F = e.F, out = [], seen = new Set();
    const fill = (key, t, name) => (TODO[key][lang] || TODO[key].en).replace('{t}', t == null ? '' : S.clockShort(e, t).slice(4)).replace('{name}', name || '').replace('{ems}', cfg.ems).replace('{help}', cfg.help);
    for (const n of chain) {
      const key = e.kinds[n.i] === 'pump' ? 'drainage' : e.kinds[n.i];
      if (!TODO[key] || seen.has(key) || (!n.s.observed && n.s.prob < 0.4)) continue;
      seen.add(key);
      // Prepare an hour ahead of the event; one already under way is advice for now.
      out.push(n.s.observed ? { by: L.t, text: fill('now', null, F[n.i].name) } : { by: Math.max(L.t, n.s.t - 1), text: fill(key, n.s.t, F[n.i].name) });
    }
    const sch = mine.schools.find((s) => s.road && s.road.ev && (s.road.ev.observed || s.road.ev.prob >= 0.4));
    if (sch) out.push({ by: Math.max(L.t, sch.road.ev.t - 1), text: fill('school', sch.road.ev.t, sch.name) });
    out.sort((a, b) => a.by - b.by);
    out.push({ by: null, text: fill('always') });
    return out;
  }
  async function share(L, area, st, lead, onset, family, todo) {
    const text = `${verdict(L, area, st, lead, onset, family)}\n${todo.slice(0, 4).map((x) => '• ' + x.text).join('\n')}\n(Simulation: ${L.scen.label}. ${location.href})`;
    const note = $('arShared');
    try {
      if (navigator.share) await navigator.share({ title: `${area}: what to expect`, text });
      else { await navigator.clipboard.writeText(text); note.textContent = 'Copied. Paste it into WhatsApp or SMS.'; }
    } catch (err) { note.textContent = 'Could not copy here; select and copy the list above.'; }
  }

  // ── Today's real weather (Open-Meteo, GFS ensemble) ────────────────────
  // Real and current, unlike everything above; fetched for this spot and kept for 30 min.
  const realCache = new Map();
  async function realWeather(P, area) {
    const key = P.map((v) => v.toFixed(2)).join(',');
    const hit = realCache.get(key);
    if (hit && Date.now() - hit.at < 1800e3) return hit.html;
    const url = `https://ensemble-api.open-meteo.com/v1/ensemble?latitude=${P[1].toFixed(3)}&longitude=${P[0].toFixed(3)}&models=gfs_seamless&hourly=precipitation&forecast_hours=72&timezone=auto`;
    let d;
    try {
      const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 9000);
      d = await (await fetch(url, { signal: ctl.signal })).json();
      clearTimeout(timer);
      if (!d.hourly) throw new Error(d.reason || 'no forecast');
    } catch (err) {
      return `<p class="empty">Today's real forecast is not available here (${esc(err && err.message ? err.message : 'offline')}). It needs internet access to open-meteo.com, which the single-page build does not allow.</p>`;
    }
    const times = d.hourly.time, members = Object.keys(d.hourly).filter((x) => x.startsWith('precipitation')).map((x) => d.hourly[x]);
    const n = times.length, qs = (arr, p) => { const s = arr.filter((v) => v != null).sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };
    const med = [], p90 = [];
    for (let h = 0; h < n; h++) { const col = members.map((m) => m[h]); med.push(qs(col, 0.5)); p90.push(qs(col, 0.9)); }
    const sum = (arr, a, b) => arr.slice(a, b).reduce((s, v) => s + (v || 0), 0);
    const tot24 = members.map((m) => sum(m, 0, 24)).sort((a, b) => a - b);
    const heavy = members.filter((m) => m.slice(0, 24).some((v) => v >= 7.6)).length / members.length;
    const any = members.filter((m) => m.slice(0, 24).some((v) => v >= 0.5)).length / members.length;
    const peakH = p90.slice(0, 24).reduce((b, v, h) => (v > p90[b] ? h : b), 0);
    const hhmm = (s) => s.slice(11, 16);
    const day = (s) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(s.slice(0, 10) + 'T00:00:00Z').getUTCDay()];
    const W = 720, H = 120, bw = W / n, ymax = Math.max(2, ...p90);
    const bars = med.map((v, h) => `<rect x="${(h * bw).toFixed(1)}" y="${(H - 18 - (v / ymax) * (H - 30)).toFixed(1)}" width="${Math.max(1, bw - 1).toFixed(1)}" height="${((v / ymax) * (H - 30)).toFixed(1)}" class="rw-med"><title>${day(times[h])} ${hhmm(times[h])}: ${mm(v)} mm (1 in 10: ${mm(p90[h])} mm)</title></rect>`
      + `<line x1="${(h * bw).toFixed(1)}" x2="${((h + 1) * bw - 1).toFixed(1)}" y1="${(H - 18 - (p90[h] / ymax) * (H - 30)).toFixed(1)}" y2="${(H - 18 - (p90[h] / ymax) * (H - 30)).toFixed(1)}" class="rw-p90"/>`).join('');
    const ticks = times.map((s, h) => (h % 12 === 0 ? `<text x="${(h * bw + 2).toFixed(1)}" y="${H - 4}" class="rw-tick">${day(s)} ${hhmm(s)}</text>` : '')).join('');
    const say = any === 0 ? `Dry: none of the ${members.length} forecast runs shows rain in the next 24 hours.` : any < 0.2 ? `Mostly dry: ${Math.round(any * 100)}% of the ${members.length} forecast runs show some rain in the next 24 hours.`
      : `${Math.round(any * 100)}% of the forecast runs bring rain in the next 24 hours, typically ${mm(qs(tot24, 0.5))} mm in all${heavy >= 0.1 ? `; ${Math.round(heavy * 100)}% show a heavy-rain hour (7.6 mm or more), most likely around ${day(times[peakH])} ${hhmm(times[peakH])}` : ''}.`;
    const html = `<p class="ov-ml-lede">${esc(say)}</p>
      <div class="rw-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Real rainfall forecast for ${esc(area)}, next 72 hours">${bars}${ticks}</svg></div>
      <p class="pg-note">Real forecast for ${esc(area)} (${P[1].toFixed(3)}°N, ${P[0].toFixed(3)}°E), issued today: the GFS ensemble's ${members.length} runs through Open-Meteo, in ${esc(d.timezone || 'local')} time. Bars: the middle run's rain each hour; ticks: the 1-in-10 high case. This is real and current. The scenario above is a simulation, and this does not feed it.</p>`;
    realCache.set(key, { at: Date.now(), html });
    return html;
  }

  // ── The next 36 hours, and roads ───────────────────────────────────────
  const SYS = { drainage: 'Flooding', pump: 'Flooding', traffic: 'Roads', power: 'Power', telecom: 'Mobile network', hospital: 'Hospitals', ems: 'Ambulances' };
  function strip(L, worst, steps) {
    const rows = new Map();
    for (const x of worst) {
      const label = SYS[L.e.kinds[x.i]];
      if (!label) continue;
      if (!rows.has(label) || rows.get(label).peak < x.peak) rows.set(label, x);
    }
    if (!rows.size) return '<p class="empty">No monitored system serves this area.</p>';
    const ticks = [];
    for (let h = 0; h <= HOURS; h += 6) ticks.push(`<span style="left:${(h / HOURS) * 100}%">${esc(S.clockShort(L.e, L.t + h))}</span>`);
    return `<div class="ar-strip">
      ${[...rows.entries()].map(([label, x]) => `<div class="ar-row">
        <span class="ar-row-label">${esc(label)}</span>
        <span class="ar-cells">${steps.map((s) => {
          const st = stateOf(s.R[x.i]);
          return `<i class="r-${st.key}" title="${esc(S.clockShort(L.e, L.t + s.h))} · ${st.label}"></i>`;
        }).join('')}</span>
      </div>`).join('')}
      <div class="ar-axis">${ticks.join('')}</div>
    </div>`;
  }

  function roads(L, worst, steps) {
    const rs = worst.filter((x) => L.e.kinds[x.i] === 'traffic' || L.e.kinds[x.i] === 'drainage')
      .map((x) => ({ ...x, cross: steps.find((s) => s.R[x.i] >= 0.55) }))
      .filter((x) => x.cross).slice(0, 6);
    if (!rs.length) return `<p class="empty">No road or crossing near you is forecast to become impassable in the next ${HOURS} hours.</p>`;
    return `<ul class="ar-roads">${rs.map((x) => `<li>
      <b>${esc(L.e.F[x.i].name)}</b>
      <span>${x.cross.h <= 0 ? 'already difficult' : `from about ${esc(S.clockShort(L.e, L.t + x.cross.h))}`} · ${stateOf(x.peak).label.toLowerCase()} at worst</span>
    </li>`).join('')}</ul>`;
  }

  const PIN = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M8 14.5s-4.6-4.3-4.6-7.7a4.6 4.6 0 0 1 9.2 0c0 3.4-4.6 7.7-4.6 7.7z"/><circle cx="8" cy="6.8" r="1.6"/></svg>';
  const SHARE = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M8 10V2.5M5 5.2 8 2.3l3 2.9M3 9v4.5h10V9"/></svg>';

  T.router.register('/area', {
    title: 'My area',
    mount(ctx) { S.show(); render(ctx); },
    unmount() { token++; },
    update(ctx) { render(ctx); },
  });
})(typeof window !== 'undefined' ? window : globalThis);
