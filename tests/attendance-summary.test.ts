import { describe, it, expect } from 'vitest';
import { attendanceSummary } from '../packages/ui/src/attendance-summary.js';
describe('Resumo do atendimento da mesa', () => {
  it('soma comandas em centavos e desconta créditos e estornos nos valores líquidos', () => {
    const result = attendanceSummary(
      [
        { financial: { charges: '25.10', credits: '5.00', net_paid: '10.10', balance: '10.00' } },
        { financial: { charges: '0.20', credits: '0.00', net_paid: '0.10', balance: '0.10' } },
      ],
      [],
    );
    expect(result).toMatchObject({ total: '20.30', paid: '10.20', balance: '10.10' });
  });
  it('conta cada unidade e exclui canceladas e pedidos não confirmados', () => {
    const result = attendanceSummary(
      [],
      [
        { status: 'REDEEMED', order_status: 'CONFIRMED' },
        { status: 'AVAILABLE', order_status: 'CONFIRMED' },
        { status: 'REQUESTED', order_status: 'CONFIRMED', service_request_status: 'OPEN' },
        { status: 'PREPARING', order_status: 'CONFIRMED' },
        { status: 'CANCELLED', order_status: 'CANCELLED' },
        { status: 'PENDING', order_status: 'PENDING_PAYMENT' },
      ],
    );
    expect(result).toMatchObject({
      ordered: 4,
      delivered: 1,
      pending: 3,
      preparing: 1,
      requested: 1,
    });
  });
  it('preserva saldo credor para resolver no fechamento', () => {
    expect(
      attendanceSummary(
        [
          {
            financial: { charges: '10.00', credits: '10.00', net_paid: '10.00', balance: '-10.00' },
          },
        ],
        [],
      ),
    ).toMatchObject({ total: '0.00', paid: '10.00', balance: '-10.00' });
  });
});
