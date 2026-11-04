import { useId, useLayoutEffect, useRef, useState } from 'react';
import { useInterfaceSurface } from './interface-scope.js';
import { createPortal } from 'react-dom';
import { ChevronDown, FileText, Printer } from 'lucide-react';
import { session } from './client.js';
import { shortId } from './operation-format.js';
import { ReceiptDialog, ReceiptPdfDialog } from './receipt-button.js';

export function ReceiptMenuButton({ scope, id }: { scope: 'ORDER' | 'TAB'; id: string }) {
  const interfaceSurface = useInterfaceSurface();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<'PDF' | 'THERMAL' | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const trigger = useRef<HTMLButtonElement>(null),
    menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const label = 'Imprimir ' + (scope === 'ORDER' ? 'pedido ' : 'comanda ') + shortId(id);
  useLayoutEffect(() => {
    if (!open || !trigger.current || !menu.current) return;
    const anchor = trigger.current.getBoundingClientRect();
    const bounds = menu.current.getBoundingClientRect();
    setPosition({
      left: Math.max(
        8,
        Math.min(anchor.right - bounds.width, window.innerWidth - bounds.width - 8),
      ),
      top:
        anchor.bottom + bounds.height + 8 <= window.innerHeight
          ? anchor.bottom + 6
          : Math.max(8, anchor.top - bounds.height - 6),
    });
    menu.current.querySelector('button')?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (
        !menu.current?.contains(event.target as Node) &&
        !trigger.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    const dismiss = () => setOpen(false);
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, [open]);
  if (session()?.actor?.kind !== 'STAFF' || !session()?.actor?.permissions?.includes('table.view'))
    return null;
  function choose(value: 'PDF' | 'THERMAL') {
    trigger.current?.focus({ preventScroll: true });
    setOpen(false);
    setDialog(value);
  }
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="receipt-menu-trigger"
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Printer size={15} />
        <ChevronDown size={11} />
      </button>
      {open &&
        createPortal(
          <div
            ref={menu}
            id={menuId}
            className={['receipt-action-menu', interfaceSurface].filter(Boolean).join(' ')}
            role="menu"
            aria-label={label}
            style={position}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                setOpen(false);
                trigger.current?.focus({ preventScroll: true });
              }
              if (event.key === 'Tab') {
                setOpen(false);
                trigger.current?.focus({ preventScroll: true });
              }
              if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                const items = [...menu.current!.querySelectorAll('button')];
                const index = items.indexOf(document.activeElement as HTMLButtonElement);
                const next =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? items.length - 1
                      : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) %
                        items.length;
                items[next]?.focus({ preventScroll: true });
              }
            }}
          >
            <button
              type="button"
              role="menuitem"
              aria-label="PDF · Visualizar cupom"
              onClick={() => choose('PDF')}
            >
              <FileText size={18} />
              <span>
                <strong>PDF</strong>
                <small>Visualizar antes de baixar</small>
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              aria-label="Cupom · Impressora térmica"
              onClick={() => choose('THERMAL')}
            >
              <Printer size={18} />
              <span>
                <strong>Cupom</strong>
                <small>Enviar à impressora térmica</small>
              </span>
            </button>
          </div>,
          document.body,
        )}
      {dialog === 'PDF' && (
        <ReceiptPdfDialog scope={scope} id={id} onClose={() => setDialog(null)} />
      )}
      {dialog === 'THERMAL' && (
        <ReceiptDialog scope={scope} id={id} onClose={() => setDialog(null)} />
      )}
    </>
  );
}
