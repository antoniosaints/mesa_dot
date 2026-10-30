import { expect, it } from 'vitest';
import { tableCodeFromQr } from '../packages/shared/src/table-qr.js';
const code = '0123456789abcdef0123456789abcdef';
it('lê o código de mesa de links públicos e de PWA sem navegar para a URL lida', () => {
  expect(tableCodeFromQr(code)).toBe(code);
  expect(tableCodeFromQr(`https://bar.example/unidade/?table=${code}`)).toBe(code);
  expect(tableCodeFromQr(`/apps/uuid/customer/cardapio?table=${code}&aba=menu`)).toBe(code);
  expect(tableCodeFromQr(`https://outro.example/?table=${code}`)).toBe(code);
});
it('rejeita URLs sem mesa, protocolos executáveis e códigos malformados', () => {
  for (const value of [
    '',
    'abc',
    'https://bar.example/cardapio',
    `javascript:alert(1)?table=${code}`,
    'https://bar.example/?table=%3Cscript%3E',
  ])
    expect(() => tableCodeFromQr(value)).toThrow();
});
