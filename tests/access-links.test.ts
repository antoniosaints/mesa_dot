import { expect, it } from 'vitest';
import {
  credentialsText,
  frontendAccessUrl,
  staffAccessSurface,
} from '../packages/shared/src/access-links.js';
it('encaminha perfis padrão e personalizados pelo conjunto de permissões', () => {
  expect(staffAccessSurface(['table.view', 'order.create', 'payment.receive'])).toBe('waiter');
  expect(staffAccessSurface(['production.manage', 'ticket.view'])).toBe('kitchen');
  expect(staffAccessSurface(['cash.manage', 'table.view'])).toBe('admin');
  expect(staffAccessSurface(['table.view'], true)).toBe('admin');
  expect(staffAccessSurface([])).toBe('admin');
});
it('compõe os links corretos sem transportar credenciais ou parâmetros do painel', () => {
  expect(frontendAccessUrl('waiter', 'cas-internet', 'http://localhost:5173/salao?table=abc')).toBe(
    'http://localhost:5175/cas-internet/',
  );
  expect(frontendAccessUrl('kitchen', 'cas-internet', 'http://127.0.0.1:35173')).toBe(
    'http://127.0.0.1:35176/cas-internet/',
  );
  expect(frontendAccessUrl('admin', 'cas-internet', 'https://gestao.example/equipe')).toBe(
    'https://gestao.example/cas-internet/',
  );
  expect(
    frontendAccessUrl('customer', 'cas-internet', 'https://gestao.example/equipe', {
      customer: 'https://menu.example/?senha=secret#hash',
    }),
  ).toBe('https://menu.example/cas-internet/');
  expect(() => frontendAccessUrl('waiter', 'bar', 'https://gestao.example')).toThrow('Configure');
  expect(() =>
    frontendAccessUrl('waiter', 'bar', 'http://localhost:5173', { waiter: 'javascript:alert(1)' }),
  ).toThrow();
  expect(() => frontendAccessUrl('customer', '../outro', 'http://localhost:5173')).toThrow();
});
it('inclui os dados para compartilhar sem incluir senha na URL', () => {
  const text = credentialsText({
    name: 'Ana',
    role: 'Garçom',
    venue: 'Bar',
    url: 'http://localhost:5175/bar/',
    email: 'ana@test.local',
    password: 'OnlyTestPassword1!',
  });
  expect(text).toContain('Link: http://localhost:5175/bar/\n');
  expect(text).toContain('E-mail: ana@test.local\nSenha: OnlyTestPassword1!');
});
