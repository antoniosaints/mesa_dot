import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from './config.js';
/** Binds ciphertext to the venue and provider; copied database values cannot cross scopes. */
export function sealComplement(value: unknown, scope: string) {
  if (!env.DOCUMENT_KEY) throw new Error('Configure DOCUMENT_KEY para os complementos.');
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', Buffer.from(env.DOCUMENT_KEY, 'hex'), iv);
  cipher.setAAD(Buffer.from('mesa:complement:v1:' + scope));
  const bytes = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString('base64');
}
export function openComplement<T>(value: string, scope: string): T {
  if (!env.DOCUMENT_KEY) throw new Error('Configure DOCUMENT_KEY para os complementos.');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length < 29) throw new Error('Credencial inválida.');
  const cipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(env.DOCUMENT_KEY, 'hex'),
    bytes.subarray(0, 12),
  );
  cipher.setAAD(Buffer.from('mesa:complement:v1:' + scope));
  cipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8'),
  );
}
