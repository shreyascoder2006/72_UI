/* The digital twin, mounted at two routes that share one app, one map and one timeline
   (src/js/ui/app.js; built on first visit, kept alive and paused while another page is
   in front):
   - #/       Situation: the briefing. Outlook panel, next-crossings strip, camera on the
              leading hazard. "What is happening and what comes next?"
   - #/twin   City twin: free investigation. Asset inventory, layers, alerts.
   Scenario, time, mode, selection and crisis follow the shared context in both. */
(function (root) {
  const T = root.TWIN;
  let booted = false;
  const el = () => document.getElementById('app');

  const view = (mode, title) => ({
    title,
    mount(ctx) {
      document.getElementById('site').hidden = true;
      el().classList.remove('view-off');
      if (!booted) { booted = true; T.app.boot(ctx, mode); return; }
      // Still starting: the view applies when the twin is up.
      if (!T.app.engine) { T.app.state.viewMode = mode; el().classList.toggle('situation', mode === 'situation'); return; }
      // A city's map, tiles and meshes are built once per page load.
      if (ctx.city && ctx.city !== T.app.geo.id) { location.reload(); return; }
      T.core.setTZ(T.app.geo.tz, T.app.geo.tzLabel);
      T.app.pause(false);
      T.app.setView(mode);
      T.app.syncContext(ctx);
    },
    unmount() { el().classList.add('view-off'); if (T.app.engine) T.app.pause(true); },
    update(ctx, changed) { T.app.applyContext(ctx, changed); },
  });
  T.router.register('/', view('situation', 'Situation'));
  T.router.register('/twin', view('twin', 'Digital twin'));
})(typeof window !== 'undefined' ? window : globalThis);
