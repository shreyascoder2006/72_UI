/* My area at #/area: the same forecast, for someone who lives there.

   No risk indices, no Cascade-R, no facility IDs unless you ask. One sentence that
   says whether to worry and when, a 36-hour strip per system that serves the area,
   what to do in the city's own languages, where the nearest hospital is and which
   roads are expected to close. Everything is the same engine at the same issue time
   as the operations pages; only the words change. */
(function (root) {
  const T = root.TWIN;
  const C = T.core, S = T.site, V = T.crisisView;
  const { stateOf, fmtT, haversine } = C;
  const { esc } = S;
  const $ = (id) => document.getElementById(id);
  const HOURS = 36, NEAR_M = 2200, MIN_NEAR = 3;

  let token = 0, lang = null;

  const districts = (geo) => [...new Set(geo.facilities.filter((f) => f.type !== 'weather').map((f) => f.district))].sort();
  // Facilities serving an area: everything within 2.2 km of its centre, or the nearest
  // three if the area is thinly monitored.
  function near(geo, district) {
    const own = geo.facilities.map((f, i) => ({ f, i })).filter((x) => x.f.district === district && x.f.type !== 'weather');
    if (!own.length) return [];
    const c = [own.reduce((s, x) => s + x.f.lngLat[0], 0) / own.length, own.reduce((s, x) => s + x.f.lngLat[1], 0) / own.length];
    const all = geo.facilities.map((f, i) => ({ f, i, d: haversine(c, f.lngLat) })).filter((x) => x.f.type !== 'weather').sort((a, b) => a.d - b.d);
    const within = all.filter((x) => x.d <= NEAR_M);
    return (within.length >= MIN_NEAR ? within : all.slice(0, MIN_NEAR)).map((x) => ({ ...x, centre: c }));
  }

  async function render(ctx) {
    const my = ++token, alive = () => my === token;
    S.header('/area');
    let L;
    try { L = await S.load(ctx, S.busy); } catch (err) { S.fail(err); return; }
    if (!alive()) return;
    S.settle(L); S.header('/area', L);
    const { e, an, k } = L, geo = L.geo;
    const cfg = T.comms.cityCfg(geo);
    if (!lang || !cfg.langs.includes(lang)) lang = cfg.langs[0];
    const list = districts(geo);
    const area = list.includes(ctx.area) ? ctx.area : (pickBusiest(L, list) || list[0]);
    const facs = near(geo, area);
    const R = e.stateAt(k).risk;

    // Forecast risk per facility, hourly, from now to +36 h.
    const steps = [];
    for (let h = 0; h <= HOURS; h++) {
      const kk = Math.min(e.K - 1, k + Math.round(h / e.DT));
      steps.push({ h, kk, R: kk <= k ? R : e.project(k, kk) });
      if (!alive()) return;
    }
    const worst = facs.map((x) => ({ ...x, peak: Math.max(...steps.map((s) => s.R[x.i])), now: R[x.i] }))
      .sort((a, b) => b.peak - a.peak);
    const lead = worst[0];
    const reg = an.crises(k);
    const crisis = reg.list.find((c) => facs.some((x) => c.members.includes(x.i)));
    const family = crisis ? crisis.family : familyOfKind(e.kinds[lead.i]);
    const st = stateOf(lead.peak);
    // When it gets bad: the first hour the leading facility crosses HIGH RISK.
    const onset = steps.find((s) => s.R[lead.i] >= 0.55);
    const advice = T.comms.TXT[lang][family] || T.comms.TXT[lang].flood;

    $('page').innerHTML = `
      <div class="pg-wrap">
        <header class="pg-head">
          <p class="pg-kicker">${esc(geo.city)} · <span>${esc(L.scen.label)}</span></p>
          <h1>My area</h1>
          <div class="ar-pick">
            <label class="select"><select id="arArea" aria-label="Area">${list.map((d) => `<option value="${esc(d)}"${d === area ? ' selected' : ''}>${esc(d)}</option>`).join('')}</select><span>${T.icons.UI.chevron}</span></label>
            <p class="pg-asof">Forecast issued ${V.at(L, L.t)}</p>
          </div>
        </header>

        <section class="ar-verdict r-${st.key}">
          <div class="ar-verdict-dot"><span class="dot"></span></div>
          <div>
            <h2>${esc(verdict(L, area, st, lead, onset, family))}</h2>
            <p>${esc(detail(L, lead, onset, steps))}</p>
          </div>
        </section>

        <section class="pg-sec" aria-labelledby="arNext">
          <h2 id="arNext">The next ${HOURS} hours near you</h2>
          <p class="pg-note">One row per system that serves ${esc(area)}. Each block is one hour, coloured by the forecast state of the facility you depend on.</p>
          ${strip(L, worst, steps)}
        </section>

        <div class="pg-grid two">
          <section class="pg-sec" aria-labelledby="arDo">
            <div class="ar-do-head">
              <h2 id="arDo">What to do now</h2>
              ${cfg.langs.length > 1 ? `<div class="seg" id="arLang">${cfg.langs.map((l) => `<button data-l="${l}" aria-pressed="${l === lang}">${esc(T.comms.LANG_NAME[l])}</button>`).join('')}</div>` : ''}
            </div>
            <p class="ar-advice" lang="${lang}">${esc(advice[1].replace('{ems}', cfg.ems))}</p>
            <p class="ar-numbers">Emergency <b>${cfg.help}</b> · Ambulance <b>${cfg.ems}</b></p>
          </section>
          <section class="pg-sec" aria-labelledby="arCare">
            <h2 id="arCare">Nearest hospital</h2>
            ${hospital(L, facs, steps)}
          </section>
        </div>

        <section class="pg-sec" aria-labelledby="arRoads">
          <h2 id="arRoads">Roads to avoid</h2>
          ${roads(L, worst, steps)}
        </section>

        <section class="pg-sec prov" aria-labelledby="arProv">
          <h2 id="arProv">What this is</h2>
          <p>Decision support from a simulation, not an official warning. ${esc(S.provenance(L))} In a real emergency follow ${esc(geo.city)}'s own alerts and call ${cfg.help}.</p>
          <p>Your area's forecast comes from the ${facs.length} monitored facilities within ${(NEAR_M / 1000).toFixed(1)} km of ${esc(area)}, run on the same 200-member ensemble as the operations pages, using only what was known at ${fmtT(L.t)}.</p>
        </section>
      </div>`;

    $('arArea').addEventListener('change', (ev) => T.store.set({ area: ev.target.value }, { push: true, notify: true }));
    const ls = $('arLang');
    if (ls) ls.addEventListener('click', (ev) => { const b = ev.target.closest('[data-l]'); if (b) { lang = b.dataset.l; render(ctx); } });
  }

  // Open on the area with the most to say, so the page is never blank-looking.
  function pickBusiest(L, list) {
    const R = L.e.stateAt(L.k).risk;
    let best = null;
    for (const d of list) {
      const f = near(L.geo, d);
      if (!f.length) continue;
      const peak = Math.max(...f.map((x) => R[x.i]));
      if (!best || peak > best.peak) best = { d, peak };
    }
    return best && best.peak >= 0.35 ? best.d : null;
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
    if (lead.peak < 0.35) return `The ${L.e.F.length} monitored sites near you stay within normal limits for the next ${HOURS} hours.`;
    return `${name} is the site nearest you under most pressure, worst at about ${S.clockShort(L.e, L.t + peak.h)}.`
      + (onset && onset.h > 0 ? ` You have roughly ${C.fmtDur(onset.h)} before it becomes serious.` : '');
  }

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

  function hospital(L, facs, steps) {
    const hs = facs.filter((x) => L.e.kinds[x.i] === 'hospital' && L.e.F[x.i].subtype !== 'EMS station');
    const h = hs[0] || L.geo.facilities.map((f, i) => ({ f, i, d: haversine(facs[0] ? facs[0].centre : L.geo.center, f.lngLat) }))
      .filter((x) => x.f.type === 'hospital' && x.f.subtype !== 'EMS station').sort((a, b) => a.d - b.d)[0];
    if (!h) return '<p class="empty">No hospital is monitored near this area.</p>';
    const at = (hh) => { const s = steps.find((q) => q.h === hh) || steps[steps.length - 1]; return stateOf(s.R[h.i]); };
    return `<p class="ar-hosp-name"><b>${esc(L.e.F[h.i].name)}</b><span class="pg-note"> · ${(h.d / 1000).toFixed(1)} km away${L.e.F[h.i].beds ? ` · ${L.e.F[h.i].beds} beds` : ''}</span></p>
      <div class="ar-hosp-states">${[[0, 'Now'], [6, 'In 6 h'], [12, 'In 12 h']].map(([hh, label]) => {
        const st = at(hh);
        return `<div><span class="caps">${label}</span><span class="pill r-${st.key}"><span class="dot"></span>${st.label}</span></div>`;
      }).join('')}</div>
      <p class="pg-note">A hospital at HIGH RISK or CRITICAL is still open; it means longer waits and possible diversion.</p>`;
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

  T.router.register('/area', {
    title: 'My area',
    mount(ctx) { S.show(); render(ctx); },
    unmount() { token++; },
    update(ctx) { render(ctx); },
  });
})(typeof window !== 'undefined' ? window : globalThis);
