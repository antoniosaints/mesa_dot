import type { ManagementShortcut } from './management-shortcut-context.js';
export function functionShortcut(
  event: Pick<
    KeyboardEvent,
    'key' | 'ctrlKey' | 'altKey' | 'metaKey' | 'shiftKey' | 'repeat' | 'isComposing'
  >,
): ManagementShortcut | null {
  if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.isComposing)
    return null;
  return ['F1', 'F2', 'F3', 'F4'].includes(event.key) ? (event.key as ManagementShortcut) : null;
}
export interface SearchableCommand {
  id: string;
  label: string;
  description: string;
  keywords?: string;
}
export const normalizeCommandSearch = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .trim()
    .replace(/\s+/g, ' ');
export function searchManagementCommands<T extends SearchableCommand>(
  commands: T[],
  query: string,
): T[] {
  const text = normalizeCommandSearch(query),
    terms = text.split(' ').filter(Boolean);
  if (!terms.length) return commands;
  return commands
    .map((command, index) => {
      const label = normalizeCommandSearch(command.label),
        haystack = normalizeCommandSearch(
          [command.label, command.description, command.keywords ?? ''].join(' '),
        );
      return {
        command,
        index,
        match: terms.every((term) => haystack.includes(term)),
        rank: label === text ? 0 : label.startsWith(text) ? 1 : label.includes(text) ? 2 : 3,
      };
    })
    .filter((item) => item.match)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((item) => item.command);
}
