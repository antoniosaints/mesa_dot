import { mkdir, copyFile } from 'node:fs/promises';
for (const [surface, app] of [
  ['customer', 'customer-pwa'],
  ['admin', 'admin-web'],
  ['waiter', 'waiter-pwa'],
  ['kitchen', 'kitchen-display'],
]) {
  const destination = new URL(`../dist/apps/api/web/${surface}/`, import.meta.url);
  await mkdir(destination, { recursive: true });
  await copyFile(
    new URL(`../apps/${app}/dist/index.html`, import.meta.url),
    new URL('index.html', destination),
  );
}
