import { describe, it, expect } from 'vitest';
import {
  decimal,
  money,
  quantity,
  formatDecimal,
  deriveToken,
  passwordHash,
  verifyPassword,
  canonical,
} from '../packages/shared/src/index.js';
import { printerTargets } from '../apps/print-agent/src/printers.js';
import { escpos } from '../apps/print-agent/src/escpos.js';
describe('Valores exatos', () => {
  it('soma centavos sem erro de ponto flutuante', () => {
    expect(formatDecimal(money('0.10') + money('0.20'))).toBe('0.30');
  });
  it('calcula saldo com pagamento parcial, crédito e estorno', () => {
    expect(formatDecimal(money('100.00') - money('10.00') - money('40.00') + money('5.00'))).toBe(
      '55.00',
    );
  });
  it('preserva precisão em ingredientes e valores máximos', () => {
    expect(formatDecimal(quantity('0.050') * 3n, 3)).toBe('0.150');
    expect(formatDecimal(money('999999999999.99'))).toBe('999999999999.99');
  });
  it.each(['1e3', 'NaN', '1.001', '1,50', '', '9999999999999.00'])(
    'rejeita valor inválido %s',
    (input) => expect(() => money(input)).toThrow(),
  );
  it('aceita ajustes negativos sem perder o sinal', () => {
    expect(formatDecimal(decimal('-0.005', 3), 3)).toBe('-0.005');
  });
});
describe('Credenciais e fichas', () => {
  it('deriva o mesmo segredo na segunda via, com separação entre propósitos', () => {
    const key = 'b'.repeat(64);
    const token = deriveToken(key, 'ticket', 'id', 'nonce');
    expect(token).toBe(deriveToken(key, 'ticket', 'id', 'nonce'));
    expect(token).not.toBe(deriveToken(key, 'join', 'id', 'nonce'));
    expect(token).toHaveLength(43);
  });
  it('armazena senha com salt e verifica credenciais', () => {
    const p = passwordHash('SenhaSomenteDeTeste1!');
    expect(p).not.toContain('SenhaSomenteDeTeste1!');
    expect(verifyPassword('SenhaSomenteDeTeste1!', p)).toBe(true);
    expect(verifyPassword('outra', p)).toBe(false);
  });
  it('hash idempotente independe da ordem das propriedades', () =>
    expect(canonical({ b: 2, a: { c: 3 } })).toBe(canonical({ a: { c: 3 }, b: 2 })));
  it('ESC/POS imprime QR e Code128 com o mesmo token e marca segunda via', () => {
    const token = 'x'.repeat(43);
    const output = escpos({
      public_number: 'ABCD',
      product: 'Café',
      table_number: '01',
      token,
      is_copy: true,
    });
    expect(output.toString()).toContain('SEGUNDA VIA');
    expect(output.toString().split(token)).toHaveLength(3);
    expect(output.includes(Buffer.from([0x1d, 0x6b, 73]))).toBe(true);
  });
});

describe('Roteamento local de impressão', () => {
  it('exige vínculo explícito entre impressora cadastrada e dispositivo local', () => {
    expect(() => printerTargets({})).toThrow();
    const id = '550e8400-e29b-41d4-a716-446655440000';
    expect(
      printerTargets({ PRINT_PRINTER_ID: id, PRINT_HOST: '192.168.1.10', PRINT_PORT: '9100' })[id],
    ).toEqual({ host: '192.168.1.10', port: 9100 });
  });
  it('conserva o destino de cada impressora em vez de usar um fallback global', () => {
    const first = '550e8400-e29b-41d4-a716-446655440000';
    const second = '550e8400-e29b-41d4-a716-446655440001';
    const map = printerTargets({
      PRINT_PRINTERS_JSON: JSON.stringify({
        [first]: { host: '192.168.1.10', port: 9100 },
        [second]: { host: '192.168.1.11', port: 9101 },
      }),
    });
    expect(map[first].host).not.toBe(map[second].host);
    expect(map[second].port).toBe(9101);
  });
});
