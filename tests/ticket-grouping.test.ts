import { describe, it, expect } from 'vitest';
import { groupTickets, requestedTickets } from '../packages/ui/src/ticket-grouping.js';
const ticket = (values: Record<string, unknown> = {}) => ({
  id: 'ficha-1',
  table_id: 'mesa-1',
  table_number: '01',
  session_id: 'sessao-1',
  session_status: 'OPEN',
  session_started_at_iso: '2026-10-27T18:00:00Z',
  tab_id: 'comanda-1',
  tab_label: 'Minha conta',
  tab_mode: 'INDIVIDUAL',
  order_id: 'pedido-1',
  status: 'AVAILABLE',
  ...values,
});
describe('Agrupamento das fichas por atendimento', () => {
  it('separa ocupações diferentes da mesma mesa e prioriza a atual', () => {
    const groups = groupTickets([
      ticket({
        session_id: 'antiga',
        session_status: 'CLOSED',
        session_started_at_iso: '2026-10-27T15:00:00Z',
      }),
      ticket({ id: 'ficha-2' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].attendances).toHaveLength(2);
    expect(groups[0].attendances[0].status).toBe('OPEN');
    expect(groups[0].attendances[1].tickets[0].session_id).toBe('antiga');
  });
  it('não mistura comandas com nomes iguais nem pedidos distintos', () => {
    const groups = groupTickets([
      ticket(),
      ticket({ id: 'ficha-2', tab_id: 'comanda-2' }),
      ticket({ id: 'ficha-3', order_id: 'pedido-2' }),
    ]);
    const tabs = groups[0].attendances[0].tabs;
    expect(tabs).toHaveLength(2);
    expect(tabs[0].orders).toHaveLength(2);
    expect(tabs[1].tickets.map((row) => row.id)).toEqual(['ficha-2']);
  });
  it('separa mesas diferentes mesmo que os rótulos coincidam', () => {
    const groups = groupTickets([
      ticket(),
      ticket({ id: 'ficha-2', table_id: 'mesa-2', table_number: '02' }),
    ]);
    expect(groups.map((group) => group.number)).toEqual(['01', '02']);
    expect(groups.every((group) => group.tickets.length === 1)).toBe(true);
  });
  it('conta solicitações abertas e assumidas, sem contar entregas concluídas', () => {
    expect(
      requestedTickets([
        ticket({ service_request_status: 'OPEN' }),
        ticket({ service_request_status: 'CLAIMED' }),
        ticket({ status: 'REDEEMED', service_request_status: null }),
      ]),
    ).toBe(2);
  });
});
