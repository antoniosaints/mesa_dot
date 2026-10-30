/** Visual handoff only. Authentication and branch scope still come from the server-issued session. */
export const branchTransitionKey = 'mesa:branch-transition';
export function prepareBranchTransition(slug: string, unitId: string) {
  const colors = getComputedStyle(document.documentElement);
  const color = (name: string, fallback: string) => {
    const value = colors.getPropertyValue(name).trim();
    return /^#[a-f0-9]{6}$/i.test(value) ? value : fallback;
  };
  try {
    sessionStorage.setItem(
      branchTransitionKey,
      JSON.stringify({
        slug,
        unitId,
        startedAt: Date.now(),
        background: color('--bg', '#090e1a'),
        text: color('--text', '#e2e8f0'),
        muted: color('--muted', '#94a3b8'),
        accent: color('--accent-ink', color('--blue', '#2584f8')),
      }),
    );
  } catch {
    // Navigation must still work when browser storage is unavailable.
  }
}
export function branchTransitionVisible() {
  return document.documentElement.hasAttribute('data-mesa-branch-loading');
}
export function finishBranchTransition() {
  if (!branchTransitionVisible()) return;
  document.getElementById('mesa-boot-loading')?.remove();
  document.documentElement.removeAttribute('data-mesa-branch-loading');
  try {
    sessionStorage.removeItem(branchTransitionKey);
  } catch {
    /* Storage may be disabled. */
  }
}
