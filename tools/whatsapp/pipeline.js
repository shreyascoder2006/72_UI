/* One pipeline for every incoming WhatsApp message.

   handle(user, msg, clock) takes plain text and/or a shared location and returns the
   reply text, plus an optional slow job whose result the backend pushes later
   (ack-then-defer). Classification is rules-first and deterministic: there is no
   language model, so nothing is said that the twin did not compute. A message no rule
   places gets the menu, never a guess.

   Every answer comes from the simulated scenario at the backend's simulated clock and
   says so. "Safe" here means "outside every simulated alert area", never a real-world
   safety assurance. */
const W = require('./twin');
const { T, C } = W;

const LANG_WORDS = { english: 'en', hindi: 'hi', marathi: 'mr', spanish: 'es', espanol: 'es', 'español': 'es' };
const SEV_ICON = { Extreme: '🔴', Severe: '🟠', Moderate: '🟡' };
const ST_ICON = { normal: '🟢', watch: '🟡', high: '🟠', critical: '🔴' };

// ── Rules (order matters: the first that matches wins) ───────────────────
const RULES = [
  ['stop', /\b(stop|unsubscribe|unsubscr\w*|mute|alerts? off|turn off)\b/i],
  ['subscribe', /\b(subscribe|subscr\w*|notify me|alert me|alerts? on|turn on|start alerts?)\b/i],
  ['flagged', /\b(unsafe|un safe|flag+ed|flags?|danger ?zones?|red ?zones?|hot ?spots?|avoid|affected (areas?|places?|locations?)|which (areas?|places?|locations?))\b/i],
  ['report', /\b(report|reprot|cascad\w*|explain|details?|detailed|why|chain|effects?)\b/i],
  ['safe', /\b(safe|saf|sefe|secure|danger\w*|risk\w*|am i ok)\b/i],
  ['alerts', /\b(alerts?|alret\w*|warnings?|status|update|latest|what'?s happening)\b/i],
  ['help', /^\s*(hi+|hello+|hey+|hii+|start|help|menu|namaste|namaskar|hola|\?)\s*[!.]*\s*$/i],
];
const LOC_PREFIX = /^\s*(?:i\s*a?m\s+(?:at|in|near)|i'?m\s+(?:at|in|near)|im\s+(?:at|in|near)|my\s+location\s+(?:is\s+)?|location\s*[:\-]?\s*|loc\s*[:\-]?\s*|set\s+location\s+(?:to\s+)?|at\s+|in\s+|near\s+)(.+)$/i;
const COORDS = /(-?\d{1,2}\.\d+)\s*[, ]\s*(-?\d{1,3}\.\d+)/;
const CRISIS_ID = /\bCR-[A-Z]{3}-\d{3,5}\b/i;

function classify(text) {
  const t = text || '';
  for (const [intent, re] of RULES) if (re.test(t)) return intent;
  return null;
}
// Pull a location out of a message: shared pin, typed coordinates, or a known place name.
function locate(text, pin) {
  if (pin) {
    const lngLat = [pin.lng, pin.lat], city = W.cityAt(lngLat);
    return { name: pin.name || 'your shared location', lngLat, city, pinned: true };
  }
  if (!text) return null;
  const m = text.match(COORDS);
  if (m) {
    let a = +m[1], b = +m[2];
    const lngLat = Math.abs(a) <= 40 && Math.abs(b) > 40 ? [b, a] : [a, b]; // "lat, lng" as people type it
    return { name: `${lngLat[1].toFixed(4)}, ${lngLat[0].toFixed(4)}`, lngLat, city: W.cityAt(lngLat) };
  }
  const pre = text.match(LOC_PREFIX);
  const p = W.placeNamed(pre ? pre[1] : text);
  return p ? { name: p.name, lngLat: p.lngLat, city: p.city } : pre ? { unknown: pre[1].trim() } : null;
}

// ── State ────────────────────────────────────────────────────────────────
function fresh() { return { city: 'nagpur', place: null, lang: null, subscribed: false, notified: {}, pending: null }; }

// ── Entry point ──────────────────────────────────────────────────────────
function handle(user, msg, clock) {
  const text = (msg.text || '').trim();
  const out = [];
  // Language and city switches ride along with any message.
  const lw = text.toLowerCase().match(/\b(english|hindi|marathi|spanish|espanol|español)\b/);
  if (lw) { user.lang = LANG_WORDS[lw[1]]; }
  const cw = text.toLowerCase().match(/\b(nagpur|raleigh)\b/);
  if (cw && !user.place) user.city = cw[1];

  let intent = classify(text);
  const loc = locate(text, msg.location);
  if (loc && loc.unknown && !intent) {
    return { reply: `I couldn't find *${loc.unknown}* in the covered cities (Nagpur, Raleigh). Share your location with 📎 → Location, or type a neighbourhood like _Sitabuldi_ or _Dharampeth_.` };
  }
  if (loc && !loc.unknown) {
    if (!loc.city) return { reply: `That location is outside the cities the twin covers (Nagpur and Raleigh), so there is no simulated alert data for it.` };
    user.place = { name: loc.name, lngLat: loc.lngLat }; user.city = loc.city; user.notified = {};
    out.push(`📍 Location set: *${loc.name}*, ${W.GEOS[loc.city].city}.`);
    intent = intent || user.pending || 'safe';
    user.pending = null;
  }
  if (lw && !intent && !loc) return { reply: `🌐 Language set to *${T.comms.LANG_NAME[langFor(user)]}* for alert texts.` };
  if (cw && !intent && !loc) intent = 'alerts';

  const clk = clock(user.city);
  const snap = W.snapshot(user.city, clk.scenario, clk.t);
  const head = header(snap, clk);

  switch (intent) {
    case 'help': return { reply: menu(user, snap) };
    case 'subscribe':
      user.subscribed = true;
      if (!user.place) { user.pending = 'safe'; return { reply: `🔔 Alerts are *on*. Now share your location (📎 → Location) or type your area, e.g. _I am in Sitabuldi_, so I can warn you when an alert covers it.` }; }
      out.push(`🔔 Alerts are *on* for *${user.place.name}*. I'll message you when a simulated alert starts, escalates or ends there.`);
      out.push(safety(user, snap, head));
      return { reply: out.join('\n\n') };
    case 'stop':
      user.subscribed = false;
      return { reply: `🔕 Location alerts are *off*. Send *SUBSCRIBE* to turn them back on.` };
    case 'flagged': return { reply: [...out, flagged(snap, head)].join('\n\n') };
    case 'alerts': return { reply: [...out, alerts(user, snap, head)].join('\n\n') };
    case 'safe':
      if (!user.place) { user.pending = 'safe'; return { reply: askLocation() }; }
      return { reply: [...out, safety(user, snap, head)].join('\n\n') };
    case 'report': {
      const id = (text.match(CRISIS_ID) || [])[0];
      if (!id && !user.place && snap.alerts.length > 1) { user.pending = 'report'; return { reply: `${askLocation()}\n\nOr ask for one alert directly, e.g. *REPORT ${snap.alerts[0].c.id}*.` }; }
      // The report is the slow product: acknowledge now, deliver it as a second message.
      return {
        reply: [...out, `⏳ Building the cascade report${id ? ` for ${id.toUpperCase()}` : ''}…`].join('\n\n'),
        later: () => report(user, snap, head, id && id.toUpperCase()),
      };
    }
    default:
      if (out.length) return { reply: out.join('\n\n') };
      return { reply: `Sorry, I didn't catch that.\n\n${menu(user, snap)}` };
  }
}

// ── Replies ──────────────────────────────────────────────────────────────
const langFor = (user) => { const cfg = T.comms.cityCfg(W.GEOS[user.city]); return user.lang && cfg.langs.includes(user.lang) ? user.lang : cfg.langs[0]; };
function header(snap, clk) {
  const ck = C.clockAt(snap.e.t0, snap.t);
  return `🧪 *SIMULATION · EXERCISE* — ${W.scenarioOf(snap.geo.id, clk.scenario).label}\n_${snap.geo.city} · scenario time T+${snap.t.toFixed(1)}h (${ck.day} ${ck.time}). Not a real-world warning._`;
}
const footer = (geo) => `\n_For a real emergency call ${T.comms.cityCfg(geo).ems}. This bot only replays a simulated scenario._`;
const askLocation = () => `📍 Where are you? Share your location (📎 → Location), or type your area, e.g. _I am in Dharampeth_ or _21.14, 79.08_.`;

function menu(user, snap) {
  return `👋 *CASCADE Intelligence* — simulated city-crisis alerts for Nagpur and Raleigh.

Send:
• *your location* (📎 → Location) or _I am in Sitabuldi_ — set where you are
• *SAFE* — is my location inside an alert area?
• *UNSAFE* — which places are flagged right now
• *REPORT* — how the event is cascading, step by step
• *ALERTS* — all active alerts
• *SUBSCRIBE* / *STOP* — automatic alerts for your location
• *HINDI* / *MARATHI* / *ENGLISH* — alert text language

${user.place ? `Your location: *${user.place.name}*` : 'No location set yet.'} · ${snap.alerts.length} simulated alert${snap.alerts.length === 1 ? '' : 's'} in ${snap.geo.city} now.
_Everything here is a simulation exercise, not a real warning._`;
}

function safety(user, snap, head) {
  const r = W.assess(snap, user.place.lngLat), lang = langFor(user);
  const lines = [head, ''];
  if (r.status === 'unsafe') {
    lines.push(`⛔ *UNSAFE — ${user.place.name} is inside ${r.within.length === 1 ? 'an alert area' : `${r.within.length} alert areas`}*`);
    for (const { a } of r.within) {
      lines.push(`${SEV_ICON[a.g.severity]} *${a.c.type}* (${a.c.id}) — ${a.g.severity} · ${a.g.urgency} · ${a.g.certainty}`);
      lines.push(`   ${a.c.observed ? 'In effect now' : `Expected from ~T+${a.c.since.toFixed(1)}h`} · ${a.c.members.length} facilities · ${a.c.nCrit} critical`);
    }
    const top = r.within[0].a;
    lines.push('', `*What to do:* ${T.comms.TXT[lang][top.c.family][1].replace('{ems}', T.comms.cityCfg(snap.geo).ems)}`);
    lines.push('', `Reply *REPORT* for how this event is cascading.`);
  } else if (r.status === 'caution') {
    const x = r.close[0];
    lines.push(`⚠️ *CAUTION — ${user.place.name} is not inside an alert area, but ${(x.near / 1000).toFixed(1)} km from ${x.a.c.id}* (${x.a.c.type}, ${x.a.g.severity}).`);
    lines.push(`Avoid travelling into: ${places(x.a.c.districts, 6)}.`);
    lines.push('', `Reply *UNSAFE* for every flagged area.`);
  } else {
    lines.push(`✅ *NOT IN ANY ALERT AREA — ${user.place.name}*`);
    lines.push(snap.alerts.length ? `No simulated alert covers your location now. ${snap.alerts.length} alert${snap.alerts.length === 1 ? ' is' : 's are'} active elsewhere in ${snap.geo.city}: reply *UNSAFE* to see where.` : `There is no simulated alert in ${snap.geo.city} right now.`);
  }
  lines.push('', `*Nearest monitored facilities*`);
  for (const n of r.nearby) { const st = C.stateOf(n.r); lines.push(`${ST_ICON[st.key]} ${n.f.name} — ${st.label} (${(n.d / 1000).toFixed(1)} km)`); }
  if (!user.subscribed) lines.push('', `Send *SUBSCRIBE* to get alerts here automatically.`);
  lines.push(footer(snap.geo));
  return lines.join('\n');
}

function flagged(snap, head) {
  const lines = [head, ''];
  if (!snap.alerts.length) { lines.push(`✅ No area of ${snap.geo.city} is flagged right now.`); return lines.join('\n') + footer(snap.geo); }
  lines.push(`🚩 *Flagged areas in ${snap.geo.city}* — ${snap.alerts.length} simulated alert${snap.alerts.length === 1 ? '' : 's'}`);
  const R = snap.e.now.subarray(snap.k * snap.e.N, (snap.k + 1) * snap.e.N);
  for (const a of snap.alerts) {
    lines.push('', `${SEV_ICON[a.g.severity]} *${a.c.type}* · ${a.g.severity} · ${a.g.urgency} (${a.c.id})`);
    lines.push(`*Areas:* ${a.c.districts.join(', ')}`);
    const crit = a.c.members.filter((i) => R[i] >= 0.75).map((i) => snap.e.F[i].name);
    if (crit.length) lines.push(`*Critical sites:* ${crit.slice(0, 5).join('; ')}${crit.length > 5 ? ` and ${crit.length - 5} more` : ''}`);
    lines.push(`${a.c.observed ? 'In effect now' : `Expected from ~T+${a.c.since.toFixed(1)}h`} · ≈${people(a.c.people)} residents (modeled)`);
  }
  lines.push('', `The areas are approximate: about 700 m around each affected facility.`);
  return lines.join('\n') + footer(snap.geo);
}

function alerts(user, snap, head) {
  const lang = langFor(user), lines = [head, ''];
  if (!snap.alerts.length) { lines.push(`✅ No simulated alert in ${snap.geo.city} right now.`); return lines.join('\n') + footer(snap.geo); }
  lines.push(`📢 *${snap.alerts.length} active alert${snap.alerts.length === 1 ? '' : 's'} in ${snap.geo.city}*`);
  for (const a of snap.alerts) {
    lines.push('', `${SEV_ICON[a.g.severity]} *${a.c.id}* · ${a.c.type} · ${a.g.severity}`);
    lines.push(T.comms.sms(snap.geo, snap.e.t0, a.c, snap.t, lang).text);
  }
  lines.push('', `Reply *SAFE* to check your location or *REPORT ${snap.alerts[0].c.id}* for the cascade.`);
  return lines.join('\n') + footer(snap.geo);
}

// The detailed cascade report for the alert covering the user (or the one named).
function report(user, snap, head, id) {
  let a = id ? snap.alerts.find((x) => x.c.id === id) : null;
  if (id && !a) return `${head}\n\n${id} is not an active alert at T+${snap.t.toFixed(1)}h. Reply *ALERTS* for the current list.`;
  let where = '';
  if (!a && user.place) {
    const r = W.assess(snap, user.place.lngLat);
    a = (r.within[0] || r.close[0] || {}).a;
    where = r.within.length ? `covers *${user.place.name}*` : r.close.length ? `is the nearest to *${user.place.name}*` : '';
  }
  a = a || snap.alerts[0];
  if (!a) return `${head}\n\n✅ There is no active alert in ${snap.geo.city}, so there is no cascade to report.${footer(snap.geo)}`;
  const c = a.c, e = snap.e, F = e.F, lang = langFor(user);
  const seq = W.cascadeOf(snap, c);
  const sysName = { traffic: 'Roads & traffic', drainage: 'Drainage', ems: 'Ambulance response', power: 'Power', hospital: 'Hospitals', telecom: 'Telecom' };
  const lines = [head, '', `📄 *CASCADE REPORT — ${c.type} (${c.id})*${where ? `\nThis alert ${where}.` : ''}`, ''];
  lines.push(`*Grading:* ${SEV_ICON[a.g.severity]} ${a.g.severity} · ${a.g.urgency} · ${a.g.certainty}`);
  lines.push(`*Stage:* ${c.stage} · ${c.observed ? 'observed' : 'forecast'} · since ~T+${c.since.toFixed(1)}h`);
  lines.push(`*Scale:* ${c.members.length} facilities · ${c.nCrit} critical · ≈${people(c.people)} residents in the area (modeled)`);
  lines.push(`*Areas:* ${c.districts.slice(0, 12).join(', ')}${c.districts.length > 12 ? ` and ${c.districts.length - 12} more` : ''}`);
  lines.push('', `*1. Where it started*`);
  const root = F[c.root];
  lines.push(`${root.name} (${root.subtype || C.TYPES[root.type].label}, ${root.district || ''}) — the first facility in this chain to come under stress.`);
  lines.push('', `*2. Systems under stress now* (highest modeled risk per system)`);
  for (const [s, r] of Object.entries(c.sys).sort((x, y) => y[1] - x[1])) lines.push(`${ST_ICON[C.stateOf(r).key]} ${sysName[s] || s}: ${Math.round(r * 100)}% — ${C.stateOf(r).label}`);
  const past = seq.filter((s) => s.observed), next = seq.filter((s) => !s.observed);
  lines.push('', `*3. How it has spread so far* (${past.length} threshold crossing${past.length === 1 ? '' : 's'})`);
  for (const s of past.slice(-10)) lines.push(`• T+${s.t.toFixed(1)}h — ${s.f.name} reached ${s.level}${s.from && s.from.name !== s.f.name ? `, pushed by ${s.from.name}${s.from.mechanism ? ` (${s.from.mechanism})` : ''}` : ''}`);
  if (past.length > 10) lines.push(`  …and ${past.length - 10} earlier crossings`);
  lines.push('', `*4. What the forecast expects next*`);
  if (next.length) for (const s of next.slice(0, 8)) lines.push(`• ~T+${s.t.toFixed(1)}h — ${s.f.name} → ${s.level} (${Math.round(s.prob * 100)}% of ensemble runs)${s.from ? `, via ${s.from.name}` : ''}`);
  else lines.push(`No further facility in this alert is forecast to cross a threshold.`);
  if (c.nextCrit) lines.push(`*Next CRITICAL:* ${F[c.nextCrit.i].name} at ~T+${c.nextCrit.t.toFixed(1)}h (${Math.round(c.nextCrit.prob * 100)}%)`);
  lines.push('', `*5. What this means for people*`);
  lines.push(effects(c));
  lines.push('', `*6. What to do*`, T.comms.TXT[lang][c.family][1].replace('{ems}', T.comms.cityCfg(snap.geo).ems));
  lines.push('', `_Times are scenario hours from the start of the simulated event. "Pushed by" is the upstream facility the twin's dependency model weights most for that site._`);
  return lines.join('\n') + footer(snap.geo);
}
// Plain-language consequences, only for the systems the twin shows stressed in this crisis.
function effects(c) {
  const say = {
    drainage: 'Drains and channels are overloaded: expect waterlogging on low roads and underpasses.',
    traffic: 'Key roads are disrupted: journeys and emergency vehicles will be slowed or diverted.',
    ems: 'Ambulance response times are stretched across the area.',
    power: 'Power supply is under strain: outages can knock out pumps, signals and phone towers.',
    hospital: 'Hospitals in the area are under pressure: access and capacity may be limited.',
    telecom: 'Mobile and data networks may be degraded.',
  };
  const on = Object.entries(c.sys).filter(([, r]) => r >= 0.35).sort((x, y) => y[1] - x[1]).map(([s]) => say[s]).filter(Boolean);
  return on.length ? on.map((s) => `• ${s}`).join('\n') : '• No system is above WATCH level yet; the alert is driven by the forecast.';
}
const people = (n) => (n == null ? 'unknown' : n >= 1e6 ? `${(n / 1e6).toFixed(2)} million` : `${Math.round(n / 1000).toLocaleString('en-US')},000`);
const places = (list, n) => (list.length <= n ? list.join(', ') : `${list.slice(0, n).join(', ')} and ${list.length - n} more`);

// ── Push: what changed for a subscribed user since the last check ────────
function changes(user, clock) {
  if (!user.subscribed || !user.place) return [];
  const clk = clock(user.city), snap = W.snapshot(user.city, clk.scenario, clk.t), head = header(snap, clk);
  const r = W.assess(snap, user.place.lngLat), lang = langFor(user), out = [];
  const now = Object.fromEntries(r.within.map(({ a }) => [a.c.id, a]));
  for (const [id, a] of Object.entries(now)) {
    const was = user.notified[id];
    if (!was || W.SEV_RANK[a.g.severity] > W.SEV_RANK[was]) {
      out.push(`${head}\n\n🚨 *${was ? `ESCALATED to ${a.g.severity}` : 'NEW ALERT'} for ${user.place.name}*\n\n${T.comms.sms(snap.geo, snap.e.t0, a.c, snap.t, lang).text}\n\n${SEV_ICON[a.g.severity]} ${a.c.type} · ${a.g.severity} · ${a.g.urgency} (${a.c.id})\nReply *REPORT* for the cascade, *STOP* to mute.${footer(snap.geo)}`);
    }
    user.notified[id] = a.g.severity;
  }
  for (const id of Object.keys(user.notified)) {
    if (!now[id]) { out.push(`${head}\n\n✅ *Alert ended for ${user.place.name}*: ${id} no longer covers your location.${footer(snap.geo)}`); delete user.notified[id]; }
  }
  return out;
}

module.exports = { handle, changes, classify, locate, fresh };
