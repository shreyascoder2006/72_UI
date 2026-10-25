/* Communications products generated from the twin's state at the issue time:
   a situation report for responders, CAP 1.2 alerts for alerting gateways, and
   public SMS / cell-broadcast text in the city's languages.

   Everything here reads only engine products available at the issue step (nowcast,
   forecast cascade, crises, sensor trust, report corroboration), so a message issued
   at T+30 h in a replay is exactly what the twin could have sent at that moment. */
(function (root) {
  const C = root.TWIN.core;
  // analytics.js may load after this file, so it is read when a product is built.
  const A = () => root.TWIN.analytics;

  const CITY = {
    nagpur: { langs: ['en', 'hi', 'mr'], locale: { en: 'en-IN', hi: 'hi-IN', mr: 'mr-IN' }, help: '112', ems: '108', desk: 'City Emergency Operations Centre' },
    raleigh: { langs: ['en', 'es'], locale: { en: 'en-US', es: 'es-US' }, help: '911', ems: '911', desk: 'City Emergency Operations Center' },
  };
  const cityCfg = (geo) => CITY[geo.id] || { langs: ['en'], locale: { en: 'en' }, help: '112', ems: '112', desk: 'Emergency Operations Centre' };
  const LANG_NAME = { en: 'English', hi: 'हिन्दी', mr: 'मराठी', es: 'Español' };

  // [headline, advice] per hazard family. The first sentence of the advice is the SMS action.
  const TXT = {
    en: {
      flood: ['Flood warning', 'Avoid low-lying roads, underpasses and riverbanks. Move people and valuables to upper floors. Do not drive through water.'],
      grid: ['Power outage alert', 'Charge phones and power banks now. Keep torches ready. People on home medical equipment should contact their provider.'],
      toxic: ['Gas leak alert', 'Go indoors and stay there, with doors and windows closed and AC and fans off. Do not travel through the affected area.'],
      crowd: ['Crowd safety alert', 'Use alternate routes and avoid the procession areas. Follow police directions.'],
      gridlock: ['Traffic disruption', 'Avoid non-essential travel. Keep lanes clear for ambulances and fire engines.'],
      health: ['Health system advisory', 'Use local clinics for non-urgent care. Call {ems} for emergencies.'],
      comms: ['Mobile network disruption', 'Save emergency numbers and agree a meeting point with family. Keep calls and messages short.'],
    },
    hi: {
      flood: ['बाढ़ चेतावनी', 'निचली सड़कों, अंडरपास और नदी किनारों से दूर रहें। लोगों और सामान को ऊपरी मंज़िल पर ले जाएँ। पानी में गाड़ी न चलाएँ।'],
      grid: ['बिजली कटौती चेतावनी', 'फ़ोन और पावर बैंक अभी चार्ज करें। टॉर्च तैयार रखें। घर पर चिकित्सा उपकरण वाले लोग अपने प्रदाता से संपर्क करें।'],
      toxic: ['गैस रिसाव चेतावनी', 'घर के अंदर जाएँ और वहीं रहें, दरवाज़े-खिड़कियाँ बंद और एसी-पंखे बंद रखें। प्रभावित क्षेत्र से होकर यात्रा न करें।'],
      crowd: ['भीड़ सुरक्षा चेतावनी', 'वैकल्पिक मार्ग अपनाएँ और जुलूस वाले क्षेत्रों से दूर रहें। पुलिस के निर्देशों का पालन करें।'],
      gridlock: ['यातायात बाधा', 'गैर-ज़रूरी यात्रा टालें। एम्बुलेंस और दमकल के लिए रास्ता खाली रखें।'],
      health: ['स्वास्थ्य प्रणाली सूचना', 'सामान्य उपचार के लिए नज़दीकी क्लिनिक जाएँ। आपात स्थिति में {ems} पर कॉल करें।'],
      comms: ['मोबाइल नेटवर्क बाधा', 'आपातकालीन नंबर सहेज लें और परिवार के साथ मिलने की जगह तय करें। कॉल और संदेश छोटे रखें।'],
    },
    mr: {
      flood: ['पूर इशारा', 'सखल रस्ते, भुयारी मार्ग आणि नदीकाठ टाळा. लोक व सामान वरच्या मजल्यावर हलवा. पाण्यातून वाहन चालवू नका.'],
      grid: ['वीज खंडित इशारा', 'फोन आणि पॉवर बँक आताच चार्ज करा. टॉर्च तयार ठेवा. घरी वैद्यकीय उपकरणे वापरणाऱ्यांनी आपल्या पुरवठादाराशी संपर्क साधावा.'],
      toxic: ['वायुगळती इशारा', 'घरात जा आणि तिथेच रहा, दारे-खिडक्या बंद आणि एसी-पंखे बंद ठेवा. बाधित भागातून प्रवास करू नका.'],
      crowd: ['गर्दी सुरक्षा इशारा', 'पर्यायी मार्ग वापरा आणि मिरवणुकीचे भाग टाळा. पोलिसांच्या सूचनांचे पालन करा.'],
      gridlock: ['वाहतूक अडथळा', 'अनावश्यक प्रवास टाळा. रुग्णवाहिका आणि अग्निशमन वाहनांसाठी रस्ता मोकळा ठेवा.'],
      health: ['आरोग्य यंत्रणा सूचना', 'सामान्य उपचारासाठी जवळच्या दवाखान्यात जा. आपत्कालीन स्थितीत {ems} वर कॉल करा.'],
      comms: ['मोबाइल नेटवर्क अडथळा', 'आपत्कालीन क्रमांक जतन करा आणि कुटुंबासोबत भेटण्याचे ठिकाण ठरवा. कॉल आणि संदेश लहान ठेवा.'],
    },
    es: {
      flood: ['Aviso de inundación', 'Evite calles bajas, pasos inferiores y orillas de arroyos. Suba a personas y objetos de valor a pisos altos. No conduzca por zonas inundadas.'],
      grid: ['Alerta de apagón', 'Cargue teléfonos y baterías ahora. Tenga linternas a mano. Si usa equipo médico en casa, contacte a su proveedor.'],
      toxic: ['Alerta de fuga de gas', 'Entre y permanezca bajo techo con puertas y ventanas cerradas y el aire acondicionado apagado. No transite por la zona afectada.'],
      crowd: ['Alerta por aglomeraciones', 'Use rutas alternas y evite las zonas de desfile. Siga las indicaciones de la policía.'],
      gridlock: ['Interrupción del tráfico', 'Evite viajes no esenciales. Deje libres los carriles para ambulancias y bomberos.'],
      health: ['Aviso del sistema de salud', 'Para atención no urgente acuda a clínicas locales. En emergencias llame al {ems}.'],
      comms: ['Interrupción de la red móvil', 'Guarde los números de emergencia y acuerde un punto de encuentro con su familia. Haga llamadas y mensajes breves.'],
    },
  };
  const WHEN = {
    en: { now: 'in effect now', from: (s) => `expected from ${s}`, help: (n) => `Helpline ${n}`, areaJoin: ', ', more: (n) => ` +${n} more` },
    hi: { now: 'अभी लागू', from: (s) => `${s} से संभावित`, help: (n) => `हेल्पलाइन ${n}`, areaJoin: ', ', more: (n) => ` +${n} अन्य` },
    mr: { now: 'आता लागू', from: (s) => `${s} पासून शक्यता`, help: (n) => `हेल्पलाइन ${n}`, areaJoin: ', ', more: (n) => ` +${n} इतर` },
    es: { now: 'vigente ahora', from: (s) => `previsto desde las ${s}`, help: (n) => `Emergencias ${n}`, areaJoin: ', ', more: (n) => ` y ${n} más` },
  };
  const firstSentence = (s) => (s.match(/^.*?[.।](\s|$)/) || [s])[0].trim();

  // CAP vocabulary
  const CAP_CAT = { flood: 'Met', grid: 'Infra', toxic: 'CBRNE', crowd: 'Safety', gridlock: 'Transport', health: 'Health', comms: 'Infra' };
  const CAP_RESP = { flood: 'Prepare', grid: 'Prepare', toxic: 'Shelter', crowd: 'Avoid', gridlock: 'Avoid', health: 'Monitor', comms: 'Prepare' };

  // ISO 8601 with the city's UTC offset, as CAP requires (no fractional seconds, no Z).
  function isoAt(t0, t, tz) {
    const d = new Date(new Date(t0).getTime() + Math.round(t * 60) * 60e3);
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
      .formatToParts(d).reduce((o, x) => ((o[x.type] = x.value), o), {});
    const hh = p.hour === '24' ? '00' : p.hour;
    const off = Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +hh, +p.minute, +p.second) - d.getTime()) / 60000);
    const a = Math.abs(off), pad = (n) => String(n).padStart(2, '0');
    return `${p.year}-${p.month}-${p.day}T${hh}:${p.minute}:${p.second}${off >= 0 ? '+' : '-'}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
  }
  // "21:30, 25/10" in the city's time zone.
  function stamp(t0, t, tz) {
    const d = new Date(new Date(t0).getTime() + Math.round(t * 60) * 60e3);
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(d).reduce((o, x) => ((o[x.type] = x.value), o), {});
    return `${p.hour === '24' ? '00' : p.hour}:${p.minute}, ${p.day}/${p.month}`;
  }

  // Footprint polygon: convex hull of circles around the member facilities.
  function footprint(lngLats, radiusM = 700) {
    if (!lngLats.length) return [];
    const lat0 = lngLats[0][1];
    const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110540;
    const pts = [];
    for (const [lng, lat] of lngLats) for (let a = 0; a < 12; a++) {
      const th = (a / 12) * Math.PI * 2;
      pts.push([lng + (radiusM * Math.cos(th)) / kx, lat + (radiusM * Math.sin(th)) / ky]);
    }
    pts.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [], upper = [];
    for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
    for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
    const ring = lower.slice(0, -1).concat(upper.slice(0, -1));
    ring.push(ring[0]);
    return ring;
  }

  // CAP severity, urgency and certainty for a crisis at issue time tIssue.
  function grade(c, tIssue) {
    const eta = c.nextCrit ? c.nextCrit.t - tIssue : Infinity;
    const severity = c.nCrit >= 3 || c.people > 250000 ? 'Extreme' : c.nCrit >= 1 || (c.nextCrit && c.nextCrit.prob >= 0.6) ? 'Severe' : 'Moderate';
    const urgency = (c.observed && c.maxR >= 0.75) || eta <= 6 ? 'Immediate' : eta <= 24 || c.observed ? 'Expected' : 'Future';
    const certainty = c.observed ? 'Observed' : c.nextCrit && c.nextCrit.prob >= 0.6 ? 'Likely' : 'Possible';
    return { severity, urgency, certainty, eta };
  }

  function areaText(lang, districts) {
    const w = WHEN[lang];
    const shown = districts.slice(0, 3).join(w.areaJoin);
    return districts.length > 3 ? shown + w.more(districts.length - 3) : shown;
  }

  function onsetT(c, tIssue) { return c.observed ? Math.min(tIssue, c.since) : c.since; }

  function sms(geo, t0, c, tIssue, lang) {
    const cfg = cityCfg(geo), w = WHEN[lang], [head, advice] = TXT[lang][c.family];
    const inEffect = c.observed && c.maxR >= 0.55;
    const when = inEffect ? w.now : w.from(stamp(t0, onsetT(c, tIssue), geo.tz));
    const act = firstSentence(advice).replace('{ems}', cfg.ems);
    const head2 = lang === 'en' || lang === 'es' ? head.toUpperCase() : head;
    const stop = lang === 'hi' ? '।' : '.';
    const text = `${head2} - ${areaText(lang, c.districts)}: ${when}${stop} ${act} ${w.help(cfg.help)}`;
    return { text, ...segments(text) };
  }

  // SMS segmentation: GSM 03.38 basic alphabet packs 160 chars (153 when concatenated);
  // anything else (Devanagari, most accents) forces UCS-2 at 70 (67).
  const GSM = /^[A-Za-z0-9 \r\n@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà]*$/;
  function segments(text) {
    const gsm = GSM.test(text), n = text.length;
    const seg = gsm ? (n <= 160 ? 1 : Math.ceil(n / 153)) : (n <= 70 ? 1 : Math.ceil(n / 67));
    return { encoding: gsm ? 'GSM-7' : 'UCS-2', chars: n, segments: seg };
  }

  const xmlEsc = (s) => String(s).replace(/[<>&'"]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[ch]));

  function cap(app, e, c, kIssue, extra = {}) {
    const geo = e.geo, cfg = cityCfg(geo), tIssue = kIssue * e.DT;
    const g = grade(c, tIssue);
    const sent = isoAt(e.t0, tIssue, geo.tz);
    const onset = isoAt(e.t0, onsetT(c, tIssue), geo.tz);
    const expires = isoAt(e.t0, tIssue + 12, geo.tz);
    const ring = footprint(c.members.map((i) => e.F[i].lngLat));
    const polygon = ring.map(([lng, lat]) => `${lat.toFixed(4)},${lng.toFixed(4)}`).join(' ');
    const id = `CASCADE72-${(geo.city || geo.id).toUpperCase()}-${c.id}-${sent.replace(/[-:]/g, '').slice(0, 13)}`;
    const F = e.F;
    const worst = c.members.slice().sort((a, b) => e.now[kIssue * e.N + b] - e.now[kIssue * e.N + a]).slice(0, 4).map((i) => F[i].name);
    const descEn = `${c.type} affecting ${c.districts.join(', ')}. ${c.members.length} monitored facilities involved across ${Object.keys(c.sys).map((s) => A().SYS_LABEL[s]).join(', ')}; most stressed: ${worst.join('; ')}.`
      + (c.nextCrit ? ` Next facility forecast to reach CRITICAL: ${F[c.nextCrit.i].name} around ${stamp(e.t0, c.nextCrit.t, geo.tz)} (${Math.round(c.nextCrit.prob * 100)}% probability).` : '')
      + ` About ${Math.round(c.people / 1000)}k residents live in the affected footprint.`;
    const infos = cfg.langs.map((lang) => {
      const [head, advice] = TXT[lang][c.family];
      const s = sms(geo, e.t0, c, tIssue, lang);
      const desc = lang === 'en' ? descEn : s.text;
      return `  <info>
    <language>${cfg.locale[lang]}</language>
    <category>${CAP_CAT[c.family]}</category>
    <event>${xmlEsc(lang === 'en' ? c.type : head)}</event>
    <responseType>${g.severity === 'Extreme' && c.family === 'flood' ? 'Evacuate' : CAP_RESP[c.family]}</responseType>
    <urgency>${g.urgency}</urgency>
    <severity>${g.severity}</severity>
    <certainty>${g.certainty}</certainty>
    <eventCode><valueName>CASCADE72</valueName><value>${c.family}</value></eventCode>
    <effective>${sent}</effective>
    <onset>${onset}</onset>
    <expires>${expires}</expires>
    <senderName>${xmlEsc(`${geo.city} ${cfg.desk} (exercise)`)}</senderName>
    <headline>${xmlEsc(`${head}: ${areaText(lang, c.districts)}`)}</headline>
    <description>${xmlEsc(desc)}</description>
    <instruction>${xmlEsc(advice.replace('{ems}', cfg.ems))}</instruction>
    <contact>${cfg.help}</contact>
    <parameter><valueName>CrisisID</valueName><value>${c.id}</value></parameter>
    <parameter><valueName>Stage</valueName><value>${c.stage}</value></parameter>
    <parameter><valueName>PeopleExposed</valueName><value>${Math.round(c.people)}</value></parameter>
    ${extra.cascadeR != null ? `<parameter><valueName>CascadeR</valueName><value>${extra.cascadeR.toFixed(2)}</value></parameter>\n    ` : ''}<area>
      <areaDesc>${xmlEsc(c.districts.join(', '))}, ${xmlEsc(geo.city)}</areaDesc>
      <polygon>${polygon}</polygon>
    </area>
  </info>`;
    });
    return `<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>${id}</identifier>
  <sender>cascade72@${geo.id}.twin.local</sender>
  <sent>${sent}</sent>
  <status>Exercise</status>
  <msgType>Alert</msgType>
  <scope>Public</scope>
  <note>Generated by the CASCADE 72 digital twin at ${C.fmtT(tIssue)} from ${xmlEsc(e.scen.label)}. Uses only data available at the issue time.</note>
