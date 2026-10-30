import { useEffect, useRef } from 'react';
import { Icon } from './appearance.js';
import { useToasts } from './toasts.js';
import type { Data } from './client.js';
export function useClientRequestAlerts(scope: string, requests: Data[]) {
  const previous = useRef({ scope: '', seen: new Set<string>() });
  const toast = useToasts();
  useEffect(() => {
    if (previous.current.scope !== scope) previous.current = { scope, seen: new Set() };
    if (!scope) return;
    const added = requests.filter((request) => !previous.current.seen.has(request.id));
    for (const request of requests) previous.current.seen.add(request.id);
    if (added.length === 1)
      toast.info(
        'Cliente na mesa ' +
          (added[0].ticket?.table_number ?? '—') +
          ' solicitou ' +
          (added[0].ticket?.product ?? 'uma entrega') +
          '. Confira as solicitações.',
      );
    else if (added.length > 1)
      toast.info(added.length + ' novas solicitações de clientes. Confira as mesas com alerta.');
  }, [scope, requests]);
}
export function ClientRequestBanner({ tables, onOpen }: { tables: Data[]; onOpen?: () => void }) {
  const pending = tables.filter((table) => Number(table.service_request_count) > 0);
  const count = pending.reduce((sum, table) => sum + Number(table.service_request_count), 0);
  if (!count) return null;
  return (
    <section className="client-request-banner" aria-label="Solicitações de clientes">
      <Icon name="bell" />
      <div>
        <strong role="status">{count} solicitação(ões) de clientes aguardando entrega</strong>
        <p>
          Mesas {pending.map((table) => table.number).join(', ')}. O alerta permanece até a entrega
          ou o cancelamento da solicitação.
        </p>
      </div>
      {onOpen && (
        <button onClick={onOpen}>
          <Icon name="eye" size={17} />
          Ver solicitações
        </button>
      )}
    </section>
  );
}
