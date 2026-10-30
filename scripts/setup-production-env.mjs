// Não exige pnpm/node_modules: pode preparar o Compose em uma VM com apenas Node 24.
import { readFile, writeFile, chmod } from 'node:fs/promises';
import { randomBytes, createECDH } from 'node:crypto';
import { resolve } from 'node:path';
const path = resolve(process.argv[2] || '.env.production');
let source;
try {
  source = await readFile(path, 'utf8');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  source = await readFile(new URL('../.env.production.example', import.meta.url), 'utf8');
  await writeFile(path, source, { flag: 'wx', mode: 0o600 });
}
const value = (name) => source.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1].trim();
const set = (name, content) => {
  const pattern = new RegExp(`^${name}=.*$`, 'm');
  source = pattern.test(source)
    ? source.replace(pattern, () => `${name}=${content}`)
    : source.trimEnd() + `\n${name}=${content}\n`;
};
const publicKey = value('WEB_PUSH_PUBLIC_KEY'),
  privateKey = value('WEB_PUSH_PRIVATE_KEY');
if (Boolean(publicKey) !== Boolean(privateKey))
  throw new Error('Par VAPID incompleto. Restaure o par existente; nenhuma chave foi alterada.');
for (const name of [
  'MYSQL_PASSWORD',
  'MYSQL_ROOT_PASSWORD',
  'REDIS_PASSWORD',
  'DOCUMENT_KEY',
  'PAYMENT_WEBHOOK_SECRET',
]) {
  if (!value(name)) set(name, randomBytes(32).toString('hex'));
}
if (!publicKey) {
  const key = createECDH('prime256v1');
  key.generateKeys();
  set('WEB_PUSH_PUBLIC_KEY', key.getPublicKey().toString('base64url'));
  const privateBytes = Buffer.alloc(32);
  key.getPrivateKey().copy(privateBytes, 32 - key.getPrivateKey().length);
  set('WEB_PUSH_PRIVATE_KEY', privateBytes.toString('base64url'));
}
await chmod(path, 0o600);
await writeFile(path, source, { mode: 0o600 });
console.log(
  'Ambiente de produção preparado com permissão 0600. Segredos existentes preservados. Revise os domínios antes do deploy.',
);
