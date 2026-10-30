import { useEffect, useState } from 'react';
export const sidebarPreferenceKey = (scope: string) => 'mesa-sidebar-collapsed:' + scope;
export function readSidebarCollapsed(scope: string) {
  try {
    return Boolean(scope) && localStorage.getItem(sidebarPreferenceKey(scope)) === 'true';
  } catch {
    return false;
  }
}
export function useSidebarPreference(scope: string) {
  const [saved, setSaved] = useState({ scope, collapsed: readSidebarCollapsed(scope) });
  const [desktop, setDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 901px)').matches,
  );
  useEffect(() => {
    setSaved({ scope, collapsed: readSidebarCollapsed(scope) });
  }, [scope]);
  useEffect(() => {
    const media = window.matchMedia('(min-width: 901px)');
    const update = () => setDesktop(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const collapsed = saved.scope === scope ? saved.collapsed : readSidebarCollapsed(scope);
  return {
    collapsed,
    compact: desktop && collapsed,
    toggle: () => {
      const next = !collapsed;
      setSaved({ scope, collapsed: next });
      try {
        if (scope) localStorage.setItem(sidebarPreferenceKey(scope), String(next));
      } catch {
        /* The menu remains usable without browser storage. */
      }
    },
  };
}
