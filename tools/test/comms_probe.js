// Communications products: SITREP, CAP 1.2 and public SMS, for every city and scenario.
//   node tools/test/comms_probe.js [--city nagpur] [--scenario monsoon2023] [--show sitrep|cap|sms]
// Checks the CAP document parses as XML, its polygon is closed, and the SMS segment
// counts follow GSM 03.38 (Devanagari forces UCS-2 at 67 characters per segment).
const path = require('path');
global.window = global;
window.TWIN = {};
for (const f of ['core', 'data/geodata', 'data/geodata_nagpur', 'engine/scenarios', 'engine/engine', 'engine/analytics', 'engine/population', 'engine/interventions', 'engine/comms']) {
  require(path.join(__dirname, '../../src/js', f + '.js'));
}
const T = window.TWIN;
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const city = arg('city', 'nagpur');
const show = arg('show', null);
const geo = (window.TWIN_GEOS || { raleigh: window.TWIN_GEO })[city];
if (!geo) throw new Error('Unknown city ' + city);
T.core.setTZ(geo.tz, geo.tzLabel);
const only = arg('scenario', null);
let fails = 0;
const check = (ok, msg) => { if (!ok) { fails++; console.log('  FAIL ' + msg); } };

for (const scen of Object.values(T.scenarios).filter((s) => !s.cities || s.cities.includes(city))) {
  if (only && scen.id !== only) continue;
  const e = T.engine.create(geo, { scenario: scen.id });
  const pop = T.population.create(geo);
  e.analytics = T.analytics.create(e, pop.modeled ? { peopleFor: pop.peopleFor } : {});
  const k = e.kOf(scen.liveNow || 34.5);
  const reg = e.analytics.crises(k), cr = e.analytics.cascadeR(k);
  const cfg = T.comms.cityCfg(geo);
  console.log(`== ${city}/${scen.id} @T+${(k * e.DT).toFixed(1)} · ${reg.list.length} crises · languages ${cfg.langs.join(', ')}`);

  // SITREP
  const p = T.interventions.create(e);
  const ids = p.recommend(k, 5);
  const plan = ids.length ? { ids, catalog: p.CATALOG, result: p.evaluate(k, ids), deadline: p.deadline(k, ids) } : null;
  if (plan) plan.deadline.actBy = plan.deadline.actBy;
  const people = pop.modeled ? pop.atRisk(e.stateAt(k).risk) : { high: 0, crit: 0 };
  const sr = T.comms.sitrep(null, e, k, { number: 1, cr, crises: reg, people, plan, redTeam: false });
  check(sr.includes('SITUATION REPORT'), 'sitrep header');
  check(sr.includes('EXERCISE'), 'sitrep marked as an exercise');
  check(/\d\. RECOMMENDED ACTIONS/.test(sr), 'sitrep section 6');
  console.log(`   sitrep ${sr.split('\n').length} lines, ${sr.length} chars`);
  if (show === 'sitrep') console.log(sr);

  // CAP + SMS per crisis
  for (const c of reg.list.slice(0, 2)) {
    const xml = T.comms.cap(null, e, c, k, { cascadeR: cr.r });
    check(xml.startsWith('<?xml'), 'cap declaration');
    const infos = (xml.match(/<info>/g) || []).length;
    check(infos === cfg.langs.length, `cap has one info block per language (${infos} vs ${cfg.langs.length})`);
    const poly = (xml.match(/<polygon>([^<]*)<\/polygon>/) || [])[1] || '';
    const pts = poly.trim().split(/\s+/);
    check(pts.length > 3 && pts[0] === pts[pts.length - 1], 'cap polygon is closed');
    check(/<severity>(Extreme|Severe|Moderate)<\/severity>/.test(xml), 'cap severity');
    check(!/&(?!amp;|lt;|gt;|quot;|apos;)/.test(xml), 'cap escapes bare ampersands');
    const g = T.comms.grade(c, k * e.DT);
    const lines = cfg.langs.map((lang) => {
      const s = T.comms.sms(geo, e.t0, c, k * e.DT, lang);
      const expect = s.encoding === 'GSM-7' ? (s.chars <= 160 ? 1 : Math.ceil(s.chars / 153)) : (s.chars <= 70 ? 1 : Math.ceil(s.chars / 67));
      check(s.segments === expect, `sms segments for ${lang}`);
      check(/[^\x00-\x7F]/.test(s.text) ? s.encoding === 'UCS-2' : true, `non-Latin text forces UCS-2 (${lang})`);
      return `${lang} ${s.encoding} ${s.chars}ch ${s.segments}seg`;
    });
    console.log(`   ${c.id} ${c.family}/${c.type} · ${g.severity}/${g.urgency}/${g.certainty} · cap ${(xml.length / 1024).toFixed(1)} KB · ${lines.join(' · ')}`);
    if (show === 'cap') console.log(xml);
    if (show === 'sms') for (const lang of cfg.langs) console.log(`   [${lang}] ${T.comms.sms(geo, e.t0, c, k * e.DT, lang).text}`);
  }
  if (!reg.list.length) console.log('   no crisis in the registry, so no alert is issued');
}
console.log(fails ? `${fails} check(s) failed` : 'all checks passed');
process.exit(fails ? 1 : 0);
