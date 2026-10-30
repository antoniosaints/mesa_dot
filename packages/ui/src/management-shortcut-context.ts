import { createContext, useContext } from 'react';
import type { Data } from './client.js';
export type ManagementShortcut = 'F1' | 'F2' | 'F3' | 'F4';
export interface ReaderOptions {
  table?: Data;
  onDelivered?: () => void | Promise<void>;
}
export const ManagementShortcutContext = createContext<{
  activate: (key: ManagementShortcut) => void;
  allowed: Record<ManagementShortcut, boolean>;
  openReader: (options?: ReaderOptions) => void;
} | null>(null);
export const useManagementShortcuts = () => useContext(ManagementShortcutContext);
