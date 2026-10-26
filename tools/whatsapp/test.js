// Pipeline fixtures: realistic messages, typos and shared pins, run through the same
// handle() the backend uses, at fixed scenario times. No WhatsApp, no network.
//   node tools/whatsapp/test.js [--show]
const P = require('./pipeline');
const show = process.argv.includes('--show');
let fails = 0;
const check = (ok, msg) => { if (!ok) { fails++; console.log('  FAIL ' + msg); } else if (show) console.log('  ok   ' + msg); };
const at = (t) => (city) => ({ scenario: city === 'nagpur' ? 'monsoon2023' : 'flash', t });

// Classification
const cls = [['hi', 'help'], ['Hello!', 'help'], ['am i safe?', 'safe'], ['is my area sefe', 'safe'], ['which areas are unsafe', 'flagged'],
  ['show flaged locations', 'flagged'], ['send detailed report', 'report'], ['explain the cascading effects', 'report'], ['reprot', 'report'],
  ['any alerts?', 'alerts'], ['subscribe', 'subscribe'], ['stop', 'stop'], ['unsubscribe', 'stop'], ['what is the weather like in paris', null]];
for (const [t, want] of cls) check(P.classify(t) === want, `classify "${t}" → ${P.classify(t)} (want ${want})`);

// Location parsing
check(P.locate('I am in Sitabuldi').city === 'nagpur', 'typed Nagpur place');
check(P.locate('im at dharampeth').name.toLowerCase().includes('dharampeth'), 'lower-case place');
check(P.locate('21.1458, 79.0882').city === 'nagpur', 'lat, lng');
check(P.locate(null, { lat: 35.78, lng: -78.64 }).city === 'raleigh', 'shared pin in Raleigh');
check(P.locate(null, { lat: 48.85, lng: 2.35 }).city === null, 'pin outside coverage');
check(P.locate('I am in Narnia').unknown === 'Narnia', 'unknown place');

// Conversation: slot filling and replies at T+42 in Nagpur (an alert is in effect)
const u = P.fresh(), clk = at(42);
let r = P.handle(u, { text: 'hi' }, clk);
check(/CASCADE Intelligence/.test(r.reply) && /simulation/i.test(r.reply), 'menu');
r = P.handle(u, { text: 'am I safe?' }, clk);
check(u.pending === 'safe' && /Where are you/.test(r.reply), 'asks for location first');
r = P.handle(u, { text: 'I am in Sitabuldi' }, clk);
check(/Location set/.test(r.reply) && /(UNSAFE|CAUTION|NOT IN ANY ALERT AREA)/.test(r.reply) && /SIMULATION/.test(r.reply), 'answers the pending safety question');
if (show) console.log(r.reply);
check(/UNSAFE/.test(r.reply), 'Sitabuldi is inside the T+42 flood alert');
r = P.handle(u, { text: 'which locations are flagged unsafe' }, clk);
check(/Flagged areas/.test(r.reply) && /Areas:/.test(r.reply), 'flagged list');
if (show) console.log(r.reply);
r = P.handle(u, { text: 'detailed report please' }, clk);
check(/Building the cascade report/.test(r.reply) && typeof r.later === 'function', 'report acks then defers');
const rep = r.later();
check(/CASCADE REPORT/.test(rep) && /Where it started/.test(rep) && /spread so far/.test(rep) && /forecast expects next/.test(rep), 'report sections');
if (show) console.log(rep);
r = P.handle(u, { text: 'hindi' }, clk);
check(/हिन्दी|Hindi/.test(r.reply) && u.lang === 'hi', 'language switch');
r = P.handle(u, { text: 'alerts' }, clk);
check(/[ऀ-ॿ]/.test(r.reply), 'alert text in Hindi');
r = P.handle(u, { text: 'what is the weather like in paris' }, clk);
check(/didn't catch/.test(r.reply), 'off-topic gets the menu, not a guess');
r = P.handle(u, { text: '', location: { lat: 48.85, lng: 2.35 } }, clk);
check(/outside the cities/.test(r.reply), 'pin outside coverage reply');

// Push: subscribe at a quiet time, then the alert starts, then it ends
const v = P.fresh();
P.handle(v, { text: 'subscribe' }, at(5));
P.handle(v, { text: 'I am in Sitabuldi' }, at(5));
check(v.subscribed && v.place, 'subscribed with a place');
check(P.changes(v, at(5)).length === 0, 'no alert at T+5');
const on = P.changes(v, at(42));
check(on.length >= 1 && /NEW ALERT/.test(on[0]), 'new alert pushed at T+42');
check(P.changes(v, at(42)).length === 0, 'not pushed twice');
const off = P.changes(v, at(5));
check(off.some((m) => /Alert ended/.test(m)), 'end pushed when it no longer covers');
// Raleigh by pin
const w = P.fresh();
r = P.handle(w, { text: '', location: { lat: 35.7796, lng: -78.6382 } }, at(30));
check(/Raleigh/.test(r.reply) && /(UNSAFE|CAUTION|NOT IN ANY)/.test(r.reply), 'Raleigh pin gets an answer');
if (show) console.log(r.reply);

console.log(fails ? `${fails} check(s) failed` : 'all checks passed');
process.exit(fails ? 1 : 0);
