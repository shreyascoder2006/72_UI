/* Page router over the shared context (store.js). Each page registers a path, which may
   end in a parameter ('/crises/:id'), and a view { mount(ctx, params), unmount(),
   update(ctx, changed) }. Pages stay in the same document, so the engine and the 3D
   city are built once and shared. Unknown paths go to the overview with a note, rather
   than to an empty screen. */
(function (root) {
  const T = root.TWIN;
  const routes = []; // { re, keys, view }
  let current = null, currentPath = null;
  const DEFAULT = '/';

  function match(path) {
    for (const r of routes) {
      const m = r.re.exec(path);
      if (m) return { view: r.view, params: Object.fromEntries(r.keys.map((k, n) => [k, decodeURIComponent(m[n + 1])])) };
    }
    return null;
  }

  function show(path, ctx) {
    const hit = match(path);
    if (!hit) {
      const asked = path;
      T.store.go(DEFAULT, { replace: true });
      T.site.toast(`<b>Not found</b><span>There is no page at #${asked.replace(/[<>&"]/g, '')}. Showing the overview.</span>`);
      return;
    }
    if (path === currentPath) return;
    if (current && current.unmount) current.unmount();
    current = hit.view; currentPath = path;
    document.title = `${typeof current.title === 'function' ? current.title(hit.params) : current.title} · Cascade Intelligence`;
    current.mount(ctx, hit.params);
  }

  T.router = {
    register(pattern, view) {
      const keys = [];
      const src = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; });
      routes.push({ re: new RegExp('^' + src + '/?$'), keys, view });
    },
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
