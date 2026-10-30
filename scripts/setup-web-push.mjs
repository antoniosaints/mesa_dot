import { readFile, writeFile, chmod } from 'node:fs/promises';
import { parse } from 'dotenv';
import webpush from 'web-push';
import { resolve } from 'node:path';
const path = process.argv[2] ? resolve(process.argv[2]) : new URL('../.env', import.meta.url);
const source = await readFile(path, 'utf8'),
  env = parse(source);
if (env.WEB_PUSH_PUBLIC_KEY && env.WEB_PUSH_PRIVATE_KEY) {
  console.log('As chaves Web Push já estão configuradas. Nenhuma chave foi alterada.');
} else if (env.WEB_PUSH_PUBLIC_KEY || env.WEB_PUSH_PRIVATE_KEY) {
  throw new Error('O par VAPID está incompleto. Restaure o par existente antes de gerar outro.');
} else {
  const keys = webpush.generateVAPIDKeys();
  const cleaned = source.replace(/^WEB_PUSH_(?:PUBLIC_KEY|PRIVATE_KEY|SUBJECT)=.*\r?\n?/gm, '');
  await writeFile(
    path,
    cleaned.trimEnd() +
      '\n\n# Web Push — mantenha a chave privada apenas no servidor\nWEB_PUSH_PUBLIC_KEY=' +
      keys.publicKey +
      '\nWEB_PUSH_PRIVATE_KEY=' +
      keys.privateKey +
      '\nWEB_PUSH_SUBJECT=' +
      (env.WEB_PUSH_SUBJECT || 'https://mesa.userp.com.br') +
      '\n',
    { mode: 0o600 },
  );
  await chmod(path, 0o600);
  console.log(
    'Par VAPID gerado e salvo no arquivo informado (padrão .env), com permissão 0600. Reinicie API e worker para aplicar.',
  );
}
