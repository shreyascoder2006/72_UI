/* Hexagonal facility markers floating above their real locations on a ground stem.
   Colour follows the facility's risk state; the inner glyph is the facility type. */
(function (root) {
  const { stateOf } = root.TWIN.core;
  const HEX = 'M15 1.2 28.2 8.8v15.4L15 31.8 1.8 24.2V8.8z';
  const HEX_IN = 'M15 5.6 24.4 11v10.8L15 27.4 5.6 21.8V11z';

  function install(gl, map, geo, onPick) {
    const F = geo.facilities;
    const items = F.map((f, i) => {
      const el = document.createElement('div');
      el.className = 'hx r-normal';
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      el.setAttribute('aria-label', `${f.name}, ${f.subtype}`);
      el.innerHTML = `
        <div class="hx-pin">
          <svg class="hx-shape" viewBox="0 0 30 33"><path class="fill" d="${HEX}"/><path class="inner" d="${HEX_IN}"/></svg>
          <span class="hx-ico">${root.TWIN.icons.forFacility(f)}</span>
        </div>
        <div class="hx-stem" style="height:${f.stem || 34}px"></div>
        <div class="hx-foot"></div>
        <div class="hx-label"><span>${f.name}</span><span class="num">—</span></div>`;
      el.addEventListener('click', (e) => { e.stopPropagation(); onPick(i); });
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(i); } });
      const marker = new gl.Marker({ element: el, anchor: 'bottom', pitchAlignment: 'viewport', rotationAlignment: 'viewport' }).setLngLat(f.lngLat).addTo(map);
      return { el, marker, num: el.querySelector('.num'), state: 'normal', type: f.type };
    });

    let selected = null;
    function update(R, trust) {
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const st = stateOf(R[i]).key;
        if (st !== it.state) { it.el.classList.replace('r-' + it.state, 'r-' + st); it.state = st; }
        it.num.textContent = Math.round(R[i] * 100) + '%';
        it.el.classList.toggle('fault', trust && trust[i] < 0.5);
        it.el.style.zIndex = st === 'critical' ? 4 : st === 'high' ? 3 : 2;
      }
      if (selected != null) items[selected].el.style.zIndex = 6;
    }
    function select(i) {
      if (selected != null) items[selected].el.classList.remove('selected');
      selected = i;
      if (i != null) items[i].el.classList.add('selected');
    }
    function setTypeVisible(type, on) {
      for (const it of items) if (it.type === type) it.el.style.display = on ? '' : 'none';
    }
    function dimExcept(set) {
      for (let i = 0; i < items.length; i++) items[i].el.classList.toggle('dim', !!set && !set.has(i));
    }
    return { update, select, setTypeVisible, dimExcept };
  }

  root.TWIN.markers = { install };
})(typeof window !== 'undefined' ? window : globalThis);
