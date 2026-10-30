// Runs before the first paint, independently of the application's deferred modules.
// This marker controls presentation only; it never grants access or contains credentials.
(() => {
  const root = document.documentElement;
  try {
    const theme = localStorage.getItem('mesa-theme') === 'light' ? 'light' : 'dark';
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    const key = 'mesa:branch-transition';
    const pending = JSON.parse(sessionStorage.getItem(key) || 'null');
    if (!pending) return;
    const valid =
      /^[a-z0-9-]{1,80}$/.test(pending.slug) &&
      /^[a-f0-9-]{36}$/.test(pending.unitId) &&
      Number.isFinite(pending.startedAt) &&
      Date.now() - pending.startedAt >= 0 &&
      Date.now() - pending.startedAt < 120000 &&
      (location.pathname.startsWith('/' + pending.slug + '/') ||
        location.pathname.startsWith('/pwa/' + pending.unitId + '/'));
    if (!valid) {
      sessionStorage.removeItem(key);
      return;
    }
    const fallbacks =
      theme === 'light'
        ? { background: '#f3f6fb', text: '#17243b', muted: '#64748b', accent: '#1679ee' }
        : { background: '#090e1a', text: '#e2e8f0', muted: '#94a3b8', accent: '#2584f8' };
    for (const [name, fallback] of Object.entries(fallbacks)) {
      const color = /^#[a-f0-9]{6}$/i.test(pending[name]) ? pending[name] : fallback;
      root.style.setProperty('--mesa-transition-' + name, color);
    }
    root.setAttribute('data-mesa-branch-loading', '');
  } catch {
    // A malformed or unavailable storage entry must not block normal login.
  }
})();
