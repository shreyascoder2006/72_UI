/* Warnings at #/warnings: how the forecast leaves the room.

   Three products, all generated from the twin's state at the issue time and nothing
   after it, so a warning shown for T+30 in a replay is exactly what could have been
   sent at T+30: a situation report for responders, an OASIS CAP 1.2 alert per crisis
   for alerting gateways, and the public cell-broadcast text in the city's languages.

   The segment counter is not decoration. GSM 03.38 packs 160 characters into one SMS;
   Devanagari forces UCS-2 and 70, so the same warning costs one message in English and
   three in Hindi. A warning that will not fit is a warning that does not arrive. */
(function (root) {
  const T = root.TWIN;
  const C = T.core, S = T.site, V = T.crisisView;
  const { fmtT } = C;
  const { esc } = S;
  const $ = (id) => document.getElementById(id);
  const pct = (p) => Math.round(p * 100) + '%';

  let token = 0;

  async function render(ctx) {
    const my = ++token, alive = () => my === token;
    S.header('/warnings');
    let L;
    try { L = await S.load(ctx, S.busy); } catch (err) { S.fail(err); return; }
    if (!alive()) return;
    S.settle(L); S.header('/warnings', L);
    const { e, an, k } = L;
    const M = T.comms, cfg = M.cityCfg(L.geo);
    const reg = an.crises(k), cr = an.cascadeR(k);
    const pop = T.services.population(L.geo.id);
    const people = pop.modeled ? pop.atRisk(e.stateAt(k).risk) : { high: 0, crit: 0 };

    $('page').innerHTML = `
      <div class="pg-wrap">
        <header class="pg-head">
          <p class="pg-kicker">${esc(L.scen.label)} · <span>${esc(L.scen.provenance ? L.scen.provenance.label : 'Simulation')}</span></p>
          <h1>Warnings</h1>
          <p class="pg-asof">As issuable at ${V.at(L, L.t)} by the ${esc(cfg.desk)}</p>
          <p class="ov-lede">${reg.list.length
            ? `${reg.list.length === 1 ? 'One crisis is' : `${reg.list.length} crises are`} in the registry, so ${reg.list.length === 1 ? 'one alert can be issued' : `${reg.list.length} alerts can be issued`} in ${cfg.langs.map((l) => M.LANG_NAME[l]).join(', ')}. Every line below is built from what the twin knew at ${fmtT(L.t)}; nothing after that moment is used.`
            : `No crisis is in the registry at ${fmtT(L.t)}, so there is no public alert to issue. The situation report below is still available.`}</p>
          <p class="warn-exercise">All products are marked <b>EXERCISE</b>. This is a simulation and must not be sent to a real alerting gateway.</p>
        </header>

        <section class="pg-sec" aria-labelledby="wnPub">
          <h2 id="wnPub">Public alerts</h2>
          ${reg.list.length
            ? `<p class="pg-note">One per crisis. The phone card is the cell-broadcast text as a handset would receive it; the segment count is what the carrier bills and what the character set allows.</p>
               <div id="wnCrises">${reg.list.map((c) => crisisBlock(L, M, cfg, c, cr)).join('')}</div>`
            : '<p class="empty">Nothing to issue.</p>'}
        </section>

        <section class="pg-sec" aria-labelledby="wnSit">
          <h2 id="wnSit">Situation report</h2>
          <p class="pg-note">For responders and the operations desk, refreshed every 3 h or on any change of city state.</p>
          <div class="wn-doc">
            <div class="wn-doc-bar"><span class="caps">Plain text · ${esc(L.geo.city)} EOC</span><button class="btn" data-copy="wnSitrep">Copy</button></div>
            <pre class="wn-pre" id="wnSitrep">Building…</pre>
          </div>
        </section>

        <section class="pg-sec prov" aria-labelledby="wnProv">
          <h2 id="wnProv">How these are built</h2>
          <p>The alert vocabulary is OASIS CAP 1.2: severity from the number of critical members and the residents in the footprint, urgency from how soon the next facility is forecast to go critical, certainty from whether it is observed or forecast. The area is the crisis footprint, 700 m around each member facility, as a closed polygon.</p>
          <p>Advice is per hazard family, in ${cfg.langs.map((l) => M.LANG_NAME[l]).join(', ')}, with ${esc(L.geo.city)}'s own helpline (${cfg.help}) and ambulance number (${cfg.ems}).</p>
          <p>${esc(S.provenance(L))}</p>
        </section>
      </div>`;

    document.getElementById('page').addEventListener('click', onCopy);
    // The sitrep needs the planner, which takes a moment; the page is usable before it.
    await S.nextFrame();
    if (!alive()) return;
    const plan = await T.services.recommended(e, k, 5);
    if (!alive()) return;
    const p = T.services.planner(e);
    const ctxSit = {
      number: Math.max(1, Math.round(L.t / 3)), cr, crises: reg, people, redTeam: false,
      plan: plan.ids.length ? { ids: plan.ids, catalog: p.CATALOG, result: plan.result, deadline: p.deadline(k, plan.ids) } : null,
    };
    if (!alive()) return;
    const el = $('wnSitrep');
    if (el) el.textContent = M.sitrep(null, e, k, ctxSit);
  }

  function crisisBlock(L, M, cfg, c, cr) {
    const g = M.grade(c, L.t);
    const xml = M.cap(null, L.e, c, L.k, { cascadeR: cr.r });
    const cards = cfg.langs.map((lang) => {
      const s = M.sms(L.geo, L.e.t0, c, L.t, lang);
      const tight = s.segments > 2;
      return `<div class="wn-phone">
        <div class="wn-phone-top"><span class="caps">${esc(M.LANG_NAME[lang])}</span><span class="wn-seg${tight ? ' tight' : ''}">${s.encoding} · ${s.chars} chars · ${s.segments} segment${s.segments > 1 ? 's' : ''}</span></div>
        <p class="wn-sms">${esc(s.text)}</p>
      </div>`;
    }).join('');
    return `<article class="wn-crisis">
      <header class="wn-crisis-head">
        <div>
          <h3><a href="${esc(V.crisisHref(c.id))}" class="num">${esc(c.id)}</a> ${esc(c.type)}</h3>
          <p class="pg-note">${esc(V.places(c.districts, 3))} · ${esc(V.people(c.people))} in the footprint · ${c.members.length} facilities</p>
        </div>
        <div class="wn-grade">
          <span class="pill ${g.severity === 'Extreme' ? 'r-critical' : g.severity === 'Severe' ? 'r-high' : 'r-watch'}">${g.severity}</span>
          <span class="caps faint">${g.urgency} · ${g.certainty}</span>
        </div>
      </header>
      <div class="wn-phones">${cards}</div>
      <details class="wn-cap">
        <summary>CAP 1.2 alert · ${cfg.langs.length} info block${cfg.langs.length > 1 ? 's' : ''} · ${(xml.length / 1024).toFixed(1)} KB</summary>
        <div class="wn-doc-bar"><span class="caps">application/cap+xml</span><button class="btn" data-copy="cap-${esc(c.id)}">Copy</button></div>
        <pre class="wn-pre" id="cap-${esc(c.id)}">${esc(xml)}</pre>
      </details>
    </article>`;
  }

  // Copy buttons: the viewer's clipboard permission can be refused, so fall back to
  // selecting the text and saying so.
  function onCopy(ev) {
    const b = ev.target.closest('[data-copy]');
    if (!b) return;
    const el = document.getElementById(b.dataset.copy);
    if (!el) return;
    const done = (msg) => { const t = b.textContent; b.textContent = msg; setTimeout(() => (b.textContent = t), 1600); };
    const text = el.textContent;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => done('Copied'), () => { select(el); done('Select and copy'); });
    } else { select(el); done('Select and copy'); }
  }
  function select(el) {
    const r = document.createRange();
    r.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges(); sel.addRange(r);
  }

  T.router.register('/warnings', {
    title: 'Warnings',
    mount(ctx) { S.show(); render(ctx); },
    unmount() { token++; },
    update(ctx) { render(ctx); },
  });
})(typeof window !== 'undefined' ? window : globalThis);
