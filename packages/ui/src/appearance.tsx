import { usePwaIdentity } from './pwa-context.js';
import { iconPath } from '../../shared/src/pwa.js';
import { appearanceStore } from './preferences.js';
import { api, session } from './client.js';
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import {
  Gauge,
  PanelsTopLeft,
  ClipboardList,
  UtensilsCrossed,
  CreditCard,
  HandCoins,
  Package,
  ChefHat,
  Printer,
  Users,
  Settings,
  Folder,
  ChevronDown,
  Sun,
  Moon,
  Bell,
  X,
  Search,
  RefreshCw,
  Plus,
  Pencil,
  LogOut,
  Menu,
  Clock as ClockIcon,
  Check,
  ScanLine,
  CircleHelp,
  ArrowRight,
  ArrowLeft,
  Ticket,
  Eye,
  Minus,
  Trash2,
  Send,
  ReceiptText,
  CircleCheck,
  Info,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  SlidersHorizontal,
  Copy,
  Camera,
  PanelLeftClose,
  PanelLeftOpen,
  Landmark,
  ShoppingCart,
} from 'lucide-react';
const icons = {
  dashboard: Gauge,
  tables: PanelsTopLeft,
  orders: ClipboardList,
  menu: UtensilsCrossed,
  payments: CreditCard,
  cash: HandCoins,
  inventory: Package,
  production: ChefHat,
  printing: Printer,
  team: Users,
  settings: Settings,
  folder: Folder,
  chevron: ChevronDown,
  sun: Sun,
  moon: Moon,
  bell: Bell,
  close: X,
  search: Search,
  refresh: RefreshCw,
  plus: Plus,
  edit: Pencil,
  logout: LogOut,
  bars: Menu,
  clock: ClockIcon,
  check: Check,
  scan: ScanLine,
  help: CircleHelp,
  next: ArrowRight,
  back: ArrowLeft,
  ticket: Ticket,
  eye: Eye,
  minus: Minus,
  trash: Trash2,
  send: Send,
  receipt: ReceiptText,
  ready: CircleCheck,
  info: Info,
  sort: ArrowUpDown,
  'sort-up': ArrowUp,
  'sort-down': ArrowDown,
  filters: SlidersHorizontal,
  copy: Copy,
  camera: Camera,
  'sidebar-close': PanelLeftClose,
  'sidebar-open': PanelLeftOpen,
  finance: Landmark,
  cart: ShoppingCart,
};
export type IconName = keyof typeof icons;
export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const Component = icons[name];
  return <Component className="icon" size={size} strokeWidth={1.8} aria-hidden="true" />;
}
export function Brand({
  subtitle = 'Gestão de bares e restaurantes',
  name,
  compact = false,
}: {
  subtitle?: string;
  name?: string;
  compact?: boolean;
}) {
  const identity = usePwaIdentity();
  return (
    <div className={`brand ${compact ? 'compact' : ''}`}>
      <span className="brand-symbol">
        {identity ? (
          <img src={iconPath(identity, 192)} alt="" width="43" height="43" />
        ) : (
          <Icon name="tables" size={27} />
        )}
      </span>
      <span className="brand-copy">
        <strong>{identity?.name ?? name ?? 'Mesa'}</strong>
        {!compact && <small>{subtitle}</small>}
      </span>
    </div>
  );
}
export function useAppearance() {
  return useSyncExternalStore(
    appearanceStore.subscribe,
    appearanceStore.getSnapshot,
    appearanceStore.getSnapshot,
  );
}
export function ThemeToggle() {
  const { theme } = useAppearance();
  return (
    <button
      className="icon-button theme-toggle"
      aria-label={`Ativar tema ${theme === 'dark' ? 'claro' : 'escuro'}`}
      title={`Ativar tema ${theme === 'dark' ? 'claro' : 'escuro'}`}
      onClick={() => appearanceStore.setTheme(theme === 'dark' ? 'light' : 'dark')}
    >
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
    </button>
  );
}
export function AppearanceSync() {
  useEffect(() => {
    let active = true;
    let request = 0;
    const update = () => {
      const token = session()?.token;
      if (!token) return;
      const current = ++request;
      void api('/appearance')
        .then((value) => {
          if (active && current === request && session()?.token === token)
            appearanceStore.setColors(value);
        })
        .catch(() => {});
    };
    update();
    const timer = setInterval(update, 15000);
    window.addEventListener('mesa:session-change', update);
    window.addEventListener('mesa:appearance-updated', update);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('mesa:session-change', update);
      window.removeEventListener('mesa:appearance-updated', update);
    };
  }, []);
  return null;
}
export function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);
  return (
    <span className="clock">
      <Icon name="clock" size={14} />
      {new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(now)}
    </span>
  );
}
export function AppHeader({
  subtitle,
  onLogout,
  children,
}: {
  subtitle?: string;
  onLogout?: () => void;
  children?: ReactNode;
}) {
  return (
    <header className="customer-header">
      <Brand compact subtitle={subtitle} />
      <div className="header-actions">
        {children}
        <ThemeToggle />
        {onLogout && (
          <button className="icon-button" onClick={onLogout} aria-label="Sair" title="Sair">
            <Icon name="logout" />
          </button>
        )}
      </div>
    </header>
  );
}
