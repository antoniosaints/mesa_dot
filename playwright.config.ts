import { testPushKeys } from './tests/push-test-keys.js';
import { defineConfig, devices } from '@playwright/test';
if (
  !process.env.TEST_DATABASE_URL ||
  !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('_test')
)
  throw new Error('TEST_DATABASE_URL exige banco exclusivo com sufixo _test.');
const environment = {
  ...testPushKeys,
  NODE_ENV: 'test',
  API_PORT: '33000',
  CUSTOMER_PUBLIC_URL: 'http://127.0.0.1:35174',
  CORS_ORIGINS:
    'http://127.0.0.1:35173,http://127.0.0.1:35174,http://127.0.0.1:35175,http://127.0.0.1:35176',
  DATABASE_URL: process.env.TEST_DATABASE_URL,
  REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379',
  DOCUMENT_KEY: 'a'.repeat(64),
  PAYMENT_WEBHOOK_SECRET: 'test-webhook-secret-never-use-in-production',
  MESA_TEST_COMPLEMENTS: '1',
  MERCADO_PAGO_CLIENT_ID: '123456789',
  MERCADO_PAGO_CLIENT_SECRET: 'e2e-client-secret-never-production',
  MERCADO_PAGO_WEBHOOK_SECRET: 'e2e-webhook-secret-never-production',
  MERCADO_PAGO_REDIRECT_URI: 'http://127.0.0.1:35173/api/v1/complements/mercadopago/callback',
  ADMIN_PUBLIC_URL: 'http://127.0.0.1:35173',
};
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    ...devices['Desktop Chrome'],
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'pnpm exec tsx tests/e2e/server.ts',
      url: 'http://127.0.0.1:33000/health/ready',
      env: environment,
      reuseExistingServer: false,
    },
    {
      command: 'pnpm --filter @bar/admin-web exec vite --host 127.0.0.1 --port 35173 --strictPort',
      url: 'http://127.0.0.1:35173',
      env: {
        API_PROXY_TARGET: 'http://127.0.0.1:33000',
        VITE_CUSTOMER_URL: 'http://127.0.0.1:35174',
      },
      reuseExistingServer: false,
    },
    {
      command:
        'pnpm --filter @bar/customer-pwa exec vite --host 127.0.0.1 --port 35174 --strictPort',
      url: 'http://127.0.0.1:35174',
      env: { API_PROXY_TARGET: 'http://127.0.0.1:33000' },
      reuseExistingServer: false,
    },
    {
      command: 'pnpm --filter @bar/waiter-pwa exec vite --host 127.0.0.1 --port 35175 --strictPort',
      url: 'http://127.0.0.1:35175',
      env: { API_PROXY_TARGET: 'http://127.0.0.1:33000' },
      reuseExistingServer: false,
    },
    {
      command:
        'pnpm --filter @bar/kitchen-display exec vite --host 127.0.0.1 --port 35176 --strictPort',
      url: 'http://127.0.0.1:35176',
      env: { API_PROXY_TARGET: 'http://127.0.0.1:33000' },
      reuseExistingServer: false,
    },
  ],
});
