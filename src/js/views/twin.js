/* The digital twin (operations room) as the #/twin page. The app in src/js/ui/app.js is
   built on first visit and kept alive (paused while another page is in front); its
   scenario, time, mode, selection and crisis follow the shared context. */
(function (root) {
  const T = root.TWIN;
  let booted = false;
  const el = () => document.getElementById('app');

  T.router.register('/twin', {
    title: 'Digital twin',
    mount(ctx) {
      document.getElementById('site').hidden = true;
      el().classList.remove('view-off');
      if (!booted) { booted = true; T.app.boot(ctx); return; }
      if (!T.app.engine) return; // still starting
      // A city's map, tiles and meshes are built once per page load.
      if (ctx.city && ctx.city !== T.app.geo.id) { location.reload(); return; }
      T.core.setTZ(T.app.geo.tz, T.app.geo.tzLabel);
      T.app.pause(false);
      T.app.syncContext(ctx);
    },
    unmount() { el().classList.add('view-off'); if (T.app.engine) T.app.pause(true); },
    update(ctx, changed) { T.app.applyContext(ctx, changed); },
  });
})(typeof window !== 'undefined' ? window : globalThis);
