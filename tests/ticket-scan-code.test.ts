import { describe, it, expect } from 'vitest';
import {
  normalizeTicketScan,
  isCompleteTicketScan,
  cameraErrorMessage,
} from '../packages/ui/src/ticket-scan-code.js';
describe('leitura rápida de fichas', () => {
  const token = 'a'.repeat(41) + '_-';
  it('reconhece tokens emitidos com terminadores e identificação do leitor', () => {
    expect(normalizeTicketScan('  ]C0' + token + '\r\n')).toBe(token);
    expect(isCompleteTicketScan(']Q3' + token)).toBe(true);
    expect(isCompleteTicketScan(token)).toBe(true);
  });
  it('não trata código parcial, URL de mesa ou número público como autorização de baixa', () => {
    for (const value of [
      '',
      token.slice(1),
      token + 'a',
      'https://localhost/mesa',
      'FICHA-001',
      'a'.repeat(42) + '!',
    ])
      expect(isCompleteTicketScan(value)).toBe(false);
  });
  it('orienta a recuperação de erros de câmera sem expor detalhes internos', () => {
    expect(cameraErrorMessage(new DOMException('private', 'NotAllowedError'))).toContain(
      'não autorizado',
    );
    expect(cameraErrorMessage(new DOMException('private', 'NotFoundError'))).toContain(
      'Nenhuma câmera',
    );
    expect(cameraErrorMessage(new DOMException('private', 'NotReadableError'))).toContain(
      'outro aplicativo',
    );
    expect(cameraErrorMessage(new Error('private'))).not.toContain('private');
  });
});
