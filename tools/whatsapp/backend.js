/* WhatsApp backend: owns every reply. The bridge posts each incoming message here and
   sends back whatever this returns; slow products and location alerts are pushed later
   through the bridge's /send.

     node tools/whatsapp/backend.js

   Env: WA_BACKEND_PORT (8090), WA_BRIDGE_URL (http://127.0.0.1:8091),
        WA_SIM_RATE scenario hours per real minute (default 0.5),
        WA_TICK_S seconds between alert checks (default 30).

   The clock is the scenario's, not the wall's: each city starts at its scenario's
   "now" and advances WA_SIM_RATE hours a minute, so alerts start, escalate and end
   while you watch. At T+72 it starts over from the scenario's now. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const W = require('./twin');
const P = require('./pipeline');

const PORT = +(process.env.WA_BACKEND_PORT || 8090);
const BRIDGE = process.env.WA_BRIDGE_URL || 'http://127.0.0.1:8091';
const RATE = +(process.env.WA_SIM_RATE || 0.5);
const TICK = +(process.env.WA_TICK_S || 30) * 1000;
const STATE = path.join(__dirname, 'state.json');

// ── Simulated clock per city ─────────────────────────────────────────────
const started = Date.now(), scen = {};
for (const city of Object.keys(W.GEOS)) { scen[city] = W.scenarioOf(city, process.env[`WA_SCENARIO_${city.toUpperCase()}`]); W.engine(city, scen[city].id); }
function clock(city) {
  const s = scen[city], t0 = s.liveNow || 34.5, span = 72 - t0;
  const run = ((Date.now() - started) / 60000) * RATE;
  return { scenario: s.id, t: t0 + (span > 0 ? run % span : 0) };
}

// ── Per-sender state, kept on disk so a restart does not forget subscriptions ─
let users = {};
try { users = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch (e) { users = {}; }
const save = () => fs.writeFile(STATE, JSON.stringify(users, null, 1), () => {});
const userOf = (jid) => (users[jid] = users[jid] || P.fresh());

async function push(to, text) {
  try {
    const r = await fetch(`${BRIDGE}/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to, text }) });
    if (!r.ok) console.log(`push to ${to} failed: ${r.status} ${await r.text()}`);
  } catch (e) { console.log(`push to ${to} failed: ${e.message} (is the bridge running?)`); }
}

// ── HTTP ─────────────────────────────────────────────────────────────────
const body = (req) => new Promise((ok, no) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch (e) { no(e); } }); });
const send = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };

http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') return send(res, 200, { ok: true, cities: Object.fromEntries(Object.keys(W.GEOS).map((c) => [c, clock(c)])), users: Object.keys(users).length });
    if (req.method === 'POST' && req.url === '/incoming') {
      const m = await body(req); // { from, text, location: { lat, lng, name } }
      if (!m.from) return send(res, 400, { error: 'from is required' });
      const user = userOf(m.from);
      const out = P.handle(user, { text: m.text, location: m.location }, clock);
      save();
      send(res, 200, { reply: out.reply });
      // Ack-then-defer: the slow part goes out as its own message once ready.
      if (out.later) setTimeout(() => { let text; try { text = out.later(); } catch (e) { text = `Sorry, the report failed: ${e.message}`; } push(m.from, text); }, 50);
      return;
    }
    send(res, 404, { error: 'not found' });
  } catch (e) { console.log('error', e); send(res, 500, { error: e.message }); }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`CASCADE WhatsApp backend on http://127.0.0.1:${PORT} · bridge ${BRIDGE} · ${RATE} scenario h/min`);
  for (const c of Object.keys(W.GEOS)) console.log(`  ${c}: ${scen[c].label} from T+${clock(c).t.toFixed(1)}h`);
});

// ── Location alerts ──────────────────────────────────────────────────────
setInterval(() => {
  for (const [jid, user] of Object.entries(users)) {
    let msgs = [];
    try { msgs = P.changes(user, clock); } catch (e) { console.log('alert check failed for', jid, e.message); }
    for (const m of msgs) push(jid, m);
    if (msgs.length) save();
  }
}, TICK);
