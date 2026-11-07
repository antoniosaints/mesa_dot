import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { observeApiReads } from './api-activity.js';

/** Only reads started by this navigation count; background refreshes stay local. */
export function useMenuTransition(page: string, enabled: boolean) {
  const [visiblePage, setVisiblePage] = useState<string | null>(null);
  const settle = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    setVisiblePage(null);
    if (!enabled) return;
    let active = true;
    let pending = 0;
    let reveal: ReturnType<typeof setTimeout> | undefined;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const finishIfIdle = () => {
      clearTimeout(idle);
      // Let all mount effects and chained reads register before ending capture.
      idle = setTimeout(() => {
        if (pending === 0) {
          active = false;
          stop();
        }
      }, 0);
    };
    const stop = observeApiReads(() => {
      clearTimeout(idle);
      if (pending++ === 0)
        reveal = setTimeout(() => {
          if (active && pending > 0) setVisiblePage(page);
        }, 120);
      return () => {
        if (!active) return;
        if (--pending === 0) {
          clearTimeout(reveal);
          setVisiblePage(null);
          finishIfIdle();
        }
      };
    });
    settle.current = finishIfIdle;
    return () => {
      active = false;
      stop();
      clearTimeout(reveal);
      clearTimeout(idle);
      settle.current = () => {};
    };
  }, [page, enabled]);
  useEffect(() => settle.current(), [page, enabled]);
  return enabled && visiblePage === page;
}

/** A table with four seats and a receipt: the two central objects of Mesa. */
export function MenuTransition({ label }: { label: string }) {
  return (
    <div className="erp-menu-transition">
      <div className="erp-menu-transition-card" role="status" aria-live="polite" aria-atomic="true">
        <svg width="72" height="72" viewBox="0 0 96 96" fill="none" aria-hidden="true">
          <g stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <rect className="erp-loading-seat seat-one" x="33" y="5" width="30" height="9" rx="4" />
            <rect
              className="erp-loading-seat seat-two"
              x="82"
              y="33"
              width="9"
              height="30"
              rx="4"
            />
            <rect
              className="erp-loading-seat seat-three"
              x="33"
              y="82"
              width="30"
              height="9"
              rx="4"
            />
            <rect
              className="erp-loading-seat seat-four"
              x="5"
              y="33"
              width="9"
              height="30"
              rx="4"
            />
            <rect className="erp-loading-table" x="21" y="21" width="54" height="54" rx="14" />
            <g className="erp-loading-receipt">
              <path d="M36 32h24v33l-4-3-4 3-4-3-4 3-4-3-4 3V32Z" />
              <path className="erp-loading-line" pathLength="1" d="M42 40h12M42 47h12" />
              <path className="erp-loading-check" pathLength="1" d="m43 55 4 4 7-7" />
            </g>
          </g>
        </svg>
        <span>Carregando {label}…</span>
      </div>
    </div>
  );
}
