/* WhatsApp bridge (Baileys, an unofficial WhatsApp Web client). It only moves bytes:
   each incoming message goes to the backend's /incoming and the reply comes back; the
   backend pushes reports and location alerts through this process's /send.

     WA_PHONE=918010275709 node tools/whatsapp/bridge.js

   First run: prints an 8-character pairing code. On the phone: WhatsApp → Settings →
   Linked devices → Link a device → "Link with phone number instead", and enter it.
   The session is kept in tools/whatsapp/auth/, so restarts do not need re-pairing.

   Safety: this links YOUR WhatsApp account. The bot answers only in your own "Message
   yourself" chat and from numbers listed in WA_ALLOW (comma-separated, digits with
   country code). Every other chat is ignored, so your contacts never get bot replies.

   Env: WA_PHONE, WA_ALLOW, WA_BACKEND_URL (http://127.0.0.1:8090), WA_BRIDGE_PORT (8091). */
const http = require('http');
const path = require('path');
const pino = require('pino');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers, jidNormalizedUser } = require('@whiskeysockets/baileys');

const PHONE = (process.env.WA_PHONE || '').replace(/\D/g, '');
const ALLOW = new Set((process.env.WA_ALLOW || '').split(',').map((s) => s.replace(/\D/g, '')).filter(Boolean));
const BACKEND = process.env.WA_BACKEND_URL || 'http://127.0.0.1:8090';
const PORT = +(process.env.WA_BRIDGE_PORT || 8091);
const AUTH = path.join(__dirname, 'auth');

let sock = null, ready = false, pairingAsked = false;
const sentByBot = new Set(); // ids of messages this bridge sent, so it never answers itself

async function connect() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH);
  const { version } = await fetchLatestBaileysVersion();
  sock = makeWASocket({ version, auth: state, logger: pino({ level: 'silent' }), browser: Browsers.windows('Chrome'), markOnlineOnConnect: false, syncFullHistory: false });
  sock.ev.on('creds.update', saveCreds);

  if (!sock.authState.creds.registered && !pairingAsked) {
    if (!PHONE) { console.log('Set WA_PHONE (country code + number, digits only) to get a pairing code.'); process.exit(1); }
    pairingAsked = true;
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(PHONE);
        console.log(`\n================  PAIRING CODE: ${code.match(/.{1,4}/g).join('-')}  ================`);
        console.log('WhatsApp → Settings → Linked devices → Link a device → "Link with phone number instead" → enter the code.');
        console.log('The code expires in a few minutes; restart the bridge for a new one.\n');
      } catch (e) { console.log('Could not get a pairing code:', e.message); pairingAsked = false; }
    }, 3000);
  }

  sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'open') { ready = true; console.log(`Connected as ${sock.user && sock.user.id}. Message yourself on WhatsApp: send "hi".`); }
    if (connection === 'close') {
      ready = false;
      const code = lastDisconnect && lastDisconnect.error && lastDisconnect.error.output ? lastDisconnect.error.output.statusCode : 0;
      if (code === DisconnectReason.loggedOut) { console.log('Logged out from the phone. Delete tools/whatsapp/auth/ and start again to re-link.'); process.exit(1); }
      console.log(`Connection closed (${code || 'unknown'}); reconnecting…`); // 515 right after pairing is expected
      setTimeout(connect, 1500);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    for (const m of messages) {
      if (process.env.WA_DEBUG) console.log(`[debug] ${type} jid=${m.key.remoteJid} alt=${m.key.remoteJidAlt || m.key.senderPn || ''} fromMe=${m.key.fromMe} me=${JSON.stringify({ id: sock.user && sock.user.id, lid: sock.user && sock.user.lid })} keys=${Object.keys(m.message || {}).join(',')}`);
      try { await onMessage(m); } catch (e) { console.log('message failed:', e.message); }
    }
  });
}

const digits = (jid) => (jid || '').split('@')[0].split(':')[0];
function isSelfChat(jid) {
  const me = sock.user || {};
  const n = jidNormalizedUser(jid);
  return n === jidNormalizedUser(me.id || '') || (me.lid && n === jidNormalizedUser(me.lid));
}

async function onMessage(m) {
  const jid = m.key.remoteJid;
  if (!m.message || !jid || jid.endsWith('@g.us') || jid === 'status@broadcast' || jid.endsWith('@newsletter')) return;
  if (sentByBot.has(m.key.id)) return;
  const self = isSelfChat(jid);
  if (m.key.fromMe && !self) return;                 // your own messages to other people
  // Newer WhatsApp addresses chats by a hidden id (…@lid); the phone number rides along as the alt jid.
  const phone = digits(m.key.remoteJidAlt || m.key.senderPn || jid);
  if (!self && !ALLOW.has(phone)) {                  // only you, and numbers you allow
    if (!m.key.fromMe) console.log(`(ignored a message from +${phone}: not in WA_ALLOW)`);
    return;
  }
  const msg = m.message.ephemeralMessage ? m.message.ephemeralMessage.message : m.message;
  const text = msg.conversation || (msg.extendedTextMessage && msg.extendedTextMessage.text) || '';
  const loc = msg.locationMessage || msg.liveLocationMessage;
  const location = loc ? { lat: loc.degreesLatitude, lng: loc.degreesLongitude, name: loc.name || null } : null;
  if (!text && !location) return;
  console.log(`← ${self ? "you" : "+" + phone}: ${location ? `[location ${location.lat.toFixed(4)},${location.lng.toFixed(4)}] ` : ''}${text.slice(0, 80)}`);
  const r = await fetch(`${BACKEND}/incoming`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from: jid, text, location }) });
  const { reply } = await r.json();
  if (reply) await say(jid, reply);
}
async function say(jid, text) {
  if (!ready) throw new Error('WhatsApp is not connected yet');
  const sent = await sock.sendMessage(jid, { text });
  if (sent && sent.key) sentByBot.add(sent.key.id);
  if (sentByBot.size > 500) sentByBot.delete(sentByBot.values().next().value);
}

// The backend's push channel.
http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') { res.end(JSON.stringify({ connected: ready, user: sock && sock.user ? sock.user.id : null })); return; }
  if (req.method !== 'POST' || req.url !== '/send') { res.writeHead(404); res.end(); return; }
  let b = '';
  req.on('data', (d) => (b += d));
  req.on('end', async () => {
    try { const { to, text } = JSON.parse(b); await say(to, text); res.end('{"ok":true}'); }
    catch (e) { res.writeHead(503); res.end(JSON.stringify({ error: e.message })); }
  });
}).listen(PORT, '127.0.0.1', () => console.log(`Bridge push endpoint on http://127.0.0.1:${PORT}/send · backend ${BACKEND}`));

connect();
