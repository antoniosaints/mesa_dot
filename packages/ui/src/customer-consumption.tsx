import { Badge, Empty } from './common.js';
import { Icon } from './appearance.js';
import { brl, type Data } from './client.js';
import { operationTime, shortId } from './operation-format.js';
export function CustomerConsumption({
  tabs,
  orders,
  tickets,
  onContinuePayment,
  onViewTickets,
}: {
  tabs: Data[];
  orders: Data[];
  tickets: Data[];
  onContinuePayment: (order: Data) => void;
  onViewTickets: () => void;
}) {
  const total = tabs.reduce(
    (sum, tab) => sum + Number(tab.financial.charges) - Number(tab.financial.credits ?? 0),
    0,
  );
  const paid = tabs.reduce((sum, tab) => sum + Number(tab.financial.net_paid), 0),
    balance = tabs.reduce((sum, tab) => sum + Number(tab.financial.balance), 0);
  return (
    <div className="customer-consumption">
      <section className="customer-balance-card" aria-label="Resumo do meu consumo">
        <span className="customer-balance-icon">
          <Icon name="receipt" size={25} />
        </span>
        <p>
          Total consumido <small>Valores confirmados nas suas comandas</small>
        </p>
        <strong>{brl(total)}</strong>
        <div>
          <span>
            <Icon name="ready" size={16} />
            Já pago<b>{brl(paid)}</b>
          </span>
          <span className={balance > 0 ? 'has-balance' : ''}>
            <Icon name="payments" size={16} />
            {balance < 0 ? 'Crédito disponível' : 'Falta pagar'}
            <b>{brl(Math.abs(balance))}</b>
          </span>
        </div>
      </section>
      {tabs.length > 0 && (
        <section className="customer-consumption-section">
          <div className="customer-section-heading">
            <h2>Minhas comandas</h2>
            <span>{tabs.length}</span>
          </div>
          <div className="customer-tab-list">
            {tabs.map((tab) => (
              <details key={tab.id} className="customer-tab" open={tabs.length === 1}>
                <summary>
                  <span className="customer-tab-symbol">
                    <Icon name="receipt" size={20} />
                  </span>
                  <span>
                    <strong>{tab.label}</strong>
                    <Badge status={tab.status} />
                  </span>
                  <Icon name="chevron" size={18} />
                </summary>
                <dl>
                  <div>
                    <dt>Consumo</dt>
                    <dd>
                      {brl(Number(tab.financial.charges) - Number(tab.financial.credits ?? 0))}
                    </dd>
                  </div>
                  <div>
                    <dt>Pago</dt>
                    <dd className="is-paid">{brl(tab.financial.net_paid)}</dd>
                  </div>
                  <div>
                    <dt>Saldo</dt>
                    <dd>{brl(tab.financial.balance)}</dd>
                  </div>
                </dl>
              </details>
            ))}
          </div>
        </section>
      )}
      <section className="customer-consumption-section">
        <div className="customer-section-heading">
          <h2>Meus pedidos</h2>
          <span>{orders.length}</span>
        </div>
        {orders.length ? (
          <div className="customer-order-list">
            {orders.map((order) => {
              const units = tickets.filter((ticket) => ticket.order_id === order.id),
                delivered = units.filter((ticket) => ticket.status === 'REDEEMED').length;
              const products = new Map<string, number>();
              for (const ticket of units)
                products.set(ticket.product, (products.get(ticket.product) ?? 0) + 1);
              const contents = [...products]
                .map(([name, quantity]) => `${quantity} × ${name}`)
                .join(' · ');
              return (
                <article key={order.id} className="customer-order-card">
                  <div className="customer-order-heading">
                    <span>
                      <Icon name="orders" size={17} />
                      <strong>Pedido {shortId(order.id)}</strong>
                    </span>
                    <Badge status={order.status} />
                  </div>
                  <p className="customer-order-items">
                    {contents ||
                      (order.status === 'PENDING_PAYMENT'
                        ? 'Finalize o pagamento para liberar suas fichas.'
                        : order.status === 'CANCELLED'
                          ? 'Este pedido foi cancelado.'
                          : 'Consulte as fichas para acompanhar os itens.')}
                  </p>
                  <div className="customer-order-meta">
                    <span>
                      <Icon name="clock" size={13} />
                      {operationTime(order.created_at_iso ?? order.created_at)}
                    </span>
                    <strong>{brl(order.total)}</strong>
                  </div>
                  {order.status === 'PENDING_PAYMENT' ? (
                    <button className="primary" onClick={() => onContinuePayment(order)}>
                      <Icon name="payments" size={17} />
                      Continuar pagamento
                    </button>
                  ) : (
                    order.status === 'CONFIRMED' &&
                    units.length > 0 && (
                      <button className="customer-order-progress" onClick={onViewTickets}>
                        <Icon name={delivered === units.length ? 'ready' : 'ticket'} size={16} />
                        {delivered === units.length
                          ? 'Tudo entregue'
                          : `${delivered} de ${units.length} itens entregues`}
                        <span>
                          Ver fichas
                          <Icon name="next" size={14} />
                        </span>
                      </button>
                    )
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <Empty>Seus pedidos aparecerão aqui. Escolha algo no cardápio para começar.</Empty>
        )}
      </section>
    </div>
  );
}
