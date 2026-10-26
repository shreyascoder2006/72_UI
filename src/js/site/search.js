/* Search across the site by meaning: pages, facilities, districts, scenarios and the
   crises in the registry at the issue time.

   Queries and entries are embedded with a pretrained sentence model, all-MiniLM-L6-v2
   (Xenova/all-MiniLM-L6-v2 through Transformers.js, about 23 MB, downloaded from Hugging
   Face on the first search and then cached by the browser), and ranked by cosine
   similarity, so "flooded hospitals near the river" finds hospitals by the Nag without
   sharing a word. Until the model is in, or where it cannot load (offline, or the
   single-page build, whose content-security policy only allows its own origin), results
   come from word overlap and are labelled as such. */
(function (root) {
  const T = root.TWIN;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2/+esm';
  const MODEL = 'Xenova/all-MiniLM-L6-v2';
  const SYS = { drainage: 'drainage flooding water river stream gauge', traffic: 'roads traffic junction congestion', power: 'power electricity grid substation', hospital: 'hospital health beds ambulance emergency', telecom: 'telecom mobile phone network', weather: 'weather rain gauge' };

  let embed = null, loading = null, failed = false;
  const vecs = new Map(); // entry text → Float32Array

  function loadModel() {
    if (embed || loading || failed) return loading;
    loading = import(LIB)
      .then(async (tf) => { tf.env.allowLocalModels = false; embed = await tf.pipeline('feature-extraction', MODEL, { dtype: 'q8' }); })
      .catch((err) => { failed = true; console.warn('Semantic search unavailable, using word overlap:', err && err.message ? err.message : err); })
      .finally(() => { loading = null; run(); });
    return loading;
  }
  async function vec(texts) {
    const out = await embed(texts, { pooling: 'mean', normalize: true });
    const d = out.dims[1], data = out.data;
    return texts.map((_, n) => data.slice(n * d, (n + 1) * d));
  }

  // Everything that can be found, for the city and scenario in the context.
  function entries() {
    const ctx = T.store.ctx, r = T.site.resolve(ctx), geo = r.geo, out = [];
    const href = (p, patch) => T.site.href(p, { city: geo.id, s: r.scen.id, ...patch });
    for (const f of T.nav.FEATURES.filter((x) => x.live)) out.push({ kind: 'Page', title: f.label, sub: f.desc, text: `${f.label}. ${f.desc}`, href: href(f.path, { c: null }) });
    for (const f of geo.facilities) {
      out.push({ kind: 'Facility', title: f.name, sub: `${f.subtype || f.type} · ${f.district}`,
        text: `${f.name}, a ${f.subtype || f.type} in ${f.district}${f.address ? ', ' + f.address : ''}. ${SYS[f.type] || ''}${f.creek ? '. On the ' + f.creek : ''}.`,
        href: href('/twin', { a: f.id, c: null }) });
    }
    for (const d of [...new Set(geo.facilities.filter((f) => f.type !== 'weather').map((f) => f.district))]) {
      const here = geo.facilities.filter((f) => f.district === d && f.type !== 'weather').map((f) => f.subtype || f.type);
      out.push({ kind: 'Area', title: d, sub: 'My area: the forecast for people who live there', text: `${d}, a neighbourhood of ${geo.city} where people live, with ${here.join(', ')}.`, href: href('/area', { area: d, c: null }) });
    }
    for (const s of T.services.scenariosFor(geo.id)) out.push({ kind: 'Scenario', title: s.label, sub: s.provenance ? s.provenance.label : '', text: `${s.label}. ${s.blurb}`, href: T.site.href('/', { city: geo.id, s: s.id, t: null, a: null, c: null }) });
    // Crises only when the engine is already built: search never starts a 3 s simulation.
    if (T.services.cached(geo.id, r.scen.id)) {
      const e = T.services.engine(geo.id, r.scen.id);
      const nowT = T.site.nowOf(r);
      const k = e.kOf(ctx.t != null ? Math.min(ctx.t, nowT) : nowT);
      for (const c of e.analytics.crises(k).list) {
        out.push({ kind: 'Crisis', title: `${c.id} · ${c.type}`, sub: `${c.stage} · ${c.districts.slice(0, 3).join(', ')}`,
          text: `${c.type} crisis, ${c.stage.toLowerCase()}, around ${c.districts.join(', ')}, affecting ${Object.keys(c.sys).join(', ')}.`,
          href: href('/crises/' + c.id, { c: null }) });
      }
    }
    return out;
  }

  const words = (s) => String(s).toLowerCase().match(/[a-z0-9ऀ-ॿ]+/g) || [];
  function overlap(q, list) {
    const qw = new Set(words(q).filter((w) => w.length > 2));
    return list.map((x) => {
      const tw = words(x.text + ' ' + x.title);
      let s = 0;
      for (const w of qw) if (tw.some((t) => t.startsWith(w))) s++;
      return { x, s: qw.size ? s / qw.size : 0 };
    }).filter((r) => r.s > 0);
  }

  let seq = 0;
  async function run() {
    const box = $('navSearchInput'), res = $('navSearchResults');
    if (!box || !res) return;
    const q = box.value.trim(), my = ++seq;
    if (!q) { res.hidden = true; res.innerHTML = ''; return; }
    const list = entries();
    let ranked, how;
    if (embed) {
      const need = list.map((x) => x.text).filter((t) => !vecs.has(t));
      if (need.length) (await vec(need)).forEach((v, n) => vecs.set(need[n], v));
      const [qv] = await vec([q]);
      if (my !== seq) return;
      ranked = list.map((x) => { const v = vecs.get(x.text); let s = 0; for (let d = 0; d < v.length; d++) s += v[d] * qv[d]; return { x, s }; })
        .filter((r) => r.s > 0.2);
      how = `Ranked by meaning (${MODEL.split('/')[1]})`;
    } else {
      ranked = overlap(q, list);
      how = failed ? 'Word match (the language model could not load here)' : 'Word match while the language model loads…';
    }
    ranked.sort((a, b) => b.s - a.s);
    const top = ranked.slice(0, 8);
    res.innerHTML = `<div class="ns-how">${esc(how)}</div>` + (top.length
      ? top.map(({ x }) => `<a class="ns-hit" href="${esc(x.href)}"><span class="ns-kind">${esc(x.kind)}</span><span class="ns-title">${esc(x.title)}</span><span class="ns-sub">${esc(x.sub)}</span></a>`).join('')
      : '<div class="ns-none">Nothing close. Try a place, a system or a kind of facility.</div>');
    res.hidden = false;
  }

  let timer = 0;
  function mount(slot) {
    slot.innerHTML = `<label class="ns-field"><span class="ns-ico" aria-hidden="true">${T.icons.UI.search}</span>
      <input id="navSearchInput" type="search" placeholder="Search by meaning" autocomplete="off" aria-label="Search the site" aria-controls="navSearchResults"></label>
      <div class="ns-results" id="navSearchResults" hidden></div>`;
    const box = $('navSearchInput');
    box.addEventListener('focus', loadModel);
    box.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 180); });
    box.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') { box.value = ''; run(); box.blur(); }
      if (ev.key === 'Enter') { const a = $('navSearchResults').querySelector('a'); if (a) a.click(); }
    });
    $('navSearchResults').addEventListener('click', (ev) => { if (ev.target.closest('a')) { box.value = ''; setTimeout(run, 0); } });
    window.addEventListener('keydown', (ev) => {
      if (ev.key === '/' && !ev.target.matches('input, select, textarea')) { ev.preventDefault(); box.focus(); }
    });
  }

  T.search = { mount, run, status: () => (embed ? 'semantic' : failed ? 'words' : 'loading') };
})(typeof window !== 'undefined' ? window : globalThis);
