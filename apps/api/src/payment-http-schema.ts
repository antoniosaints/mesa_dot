import { z } from 'zod';
/** Split financial operations retain the validation/OpenAPI contract of ordinary routes. */
export function paymentHttpSchema(body: z.ZodType) {
  return {
    schema: {
      tags: ['payments'],
      security: [{ bearerAuth: [] }],
      body: z.toJSONSchema(body, { unrepresentable: 'any', target: 'draft-7' }),
      headers: {
        type: 'object',
        required: ['idempotency-key'],
        properties: { 'idempotency-key': { type: 'string', minLength: 8, maxLength: 128 } },
      },
    },
  };
}
