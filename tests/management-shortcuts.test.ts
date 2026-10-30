import { expect, it } from 'vitest';
import {
  functionShortcut,
  searchManagementCommands,
} from '../packages/ui/src/management-shortcut-model.js';
const event = {
  key: 'F1',
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  shiftKey: false,
  repeat: false,
  isComposing: false,
};
it('aceita somente F1–F4 simples e preserva atalhos modificados do navegador e do sistema', () => {
  for (const key of ['F1', 'F2', 'F3', 'F4']) expect(functionShortcut({ ...event, key })).toBe(key);
  for (const key of ['F5', 'Enter', 'Escape', 'f1'])
    expect(functionShortcut({ ...event, key })).toBeNull();
  for (const modifier of ['ctrlKey', 'altKey', 'metaKey', 'shiftKey', 'isComposing'])
    expect(functionShortcut({ ...event, [modifier]: true })).toBeNull();
  expect(functionShortcut({ ...event, repeat: true })).toBe('F1');
});
it('busca por termos sem acentos e prioriza o nome da função', () => {
  const commands = [
    { id: 'overview', label: 'Visão geral', description: 'Link do cardápio online' },
    {
      id: 'menu',
      label: 'Cardápio',
      description: 'Gerenciar produtos e variações',
      keywords: 'preços adicionais',
    },
    {
      id: 'scan',
      label: 'Ler ficha',
      description: 'Leitor de código de barras',
      keywords: 'dar baixa entregar',
    },
  ];
  expect(searchManagementCommands(commands, '  CARDAPIO  ').map((c) => c.id)).toEqual([
    'menu',
    'overview',
  ]);
  expect(searchManagementCommands(commands, 'codigo barras').map((c) => c.id)).toEqual(['scan']);
  expect(searchManagementCommands(commands, 'dar baixa').map((c) => c.id)).toEqual(['scan']);
  expect(searchManagementCommands(commands, 'inexistente')).toEqual([]);
  expect(searchManagementCommands(commands, '  ')).toEqual(commands);
});
