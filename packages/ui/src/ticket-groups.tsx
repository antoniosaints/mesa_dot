import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './appearance.js';
import { Empty, Badge } from './common.js';
import type { Data } from './client.js';
import { shortId, operationTime } from './operation-format.js';
import { TicketList } from './ticket-list.js';
import { groupTickets, requestedTickets } from './ticket-grouping.js';
export function GroupedTickets({
  tickets,
  onSelect,
  onOrder,
  onDeliver,
  autoExpand = 'none',
}: {
  tickets: Data[];
  onSelect?: (ticket: Data) => void;
  onOrder?: (id: string) => void;
  onDeliver?: (ticket: Data) => void;
  autoExpand?: 'none' | 'requests' | 'all';
}) {
  const groups = useMemo(() => groupTickets(tickets), [tickets]);
  const [expanded, setExpanded] = useState(new Set<string>());
  const seen = useRef(new Set<string>());
  useEffect(() => {
    const keys: string[] = [];
    for (const table of groups)
      for (const attendance of table.attendances) {
        if (
          autoExpand !== 'none' &&
          !seen.current.has(attendance.id) &&
          (autoExpand === 'all' || requestedTickets(attendance.tickets) > 0)
        ) {
          keys.push('mesa:' + table.id, attendance.id);
          seen.current.add(attendance.id);
        }
      }
    if (keys.length) setExpanded((previous) => new Set([...previous, ...keys]));
  }, [groups, autoExpand]);
  function toggle(key: string, children: string[] = []) {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else {
        next.add(key);
        for (const child of children) next.add(child);
      }
      return next;
    });
  }
  if (!groups.length)
    return (
      <Empty>
        Nenhuma ficha encontrada para este filtro. As fichas são organizadas por mesa, atendimento e
        comanda assim que o pedido é confirmado.
      </Empty>
    );
  return (
    <div className="grouped-tickets">
      <div className="ticket-group-controls">
        <p className="muted small">
          Expanda a mesa e o atendimento para ver as comandas, os pedidos e suas fichas.
          Atendimentos encerrados ficam separados.
        </p>
        <div className="button-row">
          <button
            onClick={() =>
              setExpanded(
                new Set(
                  groups.flatMap((table) => [
                    'mesa:' + table.id,
                    ...table.attendances.map((attendance) => attendance.id),
                  ]),
                ),
              )
            }
          >
            <Icon name="plus" size={15} />
            Expandir atendimentos
          </button>
          <button onClick={() => setExpanded(new Set())}>
            <Icon name="minus" size={15} />
            Recolher atendimentos
          </button>
        </div>
      </div>
      {groups.map((table) => (
        <details
          className="ticket-table-group"
          key={table.id}
          open={expanded.has('mesa:' + table.id)}
          data-table-id={table.id}
        >
          <summary
            onClick={(event) => {
              event.preventDefault();
              toggle(
                'mesa:' + table.id,
                table.attendances
                  .filter((attendance) => attendance.status !== 'CLOSED')
                  .map((attendance) => attendance.id),
              );
            }}
          >
            <Icon name="chevron" size={18} />
            <Icon name="tables" />
            <div>
              <strong>{table.id === 'COUNTER' ? table.number : 'Mesa ' + table.number}</strong>
              <small>
                {table.attendances.length} atendimento(s) · {table.tickets.length} ficha(s) ·{' '}
                {table.tickets.filter((ticket) => ticket.status === 'REDEEMED').length} entregue(s)
              </small>
            </div>
            {requestedTickets(table.tickets) > 0 && (
              <span className="client-request-count">
                <Icon name="bell" size={15} />
                {requestedTickets(table.tickets)} solicitação(ões)
              </span>
            )}
          </summary>
          <div className="ticket-table-content">
            {table.attendances.map((attendance) => (
              <details
                className="ticket-attendance-group"
                key={attendance.id}
                open={expanded.has(attendance.id)}
                data-attendance-id={attendance.id}
              >
                <summary
                  onClick={(event) => {
                    event.preventDefault();
                    toggle(attendance.id);
                  }}
                >
                  <Icon name="chevron" size={16} />
                  <div>
                    <strong>
                      {attendance.status === 'CLOSED'
                        ? 'Atendimento encerrado'
                        : 'Atendimento atual'}
                    </strong>
                    <small>
                      Iniciado em {operationTime(attendance.startedAt)} · {attendance.tabs.length}{' '}
                      comanda(s) ·{' '}
                      {new Set(attendance.tickets.map((ticket) => ticket.order_id)).size} pedido(s)
                    </small>
                  </div>
                  <Badge status={attendance.status} />
                </summary>
                <div className="attendance-commandas">
                  {attendance.tabs.map((tab) => (
                    <section className="ticket-tab-group" key={tab.id} data-tab-id={tab.id}>
                      <div className="section-head">
                        <div>
                          <h3>
                            <Icon name="receipt" size={17} />
                            {/^comanda\b/i.test(tab.label) ? tab.label : 'Comanda ' + tab.label}
                          </h3>
                          <p className="muted small">
                            {tab.mode === 'SHARED' ? 'Compartilhada' : 'Individual'} ·{' '}
                            {tab.orders.length} pedido(s) · {tab.tickets.length} ficha(s)
                          </p>
                        </div>
                        {requestedTickets(tab.tickets) > 0 && (
                          <span className="client-request-count">
                            {requestedTickets(tab.tickets)} solicitação(ões)
                          </span>
                        )}
                      </div>
                      {tab.orders.map((order) => (
                        <section className="ticket-order-group" key={order.id}>
                          <div className="section-head">
                            <div>
                              <strong>Pedido {shortId(order.id)}</strong>
                              <p className="muted small">
                                {operationTime(
                                  order.tickets[0]?.created_at_iso ?? order.tickets[0]?.created_at,
                                )}{' '}
                                · {order.tickets.length} ficha(s) nesta comanda
                              </p>
                            </div>
                            {onOrder && (
                              <button onClick={() => onOrder(order.id)}>
                                <Icon name="orders" size={16} />
                                Ver pedido
                              </button>
                            )}
                          </div>
                          <TicketList
                            tickets={order.tickets}
                            onSelect={onSelect}
                            onDeliver={onDeliver}
                            compact
                          />
                        </section>
                      ))}
                    </section>
                  ))}
                </div>
              </details>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}
