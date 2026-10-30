import { ReceiptButton } from './receipt-button.js';
import { useState } from 'react';
import { Icon } from './appearance.js';
import { Badge, Empty } from './common.js';
import { brl, type Data } from './client.js';
import { attendanceSummary } from './attendance-summary.js';
import { shortId, operationTime } from './operation-format.js';
export function AttendanceTotals({
  tabs,
  tickets,
  showTickets,
  showMoney = true,
}: {
  tabs: Data[];
  tickets: Data[];
  showTickets: boolean;
  showMoney?: boolean;
}) {
  const summary = attendanceSummary(tabs, tickets);
  return (
    <div
      className="attendance-summary"
      aria-label={showMoney ? 'Resumo financeiro da mesa' : 'Resumo operacional da mesa'}
    >
      {showMoney && (
        <div className="attendance-money">
          <div>
            <span>
              <Icon name="receipt" size={17} /> Total da mesa
            </span>
            <strong>{brl(summary.total)}</strong>
            <small>Consumo após descontos e cancelamentos</small>
          </div>
          <div className="paid">
            <span>
              <Icon name="check" size={17} /> Pago
            </span>
            <strong>{brl(summary.paid)}</strong>
            <small>Recebimentos menos estornos</small>
          </div>
          <div className={Number(summary.balance) > 0 ? 'pending' : ''}>
            <span>
              <Icon name="payments" size={17} />{' '}
              {Number(summary.balance) < 0 ? 'Crédito a resolver' : 'Pendente'}
            </span>
            <strong>{brl(summary.balance)}</strong>
            <small>{tabs.length} comanda(s) neste atendimento</small>
          </div>
        </div>
      )}
      {showTickets && (
        <div className="attendance-progress" aria-label="Resumo das entregas">
          <span>
            <b>{summary.ordered}</b> unidades pedidas
          </span>
          <span className="delivered">
            <Icon name="ready" size={16} />
            <b>{summary.delivered}</b> entregues
          </span>
          <span>
            <Icon name="clock" size={16} />
            <b>{summary.pending}</b> a entregar
            {summary.preparing > 0 ? ` · ${summary.preparing} em preparo` : ''}
          </span>
          {summary.requested > 0 && (
            <span className="pending">
              <Icon name="bell" size={16} />
              <b>{summary.requested}</b> solicitadas pelo cliente
            </span>
          )}
        </div>
      )}
    </div>
  );
}
export function AttendanceOverview({
  tabs,
  contents,
  orders,
  tickets,
  onOrder,
  onCancel,
  onNew,
  onReceive,
  onDeliveries,
  canOrder,
}: {
  tabs: Data[];
  contents: Data[];
  orders: Data[];
  tickets: Data[];
  onOrder: (id: string) => void;
  onCancel?: (order: Data) => void;
  onNew: (tabId: string) => void;
  onReceive?: (tabId: string) => void;
  onDeliveries: () => void;
  canOrder: boolean;
}) {
  const [filter, setFilter] = useState('all');
  const priority = (tab: Data) => {
    const units = tickets.filter(
      (ticket) =>
        ticket.tab_id === tab.id &&
        ticket.status !== 'CANCELLED' &&
        ticket.order_status === 'CONFIRMED',
    );
    if (units.some((ticket) => ticket.status !== 'REDEEMED')) return 3;
    if (units.length) return 2;
    return contents.find((entry) => entry.id === tab.id)?.items.length ? 1 : 0;
  };
  const orderedTabs = [...tabs].sort((a, b) => priority(b) - priority(a));
  return (
    <section className="stack attendance-overview">
      <div className="section-head">
        <div>
          <h3>O que foi pedido nesta mesa</h3>
          <p className="muted small">
            Consumo separado por comanda, com a entrega de cada item. Pedidos cancelados permanecem
            no histórico.
          </p>
        </div>
        <button onClick={onDeliveries}>
          <Icon name="ticket" size={17} /> Gerenciar entregas
        </button>
      </div>
      <div
        className="button-row attendance-filters"
        role="group"
        aria-label="Filtrar consumo da mesa"
      >
        {[
          ['all', 'Todos os itens'],
          ['pending', 'Falta entregar'],
          ['delivered', 'Já entregues'],
        ].map(([id, label]) => (
          <button
            key={id}
            aria-pressed={filter === id}
            className={filter === id ? 'active' : ''}
            onClick={() => setFilter(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {!tabs.length && (
        <Empty>
          Mesa livre. Confirme o primeiro pedido para iniciar o atendimento e criar a comanda
          compartilhada.
        </Empty>
      )}
      {orderedTabs.map((tab) => {
        const items: Data[] = contents.find((entry) => entry.id === tab.id)?.items ?? [];
        const relatedOrders = orders.filter(
          (order) => order.tab_id === tab.id || items.some((item) => item.order_id === order.id),
        );
        const tabTotal = attendanceSummary([tab], []);
        return (
          <article className="attendance-comanda" key={tab.id}>
            <div className="attendance-comanda-head">
              <div>
                <h3>
                  <Icon name="receipt" size={18} />
                  {tab.label}
                </h3>
                <small className="muted">
                  {tab.mode === 'SHARED' ? 'Conta compartilhada' : 'Conta individual'} ·{' '}
                  {tab.status === 'OPEN'
                    ? 'Aberta'
                    : tab.status === 'CLOSING'
                      ? 'Em fechamento'
                      : 'Encerrada'}
                </small>
              </div>
              <div className="attendance-tab-totals">
                <span>
                  Total <b>{brl(tabTotal.total)}</b>
                </span>
                <span>
                  Pago <b>{brl(tabTotal.paid)}</b>
                </span>
                <span>
                  Pendente <b>{brl(tabTotal.balance)}</b>
                </span>
              </div>
              <div className="button-row">
                <ReceiptButton scope="TAB" id={tab.id} label="Cupom da comanda" />
                {canOrder && tab.status === 'OPEN' && (
                  <button className="primary" onClick={() => onNew(tab.id)}>
                    <Icon name="plus" size={16} /> Adicionar pedido
                  </button>
                )}
                {onReceive && Number(tab.financial?.balance) > 0 && (
                  <button onClick={() => onReceive(tab.id)}>
                    <Icon name="payments" size={16} /> Receber comanda
                  </button>
                )}
              </div>
            </div>
            {!relatedOrders.length && (
              <p className="muted small">Esta comanda ainda não tem pedidos.</p>
            )}
            {relatedOrders.map((order) => {
              const orderItems = items.filter((item) => item.order_id === order.id);
              const visibleItems = orderItems.filter((item) => {
                const unitTickets = tickets.filter(
                  (ticket) => ticket.order_item_id === item.id && ticket.status !== 'CANCELLED',
                );
                if (filter === 'all') return true;
                if (order.status !== 'CONFIRMED') return false;
                return unitTickets.some((ticket) =>
                  filter === 'delivered'
                    ? ticket.status === 'REDEEMED'
                    : ticket.status !== 'REDEEMED',
                );
              });
              if (filter !== 'all' && !visibleItems.length) return null;
              return (
                <section
                  className={
                    'attendance-order' + (order.status === 'CANCELLED' ? ' cancelled' : '')
                  }
                  key={order.id}
                >
                  <div className="section-head">
                    <div className="button-row">
                      <strong>Pedido {shortId(order.id)}</strong>
                      <Badge status={order.status} />
                      <small className="muted">
                        {operationTime(order.created_at_iso ?? order.created_at)}
                      </small>
                    </div>
                    <div className="button-row">
                      <button onClick={() => onOrder(order.id)}>
                        <Icon name="eye" size={15} /> Ver pedido {shortId(order.id)}
                      </button>
                      {onCancel && order.status !== 'CANCELLED' && (
                        <button className="danger-text" onClick={() => onCancel(order)}>
                          <Icon name="close" size={15} /> Cancelar pedido {shortId(order.id)}
                        </button>
                      )}
                    </div>
                  </div>
                  {!orderItems.length && (
                    <p className="muted small">
                      Os itens deste pedido foram transferidos para outra comanda.
                    </p>
                  )}
                  {visibleItems.map((item) => {
                    const unitTickets = tickets.filter(
                      (ticket) => ticket.order_item_id === item.id && ticket.status !== 'CANCELLED',
                    );
                    const delivered = unitTickets.filter(
                      (ticket) => ticket.status === 'REDEEMED',
                    ).length;
                    const pending = unitTickets.length - delivered;
                    return (
                      <div className="attendance-item" key={item.id}>
                        <div>
                          <strong>
                            {item.quantity} × {item.name_snapshot}
                          </strong>
                          {item.notes && <small className="muted">{item.notes}</small>}
                        </div>
                        <div className="attendance-item-status">
                          {order.status === 'CANCELLED' ? (
                            <span className="muted">Cancelado · fora do total</span>
                          ) : unitTickets.length ? (
                            <>
                              <span className="delivered">{delivered} entregue(s)</span>
                              <span className={pending ? 'pending' : 'muted'}>
                                {pending} a entregar
                              </span>
                            </>
                          ) : (
                            <span className="muted">
                              {order.status === 'PENDING_PAYMENT'
                                ? 'Aguardando pagamento'
                                : 'Sem fichas emitidas'}
                            </span>
                          )}
                        </div>
                        <strong>{brl(item.total)}</strong>
                      </div>
                    );
                  })}
                </section>
              );
            })}
          </article>
        );
      })}
    </section>
  );
}
