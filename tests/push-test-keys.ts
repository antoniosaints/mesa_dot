import { createECDH } from 'node:crypto';
// Deterministic keys only for isolated automated tests. Never use in a deployed environment.
const key = createECDH('prime256v1');
key.setPrivateKey(Buffer.alloc(32, 7));
export const testPushKeys = {
  WEB_PUSH_PUBLIC_KEY: key.getPublicKey().toString('base64url'),
  WEB_PUSH_PRIVATE_KEY: key.getPrivateKey().toString('base64url'),
  WEB_PUSH_SUBJECT: 'https://mesa.test.local',
};