${infos.join('\n')}
</alert>
`;
  }

  // Plain-text situation report for responders.
  function sitrep(app, e, kIssue, ctx) {
    const geo = e.geo, F = e.F, N = e.N, tIssue = kIssue * e.DT, cfg = cityCfg(geo);
    const ck = C.clockAt(e.t0, tIssue);
    const city = e.cityAt(kIssue);
    const cr = ctx.cr, crises = ctx.crises;
    const L = [];
    const rule = '─'.repeat(64);
    const pct = (x) => Math.round(x * 100) + '%';
    L.push(`SITUATION REPORT ${ctx.number} · ${geo.city.toUpperCase()}, ${geo.region.toUpperCase()}`);
    L.push(`Issued ${ck.day} ${ck.time} ${C.tzLabel()} (${C.fmtT(tIssue)}) by ${cfg.desk}`);
    L.push(`Scenario: ${e.scen.label}${ctx.redTeam ? ' · RED-TEAM STREAMS ACTIVE' : ''} · Status: EXERCISE`);
    L.push(rule);
    L.push('1. SITUATION');
    L.push(`   City state ${C.stateOf(city.risk).label} (risk index ${pct(city.risk)}). Facilities: ${city.counts.critical} critical, ${city.counts.high} high risk, ${city.counts.watch} watch, ${city.counts.normal} normal.`);
    L.push(`   People living where the nearest facility is HIGH RISK or worse: ${Math.round(ctx.people.high + ctx.people.crit).toLocaleString('en-IN')} (${Math.round(ctx.people.crit).toLocaleString('en-IN')} at CRITICAL).`);
    L.push(`   Cascade-R ${cr.r.toFixed(2)}: ${cr.r >= 1 ? 'more stress is moving through dependencies than arriving from the hazard; the cascade is self-sustaining.' : cr.r >= 0.5 ? 'dependencies are carrying a growing share of the stress.' : 'stress is mostly direct hazard impact.'}`);
    L.push('');
    L.push(`2. ACTIVE CRISES (${crises.list.length})`);
    if (!crises.list.length) L.push('   None. No facility is at or forecast to reach HIGH RISK within 24 h.');
    for (const c of crises.list) {
      L.push(`   ${c.id}  ${c.type.toUpperCase()} · ${c.stage}`);
      L.push(`     Area: ${c.districts.join(', ')} · ~${Math.round(c.people / 1000)}k residents`);
      L.push(`     Systems: ${Object.entries(c.sys).map(([s, r]) => `${A().SYS_LABEL[s]} ${C.stateOf(r).label}`).join(', ')}`);
      L.push(`     Started at ${F[c.root].name} (${C.fmtT(c.since)})${c.nextCrit ? `; next CRITICAL forecast: ${F[c.nextCrit.i].name} at ${C.fmtT(c.nextCrit.t)} (${pct(c.nextCrit.prob)})` : ''}`);
    }
    for (const l of crises.links) {
      const a = crises.list[l.from], b = crises.list[l.to];
      if (l.kind === 'couples') L.push(`   Interaction: ${a.id} can propagate into ${b.id} via ${F[e.E[l.edge].from].id} → ${F[e.E[l.edge].to].id} (lag ${l.lag} h).`);
      else L.push(`   Contention: ${a.id} and ${b.id} both load ${F[l.fac].name}.`);
    }
    L.push('');
    L.push('3. FORECAST · next CRITICAL crossings (median time, probability)');
    const fc = e.cascade(kIssue).filter((c) => c.level === 'CRITICAL' && !c.observed && c.t - tIssue <= 48).slice(0, 10);
    if (!fc.length) L.push('   No facility is forecast to reach CRITICAL in the next 48 h.');
    for (const c of fc) L.push(`   ${C.fmtT(c.t).padEnd(9)} ${F[c.i].name.padEnd(42).slice(0, 42)} ${pct(c.prob).padStart(4)}  (in ${C.fmtDur(c.t - tIssue)})`);
    L.push('');
    L.push('4. SYSTEM STATUS · worst facility per system');
    for (const s of crises.systems) {
      let wi = -1;
      for (let i = 0; i < N; i++) if (A().group(e.kinds[i]) === s && (wi < 0 || e.now[kIssue * N + i] > e.now[kIssue * N + wi])) wi = i;
      if (wi >= 0) L.push(`   ${A().SYS_LABEL[s].padEnd(10)} ${C.stateOf(e.now[kIssue * N + wi]).label.padEnd(10)} ${F[wi].name}`);
    }
    L.push('');
    L.push('5. INFORMATION INTEGRITY');
    const deg = [];
    for (let i = 0; i < N; i++) if (e.trust[kIssue * N + i] < 0.5) deg.push(i);
    L.push(deg.length ? `   ${deg.length} sensor feed(s) quarantined: ${deg.map((i) => `${F[i].id} (${pct(e.trust[kIssue * N + i])} trust)`).join(', ')}.` : '   All sensor feeds within expected agreement.');
    const reps = e.alerts.filter((a) => a.kind === 'report' && a.k <= kIssue);
    const ok = reps.filter((a) => a.conf >= 0.5).length;
    L.push(`   Citizen reports: ${reps.length} received, ${ok} corroborated by the twin, ${reps.length - ok} not corroborated and held for verification.`);
    L.push('');
    L.push('6. RECOMMENDED ACTIONS');
    if (ctx.plan && ctx.plan.ids.length) {
      for (const id of ctx.plan.ids) { const a = ctx.plan.catalog.find((x) => x.id === id); L.push(`   • ${a.label} (${a.cost} crew${a.cost > 1 ? 's' : ''})${a.side ? ` · side effect: ${a.side}` : ''}`); }
      L.push(`   Expected: ${pct(ctx.plan.result.reduction)} fewer critical facility-hours; P(hospital critical) ${pct(ctx.plan.result.base.hospCrit)} → ${pct(ctx.plan.result.with.hospCrit)}.`);
      if (ctx.plan.deadline && ctx.plan.deadline.actBy != null) L.push(`   Decision deadline: start by ${C.fmtT(tIssue + ctx.plan.deadline.actBy)} to keep 80% of the benefit.`);
    } else L.push('   No actions recommended: the planner finds no option that reduces expected critical facility-hours.');
    L.push('');
    L.push(`7. NEXT REPORT  ${C.fmtT(tIssue + 3)} or on any change of city state.`);
    L.push(rule);
    L.push('Forecasts use only data available at the issue time. Probabilities are from a 200-member ensemble assimilated with a localized particle filter.');
    return L.join('\n');
  }

  root.TWIN.comms = { cityCfg, LANG_NAME, TXT, sms, cap, sitrep, segments, footprint, isoAt, stamp, grade, CAP_CAT };
})(typeof window !== 'undefined' ? window : globalThis);
