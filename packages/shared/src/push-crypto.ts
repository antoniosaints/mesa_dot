import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from './config.js';
export function sealPush(value: unknown) {
  if (!env.DOCUMENT_KEY) throw new Error('Configure DOCUMENT_KEY para o Web Push.');
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', Buffer.from(env.DOCUMENT_KEY, 'hex'), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}
export function openPush<T>(value: string): T {
  if (!env.DOCUMENT_KEY) throw new Error('Configure DOCUMENT_KEY para o Web Push.');
  const bytes = Buffer.from(value, 'base64'),
    decipher = createDecipheriv(
      'aes-256-gcm',
      Buffer.from(env.DOCUMENT_KEY, 'hex'),
      bytes.subarray(0, 12),
    );
  decipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'),
  );
}
