import { describe, it, expect } from 'vitest';
import {
  businessProfileSchema,
  businessProfilePatchSchema,
  emptyBusinessProfile,
  readBusinessProfile,
  businessAddress,
  businessPhone,
} from '../packages/shared/src/business-profile.js';
describe('informações públicas do estabelecimento', () => {
  it('aceita cadastro legado e descrição, contato e endereço opcionais', () => {
    for (const value of [null, undefined, '', 'invalid', [], {}])
      expect(readBusinessProfile(value)).toEqual(emptyBusinessProfile());
    expect(businessProfileSchema.parse(emptyBusinessProfile())).toEqual(emptyBusinessProfile());
  });
  it('normaliza texto, e-mail e UF sem interpretar conteúdo como HTML', () => {
    const profile = businessProfileSchema.parse({
      ...emptyBusinessProfile(),
      description: '  <b>Restaurante</b>\nComida da casa.  ',
      email: '  CONTATO@EXAMPLE.COM  ',
      state: ' sp ',
      phone: '11999998888',
      postal_code: '01001000',
    });
    expect(profile).toMatchObject({
      description: '<b>Restaurante</b>\nComida da casa.',
      email: 'contato@example.com',
      state: 'SP',
      postal_code: '01001000',
    });
    expect(readBusinessProfile(JSON.stringify(profile))).toEqual(profile);
  });
  it('recusa contatos e endereço inválidos, excessos e campos inesperados', () => {
    for (const patch of [
      { phone: 'abc' },
      { phone: '123' },
      { phone: '(11) 99999-8888' },
      { postal_code: '123' },
      { postal_code: '01001-000' },
      { email: 'invalido' },
      { state: 'ZZ' },
      { description: 'x'.repeat(1001) },
      { number: 'x'.repeat(21) },
      { tenant_id: 'outra-conta' },
    ])
      expect(businessProfilePatchSchema.safeParse(patch).success).toBe(false);
    expect(businessProfilePatchSchema.safeParse({}).success).toBe(false);
    expect(businessProfilePatchSchema.parse({ description: '' })).toEqual({ description: '' });
  });
  it('formata endereço sem separadores soltos e preserva zeros de CEP e número S/N', () => {
    const profile = {
      ...emptyBusinessProfile(),
      street: 'Rua da Casa',
      number: 'S/N',
      complement: 'Loja 2',
      neighborhood: 'Centro',
      city: 'São Paulo',
      state: 'SP',
      postal_code: '01001000',
    };
    expect(businessAddress(profile)).toEqual([
      'Rua da Casa, S/N',
      'Loja 2 · Centro',
      'São Paulo / SP',
      'CEP 01001-000',
    ]);
    expect(businessAddress(emptyBusinessProfile())).toEqual([]);
    expect(businessPhone('1133334444')).toBe('(11) 3333-4444');
    expect(businessPhone('11999998888')).toBe('(11) 99999-8888');
  });
});
