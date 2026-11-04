import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { describe, expect, it } from 'vitest';
import { trustedProxyAddresses } from '../apps/api/src/trusted-proxy.js';
describe('proxies confiáveis', () => {
  it('separa clientes do proxy e limita repetições do mesmo cliente', async () => {
    const app = Fastify({ trustProxy: trustedProxyAddresses('loopback,172.30.0.0/24') });
    await app.register(rateLimit, { max: 1, timeWindow: '1 minute' });
    app.get('/', async (req) => ({ ip: req.ip }));
    try {
      for (const ip of ['203.0.113.1', '203.0.113.2']) {
        const response = await app.inject({
          url: '/',
          remoteAddress: '172.30.0.10',
          headers: { 'x-forwarded-for': '198.51.100.99, ' + ip },
        });
        expect(response.statusCode).toBe(200);
        expect(response.json().ip).toBe(ip);
      }
      expect(
        (
          await app.inject({
            url: '/',
            remoteAddress: '172.30.0.10',
            headers: { 'x-forwarded-for': '203.0.113.1' },
          })
        ).statusCode,
      ).toBe(429);
    } finally {
      await app.close();
    }
  });
  it('ignora cabeçalhos de conexões diretas não confiáveis', async () => {
    const app = Fastify({ trustProxy: trustedProxyAddresses('loopback') });
    app.get('/', async (req) => ({ ip: req.ip }));
    try {
      expect(
        (
          await app.inject({
            url: '/',
            remoteAddress: '198.51.100.1',
            headers: { 'x-forwarded-for': '203.0.113.1' },
          })
        ).json().ip,
      ).toBe('198.51.100.1');
    } finally {
      await app.close();
    }
  });
  it('recusa confiança irrestrita e aceita desativar o encaminhamento', () => {
    for (const value of ['true', '*', '0.0.0.0/0', '::/0', '1', '192.168.1.1/99', ''])
      expect(() => trustedProxyAddresses(value)).toThrow();
    expect(trustedProxyAddresses('none')).toBe(false);
  });
});
