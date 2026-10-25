/* Hero facility models: a Three.js custom layer that renders one detailed glTF model
   at the facility the camera is focused on, in the map's own WebGL context.

   • Works with MapLibre GL JS and Mapbox GL JS (CustomLayerInterface, 3D mode); on
     Mapbox Standard it is placed in the 'middle' slot.
   • The model matrix (mercator translation, metre scale, y-up to z-up, heading) is
     folded into the camera projection in float64, so vertices keep sub-centimetre
     precision at city coordinates.
   • Lighting follows the simulated sun (same ephemeris as the basemap): a directional
     light casting real shadow maps onto a transparent shadow catcher over the map
     ground, a sky/ground hemisphere fill and an environment map for reflections. At
     night windows and lamps glow.
   • Lazy: three.js and each model load on the first focus that needs them, then stay
     cached. Only the focused facility renders, so 44+ assets cost nothing city-wide.
   • Risk state stays visible: a ground ring and halo in the facility's risk colour,
     pulsing when critical. The OSM footprint lifted from the tiles at that site is
     hidden while the model is shown, so the model replaces it cleanly. */
(function (root) {
  const C = root.TWIN.core;
  const CDN = 'https://cdn.jsdelivr.net/npm/three@0.160.0';
  // Model per facility; stream and culvert gauges have none and keep their marker only.
  const MODEL_OF = (f) => (f.type === 'hospital' ? (f.subtype === 'EMS station' ? 'ems' : 'hospital')
    : f.type === 'power' ? 'substation' : f.type === 'drainage' ? (f.subtype === 'Pumping station' ? 'pump' : null)
      : f.type === 'traffic' ? 'traffic' : f.type === 'weather' ? 'weather' : null);
  // Ground-ring radius (m) per model.
  const SITE_RADIUS = { hospital: 72, ems: 30, pump: 22, substation: 38, traffic: 24, weather: 11 };

  function install(tm, geo, opts = {}) {
    const { map, gl: GL } = tm;
    const F = geo.facilities;
    const sites = Object.fromEntries((geo.sites || []).map((s) => [s.fi, s]));
    const base = opts.base || new URL('.', location.href).href;
    let THREE = null, GLTFLoader = null, RoomEnvironment = null, threeP = null;
    let layer = null, active = null, focusToken = 0, risk = null, daylight = tm.daylight;
    const models = {};

    function loadThree() {
      threeP = threeP || Promise.all([
        import(`${CDN}/+esm`),
        import(`${CDN}/examples/jsm/loaders/GLTFLoader.js/+esm`),
        import(`${CDN}/examples/jsm/environments/RoomEnvironment.js/+esm`),
      ]).then(([t, l, r]) => { THREE = t; GLTFLoader = l.GLTFLoader; RoomEnvironment = r.RoomEnvironment; });
      return threeP;
    }

    // glTF from data/models/<name>.glb, or from a base64 JSON bundle in single-page builds.
    function loadModel(name) {
      if (models[name]) return models[name];
      const loader = new GLTFLoader();
      const path = base + 'data/models/';
      models[name] = (async () => {
        let gltf;
        if (opts.modelBundles) {
          const idx = await (await fetch(base + opts.modelBundles)).json();
          const b64 = (await (await fetch(base + idx[name])).json()).glb;
          const bin = atob(b64), u8 = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
          gltf = await new Promise((res, rej) => loader.parse(u8.buffer, path, res, rej));
        } else {
          gltf = await new Promise((res, rej) => loader.load(path + name + '.glb', res, undefined, rej));
        }
        const scene = gltf.scene;
        scene.traverse((o) => {
          if (!o.isMesh) return;
          const flat = ['grass', 'lawn', 'gravel', 'asphalt', 'apron', 'paint', 'stone', 'helipad'].includes(o.material.name);
          o.castShadow = !flat; o.receiveShadow = true;
          const m = o.material;
          if (m.map) m.map.anisotropy = 8;
          if (['glassLit', 'lamp'].includes(m.name)) m.userData.dayEmissive = m.emissive.clone();
        });
        const box = new THREE.Box3().setFromObject(scene);
        return { scene, box };
      })();
      return models[name];
    }

    function buildLayer() {
      const scene = new THREE.Scene();
      const pivot = new THREE.Group(); // model frame: rotated to the facility heading
      scene.add(pivot);
      const hemi = new THREE.HemisphereLight('#c8d4e2', '#2a2622', 0.6);
      const sun = new THREE.DirectionalLight('#fff3df', 2.4);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.03;
      scene.add(hemi, sun, sun.target);
      // Shadow catcher: invisible except where the model's shadow falls on the map ground.
      const catcher = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.42, depthWrite: false }));
      catcher.rotation.x = -Math.PI / 2; catcher.position.y = 0.02; catcher.receiveShadow = true;
      scene.add(catcher);
      // Risk ring and halo on the ground.
      const halo = new THREE.Mesh(new THREE.CircleGeometry(1, 72), new THREE.MeshBasicMaterial({ map: haloTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      halo.rotation.x = -Math.PI / 2; halo.position.y = 0.08; halo.renderOrder = 2;
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.965, 1, 96), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, opacity: 0.9, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.1; ring.renderOrder = 3;
      scene.add(halo, ring);
      const camera = new THREE.Camera();
      let renderer = null, envTex = null, hostFbo = null;

      return {
        id: 'hero-models', type: 'custom', renderingMode: '3d',
        onAdd(m, gl) {
          renderer = new THREE.WebGLRenderer({ canvas: m.getCanvas(), context: gl, antialias: true });
          renderer.autoClear = false;
          renderer.shadowMap.enabled = true;
          renderer.shadowMap.type = THREE.PCFSoftShadowMap;
          renderer.toneMapping = THREE.ACESFilmicToneMapping;
          renderer.toneMappingExposure = 0.76; // matches the muted city buildings (buildings.js)
          // Render into whatever framebuffer the map is drawing to (Mapbox may use an
          // offscreen target); three's "null" target means the host framebuffer here.
          const bind = renderer.state.bindFramebuffer.bind(renderer.state);
          renderer.state.bindFramebuffer = (target, fb) => bind(target, fb === null ? hostFbo : fb);
          const pmrem = new THREE.PMREMGenerator(renderer);
          envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
          scene.environment = envTex;
          pmrem.dispose();
        },
        render(gl, matrix) {
          if (!active || !active.ready) return;
          const mat = Array.isArray(matrix) || ArrayBuffer.isView(matrix) ? matrix : (matrix && (matrix.projectionMatrix || matrix.defaultProjectionData && matrix.defaultProjectionData.mainMatrix));
          hostFbo = gl.getParameter(gl.FRAMEBUFFER_BINDING);
          const vp = gl.getParameter(gl.VIEWPORT);
          const proj = new THREE.Matrix4().fromArray(Array.from(mat));
          camera.projectionMatrix = proj.multiply(active.modelMatrix);
          camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
          // Critical facilities pulse.
          const crit = active.risk >= 0.75;
          if (crit) {
            const t = performance.now() / 1000, p = 0.5 + 0.5 * Math.sin(t * 3.4);
            ring.material.opacity = 0.55 + 0.45 * p;
            halo.material.opacity = 0.45 + 0.35 * p;
          }
          renderer.resetState();
          renderer.setViewport(vp[0], vp[1], vp[2], vp[3]);
          renderer.render(scene, camera);
          if (crit) m_triggerRepaint();
        },
        onRemove() { if (renderer) renderer.dispose(); },
        // ── controller hooks ──
        _scene: scene, _pivot: pivot, _sun: sun, _hemi: hemi, _catcher: catcher, _ring: ring, _halo: halo,
        _env: () => envTex,
      };
    }
    const m_triggerRepaint = () => map.triggerRepaint();

    function haloTexture() {
      const c = document.createElement('canvas'); c.width = c.height = 256;
      const g = c.getContext('2d');
      const grad = g.createRadialGradient(128, 128, 60, 128, 128, 128);
      grad.addColorStop(0, 'rgba(255,255,255,0)'); grad.addColorStop(0.72, 'rgba(255,255,255,0.10)'); grad.addColorStop(0.97, 'rgba(255,255,255,0.55)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad; g.fillRect(0, 0, 256, 256);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      return t;
    }

    function ensureLayer() {
      if (layer) return;
      layer = buildLayer();
      if (tm.slot) layer.slot = 'middle';
      const before = map.getLayer('radar') ? 'radar' : map.getLayer('arcs-confirmed') ? 'arcs-confirmed' : undefined;
      tm.slot ? map.addLayer(layer) : map.addLayer(layer, before);
      applyDaylight();
    }

    function modelMatrix(f, kind) {
      const site = sites[F.indexOf(f)] || {};
      const elev = kind === 'weather' ? site.roof || 0 : 0;
      const mc = GL.MercatorCoordinate.fromLngLat(f.lngLat, elev);
      const s = mc.meterInMercatorCoordinateUnits();
      return new THREE.Matrix4().makeTranslation(mc.x, mc.y, mc.z)
        .scale(new THREE.Vector3(s, -s, s))
        .multiply(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(1, 0, 0), Math.PI / 2));
    }

    // Focus the hero model on facility i (null to clear). Returns once it is shown.
    async function focus(i) {
      const token = ++focusToken;
      const f = i == null ? null : F[i], kind = f && MODEL_OF(f);
      if (!f) { clear(); return; }
      if (!kind) return; // no model for this facility: keep the current one
      try {
        await loadThree();
        ensureLayer();
        const model = await loadModel(kind);
        if (token !== focusToken) return; // superseded by another selection
        const site = sites[i] || {};
        const L = layer;
        L._pivot.clear();
        L._pivot.add(model.scene);
        // Local +x follows the site's heading (bearing clockwise from north).
        L._pivot.rotation.y = THREE.MathUtils.degToRad(90 - (site.heading || 0));
        const R = SITE_RADIUS[kind];
        L._ring.scale.set(R, R, 1); L._halo.scale.set(R * 1.12, R * 1.12, 1);
        L._catcher.scale.set(R * 6, R * 6, 1);
        const sc = L._sun.shadow.camera;
        sc.left = sc.bottom = -R * 1.6; sc.right = sc.top = R * 1.6; sc.near = 1; sc.far = R * 12;
        sc.updateProjectionMatrix();
        active = { i, kind, ready: true, risk: risk ? risk[i] : 0, modelMatrix: modelMatrix(f, kind) };
        applyRisk();
        applyDaylight();
        if (opts.onShow) opts.onShow(i);
        map.triggerRepaint();
      } catch (e) {
        console.warn('Hero model unavailable:', e && e.message ? e.message : e);
      }
    }
    function clear() {
      if (active && opts.onHide) opts.onHide(active.i);
      active = null;
      if (layer) { layer._pivot.clear(); map.triggerRepaint(); }
    }

    function applyRisk() {
      if (!active || !layer) return;
      const col = new THREE.Color(C.riskColor(active.risk));
      layer._ring.material.color.copy(col);
      layer._halo.material.color.copy(col);
      if (active.risk < 0.75) { layer._ring.material.opacity = 0.85; layer._halo.material.opacity = active.risk >= 0.55 ? 0.7 : 0.5; }
    }
    function update(R) {
      risk = R;
      if (active) { active.risk = R[active.i]; applyRisk(); map.triggerRepaint(); }
    }

    // Sun, sky fill, exposure and night lighting from the simulation clock.
    function applyDaylight() {
      if (!layer || !daylight) return;
      const { sun, phase } = daylight;
      const r = Math.PI / 180;
      const up = sun.elevation > 2;
      const az = (up ? sun.azimuth : 215) * r, el = (up ? Math.max(sun.elevation, 6) : 38) * r;
      const d = 400;
      layer._sun.position.set(Math.sin(az) * Math.cos(el) * d, Math.sin(el) * d, -Math.cos(az) * Math.cos(el) * d);
      layer._sun.target.position.set(0, 0, 0);
      const P = {
        day: { sun: '#fff3df', si: 2.6, sky: '#c8d6e6', gnd: '#3a342c', hi: 0.7, env: 0.6 },
        dawn: { sun: '#ffc08a', si: 1.6, sky: '#8c8fb0', gnd: '#2c2622', hi: 0.45, env: 0.38 },
        dusk: { sun: '#ff9f68', si: 1.5, sky: '#7d7aa2', gnd: '#2a2420', hi: 0.42, env: 0.35 },
        night: { sun: '#9fb6e8', si: 0.22, sky: '#2b3a58', gnd: '#0e0f12', hi: 0.16, env: 0.1 },
      }[phase];
      layer._sun.color.set(P.sun); layer._sun.intensity = P.si;
      layer._hemi.color.set(P.sky); layer._hemi.groundColor.set(P.gnd); layer._hemi.intensity = P.hi;
      layer._scene.environmentIntensity = P.env;
      layer._catcher.material.opacity = phase === 'night' ? 0.12 : phase === 'day' ? 0.42 : 0.3;
      // Lit windows follow the same curve as the city's (buildings.js).
      const t = Math.max(0, Math.min(1, (sun.elevation + 8) / 14));
      const night = 1 - t * t * (3 - 2 * t);
      for (const p of Object.values(models)) p.then((mdl) => mdl.scene.traverse((o) => {
        if (!o.isMesh || !o.material.userData.dayEmissive) return;
        const m = o.material;
        if (m.name === 'glassLit') { m.emissive.set('#ffcf8a'); m.emissiveIntensity = 0.55 * night; }
        if (m.name === 'lamp') { m.emissive.set('#ffe2b0'); m.emissiveIntensity = 2.5 * night; }
      })).catch(() => {});
      map.triggerRepaint();
    }
    tm.onDaylight((dl) => { daylight = dl; applyDaylight(); });

    return { focus, update, clear, get active() { return active && active.i; }, MODEL_OF };
  }

  root.TWIN.heroes = { install, MODEL_OF: (f) => MODEL_OF(f) };
})(typeof window !== 'undefined' ? window : globalThis);
