/* Page router over the shared context (store.js). Each page registers a path and a view
   { mount(ctx), unmount(), update(ctx, changed) }. Pages stay in the same document, so
   the engine and the 3D city are built once and shared. Unknown paths go to the default
   page with a note, rather than to an empty screen. */
(function (root) {
  const T = root.TWIN;
  const views = new Map();
  let current = null, currentPath = null;
  const DEFAULT = '/twin';

  function show(path, ctx) {
    if (!views.has(path)) {
      const asked = path;
      T.store.go(DEFAULT, { replace: true });
      if (asked !== '/' && T.app && T.app.toast) T.app.toast(`<b>Not found</b><span>There is no page at #${asked.replace(/[<>&"]/g, '')}. Showing the digital twin.</span>`);
      return;
    }
    if (path === currentPath) return;
    if (current && current.unmount) current.unmount();
    current = views.get(path); currentPath = path;
    if (current.title) document.title = `${current.title} · Raleigh Digital Twin`;
    current.mount(ctx);
  }

  T.router = {
    register(path, view) { views.set(path, view); },
    get path() { return currentPath; },
    start() {
      const first = T.store.start();
      T.store.on(({ path, ctx, changed, moved }) => {
        if (moved) show(path, ctx);
        else if (changed.length && current && current.update) current.update(ctx, changed);
      });
      show(first.path, first.ctx);
    },
  };

  window.addEventListener('DOMContentLoaded', () => T.router.start());
})(typeof window !== 'undefined' ? window : globalThis);
