import { z } from 'zod';
export const brazilianStates = [
  ['AC', 'Acre'],
  ['AL', 'Alagoas'],
  ['AP', 'Amapá'],
  ['AM', 'Amazonas'],
  ['BA', 'Bahia'],
  ['CE', 'Ceará'],
  ['DF', 'Distrito Federal'],
  ['ES', 'Espírito Santo'],
  ['GO', 'Goiás'],
  ['MA', 'Maranhão'],
  ['MT', 'Mato Grosso'],
  ['MS', 'Mato Grosso do Sul'],
  ['MG', 'Minas Gerais'],
  ['PA', 'Pará'],
  ['PB', 'Paraíba'],
  ['PR', 'Paraná'],
  ['PE', 'Pernambuco'],
  ['PI', 'Piauí'],
  ['RJ', 'Rio de Janeiro'],
  ['RN', 'Rio Grande do Norte'],
  ['RS', 'Rio Grande do Sul'],
  ['RO', 'Rondônia'],
  ['RR', 'Roraima'],
  ['SC', 'Santa Catarina'],
  ['SP', 'São Paulo'],
  ['SE', 'Sergipe'],
  ['TO', 'Tocantins'],
] as const;
const text = (max: number) => z.string().trim().max(max, `Use no máximo ${max} caracteres.`);
export const businessProfileSchema = z
  .object({
    description: text(1000),
    phone: text(11).regex(/^$|^\d{10,11}$/, 'Informe o telefone com DDD (10 ou 11 dígitos).'),
    email: text(190)
      .pipe(z.union([z.literal(''), z.email('Informe um e-mail válido.')]))
      .transform((v) => v.toLowerCase()),
    postal_code: text(8).regex(/^$|^\d{8}$/, 'Informe um CEP com 8 dígitos.'),
    street: text(160),
    number: text(20),
    complement: text(100),
    neighborhood: text(100),
    city: text(100),
    state: text(2)
      .transform((v) => v.toUpperCase())
      .refine((v) => !v || brazilianStates.some(([uf]) => uf === v), 'Selecione um estado válido.'),
  })
  .strict();
export const businessProfilePatchSchema = businessProfileSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Informe os dados que deseja atualizar.');
export type BusinessProfile = z.infer<typeof businessProfileSchema>;
export const emptyBusinessProfile = (): BusinessProfile => ({
  description: '',
  phone: '',
  email: '',
  postal_code: '',
  street: '',
  number: '',
  complement: '',
  neighborhood: '',
  city: '',
  state: '',
});
export function readBusinessProfile(raw: unknown): BusinessProfile {
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const parsed = businessProfileSchema.safeParse({
      ...emptyBusinessProfile(),
      ...(value && typeof value === 'object' && !Array.isArray(value) ? value : {}),
    });
    return parsed.success ? parsed.data : emptyBusinessProfile();
  } catch {
    return emptyBusinessProfile();
  }
}
export function businessAddress(profile: BusinessProfile): string[] {
  return [
    [profile.street, profile.number].filter(Boolean).join(', '),
    [profile.complement, profile.neighborhood].filter(Boolean).join(' · '),
    [profile.city, profile.state].filter(Boolean).join(' / '),
    profile.postal_code ? 'CEP ' + profile.postal_code.replace(/^(\d{5})(\d{3})$/, '$1-$2') : '',
  ].filter(Boolean);
}
export function businessPhone(phone: string): string {
  return phone.replace(/^(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3');
}
