import type { ReceiptDocument } from '../../packages/shared/src/receipt.js';
export function sampleReceipt(
  paper_width: 58 | 80 = 80,
  scope: 'ORDER' | 'TAB' = 'TAB',
): ReceiptDocument {
  const document: ReceiptDocument = {
    kind: 'RECEIPT',
    version: 1,
    scope,
    reference: '#DEMO0001',
    establishment_name: 'Bar de demonstração',
    table_number: '05',
    tab_label: 'Conta da Ana',
    customer_name: 'Ana da Conceição',
    status: scope === 'ORDER' ? 'Pedido confirmado' : 'Conferencia de comanda aberta',
    created_at: '2026-10-28 19:30:00',
    issued_at: '2026-10-28T20:00:00Z',
    paper_width,
    items: [
      {
        id: '1',
        name: 'Caipirinha de limão - 600 ml',
        quantity: 2,
        unit_price: '18.50',
        total: '37.00',
        cancelled: false,
        notes: 'Sem açúcar. Preparar com bastante gelo e servir os copos separados.',
        modifiers: ['Limão extra'],
        order_reference: '#PEDIDO01',
        tab_label: 'Conta da Ana',
      },
      {
        id: '2',
        name: 'Água mineral sem gás',
        quantity: 1,
        unit_price: '5.00',
        total: '5.00',
        cancelled: true,
        notes: null,
        modifiers: [],
        order_reference: '#PEDIDO02',
        tab_label: 'Conta da Ana',
      },
    ],
    totals: {
      subtotal: '42.00',
      cancelled: '5.00',
      discount: '2.00',
      adjustments: '0.00',
      total: '35.00',
      paid: scope === 'TAB' ? '20.00' : null,
      balance: scope === 'TAB' ? '15.00' : null,
    },
    payments: scope === 'TAB' ? [{ method: 'Pix', amount: '25.00', refunded: '5.00' }] : [],
    notes: ['DEMONSTRACAO - DADOS DE TESTE.', 'Valores para conferencia, sem validade fiscal.'],
  };
  if (scope === 'ORDER') {
    document.items = [document.items[0]];
    document.totals = {
      subtotal: '37.00',
      cancelled: '0.00',
      discount: '0.00',
      adjustments: '0.00',
      total: '37.00',
      paid: null,
      balance: null,
    };
    document.notes.push('Pagamento registrado na comanda, sem rateio por pedido.');
  }
  return document;
}
