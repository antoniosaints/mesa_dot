import { sql, type Scope, type Row } from '../../../packages/database/src/index.js';
import { ensure } from '../../../packages/shared/src/index.js';
import { sealComplement, openComplement } from '../../../packages/shared/src/complement-crypto.js';
export type ComplementProvider = 'mercadopago' | 'gemini';
export function complementAdmin(s: Scope) {
  ensure(
    s.actor.kind === 'STAFF' && s.actor.isAccountAdmin,
    'FORBIDDEN',
    'Somente o admin geral da conta pode gerenciar complementos.',
    403,
  );
}
const purpose = (s: Scope, provider: string) =>
  `${s.actor.tenantId}:${s.actor.establishmentId}:${provider}`;
export async function complement(s: Scope, provider: ComplementProvider) {
  return (await s.list('unit_complements', sql`provider=${provider}`))[0] ?? null;
}
export function credentials<T>(s: Scope, record: Row): T {
  ensure(record.credentials, 'INVALID_STATE', 'Configure a conexão deste complemento.', 409);
  try {
    return openComplement<T>(record.credentials, purpose(s, record.provider));
  } catch {
    ensure(
      false,
      'INVALID_STATE',
      'Não foi possível ler a credencial. Reconfigure este complemento.',
      409,
    );
  }
}
export async function saveComplement(
  s: Scope,
  provider: ComplementProvider,
  data: Row,
  secret?: unknown,
) {
  const existing = await complement(s, provider);
  const saved = {
    ...data,
    ...(secret === undefined ? {} : { credentials: sealComplement(secret, purpose(s, provider)) }),
  };
  if (existing) {
    await s.update('unit_complements', existing.id, saved);
    return { ...existing, ...saved };
  }
  return s.insert('unit_complements', { provider, ...saved });
}
export function sealOauth(s: Scope, value: unknown) {
  return sealComplement(value, purpose(s, 'oauth'));
}
export function openOauth<T>(s: Scope, value: string) {
  return openComplement<T>(value, purpose(s, 'oauth'));
}
export async function providerJson(
  url: string,
  init: RequestInit,
  provider: string,
  limits: { timeoutMs?: number; maxBytes?: number } = {},
) {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(limits.timeoutMs ?? 20000),
    });
  } catch {
    ensure(false, 'UNAVAILABLE', `${provider} não respondeu. Tente novamente em instantes.`, 409);
  }
  ensure(
    response!.ok,
    'UNAVAILABLE',
    response!.status === 429
      ? `${provider} atingiu o limite de uso. Aguarde e tente novamente.`
      : `${provider} recusou a solicitação. Verifique a conexão e as permissões.`,
    409,
  );
  let text: string;
  try {
    text = await response!.text();
  } catch {
    ensure(false, 'UNAVAILABLE', `${provider} não concluiu a resposta. Tente novamente.`, 409);
  }
  ensure(
    text!.length <= (limits.maxBytes ?? 2_000_000),
    'UNAVAILABLE',
    `Resposta de ${provider} maior que o permitido.`,
    409,
  );
  try {
    return JSON.parse(text!) as Row;
  } catch {
    ensure(false, 'UNAVAILABLE', `Resposta inválida de ${provider}. Tente novamente.`, 409);
  }
}
