/* The digital twin (operations room) as the #/twin page. The app in src/js/ui/app.js is
   built on first visit and kept alive; its scenario, time, mode and selection follow the
   shared context. */
(function (root) {
  const T = root.TWIN;
  let booted = false;
  const el = () => document.getElementById('app');

  T.router.register('/twin', {
    title: 'Digital twin',
    mount(ctx) {
      el().classList.remove('view-off');
      if (!booted) { booted = true; T.app.boot(ctx); }
    },
    unmount() { el().classList.add('view-off'); },
    update(ctx, changed) { T.app.applyContext(ctx, changed); },
  });
})(typeof window !== 'undefined' ? window : globalThis);
