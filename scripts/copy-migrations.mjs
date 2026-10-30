import { cp } from 'node:fs/promises';
await cp(
  new URL('../packages/database/migrations', import.meta.url),
  new URL('../dist/packages/database/migrations', import.meta.url),
  { recursive: true },
);

await cp(
  new URL('../packages/shared/assets', import.meta.url),
  new URL('../dist/packages/shared/assets', import.meta.url),
  { recursive: true },
);
