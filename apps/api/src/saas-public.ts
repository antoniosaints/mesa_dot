import type { FastifyInstance } from 'fastify';
import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { db, rows, sql } from '../../../packages/database/src/index.js';
import { provisionIn } from '../../../packages/database/src/provision.js';
import {
  canonical,
  ensure,
  hash,
  passwordHash,
  verifyPassword,
} from '../../../packages/shared/src/index.js';
import { env } from '../../../packages/shared/src/config.js';
import { login } from './auth.js';
export const accountSignupSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    owner_name: z.string().trim().min(2).max(160),
    owner_email: z
      .email()
      .max(190)
      .transform((value) => value.toLowerCase()),
    password: z.string().min(12).max(200),
  })
  .strict();
const dummyHash = passwordHash('MesaUnknownPlatformAccount1!');
export async function registerSaasPublic(app: FastifyInstance) {
  app.post(
    '/api/v1/auth/saas/login',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const input = z
        .object({ email: z.email().max(190), password: z.string().min(1).max(200) })
        .strict()
        .parse(req.body);
      const accounts = await rows(
        db,
        sql`SELECT e.slug FROM users u
      JOIN staff_memberships sm ON sm.user_id=u.id AND sm.enabled=TRUE
      JOIN tenant_memberships tm ON tm.user_id=u.id AND tm.tenant_id=sm.tenant_id AND tm.enabled=TRUE
      JOIN tenants t ON t.id=sm.tenant_id AND t.enabled=TRUE
      JOIN establishments e ON e.tenant_id=t.id AND e.id=sm.establishment_id
      WHERE u.email=${input.email.toLowerCase()} AND u.enabled=TRUE AND u.is_superadmin=TRUE
      ORDER BY t.is_platform DESC,e.created_at,e.id LIMIT 1`,
      );
      if (!accounts.length) {
        verifyPassword(input.password, dummyHash);
        ensure(false, 'UNAUTHORIZED', 'Credenciais inválidas.', 401);
      }
      return reply
        .header('Cache-Control', 'no-store')
        .send(await login({ ...input, establishment_slug: accounts[0].slug }));
    },
  );
  app.post(
    '/api/v1/auth/register',
    {
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const input = accountSignupSchema.parse(req.body);
      const key = z.string().min(16).max(100).parse(req.headers['idempotency-key']);
      ensure(env.DOCUMENT_KEY, 'UNAVAILABLE', 'Cadastro temporariamente indisponível.', 503);
      const keyHash = hash(key);
      // An HMAC fingerprint supports safe retries without persisting the password or its plain digest.
      const fingerprint = createHmac('sha256', env.DOCUMENT_KEY)
        .update(canonical(input))
        .digest('hex');
      const result = await db.transaction(async (tx) => {
        await tx.execute(
          sql`INSERT IGNORE INTO public_registrations(key_hash,request_hash) VALUES(${keyHash},${fingerprint})`,
        );
        const [registration] = await rows(
          tx,
          sql`SELECT * FROM public_registrations WHERE key_hash=${keyHash} FOR UPDATE`,
        );
        ensure(
          registration.request_hash === fingerprint,
          'CONFLICT',
          'Os dados deste cadastro foram alterados. Inicie uma nova solicitação.',
          409,
        );
        if (registration.establishment_id) {
          const [unit] = await rows(
            tx,
            sql`SELECT slug FROM establishments WHERE id=${registration.establishment_id}`,
          );
          return { slug: unit.slug, tenant_id: registration.tenant_id };
        }
        const exists = await rows(
          tx,
          sql`SELECT id FROM users WHERE email=${input.owner_email} LIMIT 1`,
        );
        ensure(
          !exists.length,
          'CONFLICT',
          'Este e-mail já está cadastrado. Entre na sua conta.',
          409,
        );
        const account = await provisionIn(tx, input);
        await tx.execute(
          sql`UPDATE public_registrations SET tenant_id=${account.tenant_id},establishment_id=${account.establishment_id} WHERE key_hash=${keyHash}`,
        );
        return { slug: account.slug, tenant_id: account.tenant_id };
      });
      return reply.code(201).header('Cache-Control', 'no-store').send(result);
    },
  );
}
