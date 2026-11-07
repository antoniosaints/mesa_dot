import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, useAppearance } from './appearance.js';
import { MenuTransition, useMenuTransition } from './menu-transition.js';

export function AppShell({
  sidebarOpen,
  sidebarCollapsed,
  children,
}: {
  sidebarOpen: boolean;
  sidebarCollapsed: boolean;
  children: ReactNode;
}) {
  const { interfaceStyle } = useAppearance();
  return (
    <div
      className={[
        'admin-layout',
        interfaceStyle === 'erp' ? 'mesa-erp' : '',
        sidebarOpen ? 'sidebar-open' : '',
        sidebarCollapsed ? 'sidebar-collapsed' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-interface={interfaceStyle}
    >
      {children}
    </div>
  );
}

export function AppSidebar({
  children,
  open,
  onClose,
}: {
  children: ReactNode;
  open: boolean;
  onClose: () => void;
}) {
  const { interfaceStyle } = useAppearance();
  const panel = useRef<HTMLElement>(null);
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 900px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 900px)');
    const update = () => setMobile(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open || !mobile || interfaceStyle !== 'erp') return;
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !panel.current?.contains(event.target as Node)) return;
      if (event.key === 'Escape' && panel.current?.contains(event.target as Node)) {
        event.preventDefault();
        close.current();
      }
      if (event.key === 'Tab') {
        const buttons = [
          ...panel.current.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]',
          ),
        ].filter((element) => element.getClientRects().length > 0);
        const first = buttons[0],
          last = buttons[buttons.length - 1];
        if (
          (event.shiftKey && document.activeElement === first) ||
          (!event.shiftKey && document.activeElement === last)
        ) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
        }
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('keydown', keydown);
      if (previous?.isConnected && panel.current?.contains(document.activeElement))
        previous.focus();
    };
  }, [open, mobile, interfaceStyle]);
  return (
    <aside
      ref={panel}
      id="admin-sidebar"
      className="sidebar"
      aria-label="Menu lateral"
      inert={interfaceStyle === 'erp' && mobile && !open}
    >
      {children}
    </aside>
  );
}

export function AppTopbar({ children }: { children: ReactNode }) {
  return <header className="topbar">{children}</header>;
}

/** Animate navigation without keying/remounting forms, queries or modal owners. */
export function AppPageContent({
  page,
  label,
  children,
}: {
  page: string;
  label: string;
  children: ReactNode;
}) {
  const { interfaceStyle } = useAppearance();
  const loading = useMenuTransition(page, interfaceStyle === 'erp');
  const content = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = content.current;
    if (!element || interfaceStyle !== 'erp') return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (motion.matches) return;
    const styles = getComputedStyle(element);
    const animation = element.animate([{ opacity: 0.65 }, { opacity: 1 }], {
      duration: parseFloat(styles.getPropertyValue('--motion-fast')) || 120,
      easing: styles.getPropertyValue('--motion-ease').trim() || 'ease-out',
    });
    const cancel = () => animation.cancel();
    motion.addEventListener('change', cancel);
    return () => {
      motion.removeEventListener('change', cancel);
      animation.cancel();
    };
  }, [page, interfaceStyle]);
  return (
    <div className="page-content" ref={content}>
      {loading && <MenuTransition label={label} />}
      {children}
    </div>
  );
}

/** Keep the same controls mounted while moving secondary utilities into a small-screen popover. */
export function HeaderUtilities({ children }: { children: ReactNode }) {
  const { interfaceStyle } = useAppearance();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const pointerdown = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && container.current?.contains(event.target as Node)) {
        event.preventDefault();
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', pointerdown);
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('pointerdown', pointerdown);
      document.removeEventListener('keydown', keydown);
    };
  }, [open]);
  if (interfaceStyle !== 'erp') return children;
  return (
    <div ref={container} className={'erp-header-utilities' + (open ? ' is-open' : '')}>
      <button
        ref={trigger}
        className="icon-button erp-utilities-trigger"
        aria-label="Ferramentas da estação"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        <Icon name="filters" />
      </button>
      <div id={id} className="erp-utilities-panel" role="group" aria-label="Ferramentas da estação">
        {children}
      </div>
    </div>
  );
}
