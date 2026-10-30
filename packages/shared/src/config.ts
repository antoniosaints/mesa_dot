import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
const env = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z.string().default('mysql://bar:bar_local_password@127.0.0.1:3306/bar_saas'),
    REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
    WEB_PUSH_PUBLIC_KEY: z
      .string()
      .regex(/^[A-Za-z0-9_-]{87}$/)
      .optional(),
    WEB_PUSH_PRIVATE_KEY: z
      .string()
      .regex(/^[A-Za-z0-9_-]{43}$/)
      .optional(),
    WEB_PUSH_SUBJECT: z.string().default('https://mesa.userp.com.br'),
    WEB_PUSH_ALLOWED_HOSTS: z
      .string()
      .default(
        'fcm.googleapis.com,fcmregistrations.googleapis.com,push.services.mozilla.com,web.push.apple.com,notify.windows.com,wns.windows.com',
      ),
    API_PORT: z.coerce.number().default(3000),
    API_HOST: z.string().default('127.0.0.1'),
    CORS_ORIGINS: z
      .string()
      .default(
        'http://localhost:5173,http://localhost:5174,http://localhost:5175,http://localhost:5176',
      ),
    DOCUMENT_KEY: z
      .string()
      .regex(/^[a-f0-9]{64}$/i)
      .optional(),
    PAYMENT_WEBHOOK_SECRET: z.string().min(32).optional(),
  })
  .parse(Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== '')));
export { env };
