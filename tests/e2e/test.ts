import { test as base } from '@playwright/test';
// One pool per worker; closing in a spec's afterAll breaks the next spec in that worker.
export const test = base.extend<
  object,
  { testDatabase: typeof import('../../packages/database/src/index.js') }
>({
  testDatabase: [
    async ({ browserName }, use) => {
      void browserName;
      if (
        !process.env.TEST_DATABASE_URL ||
        !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('_test')
      )
        throw new Error('Banco de teste exclusivo obrigatório.');
      process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
      process.env.DOCUMENT_KEY = 'a'.repeat(64);
      process.env.NODE_ENV = 'test';
      const database = await import('../../packages/database/src/index.js');
      try {
        await use(database);
      } finally {
        await database.pool.end();
      }
    },
    { scope: 'worker', auto: true },
  ],
});
