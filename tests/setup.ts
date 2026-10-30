import { testPushKeys } from './push-test-keys.js';
process.env.NODE_ENV = 'test';
process.env.DOCUMENT_KEY ??= 'a'.repeat(64);
process.env.PAYMENT_WEBHOOK_SECRET ??= 'test-webhook-secret-never-use-in-production';
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

Object.assign(process.env, testPushKeys);
