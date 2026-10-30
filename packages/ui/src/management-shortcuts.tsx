import { useEffect, useLayoutEffect, useId, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { Keyboard } from 'lucide-react';
import { useLocation } from 'react-router';
import { Icon, type IconName } from './appearance.js';
import { captureModalNavigationCleanup, hasBusyModal, Modal } from './common.js';
import { QuickScanDialog } from './ticket-quick-scan.js';
import { useToasts } from './toasts.js';
import {
  functionShortcut,
  searchManagementCommands,
  type SearchableCommand,
} from './management-shortcut-model.js';
import {
  ManagementShortcutContext,
  useManagementShortcuts,
  type ManagementShortcut,
  type ReaderOptions,
} from './management-shortcut-context.js';
interface Command extends SearchableCommand {
  icon: IconName;
  key?: ManagementShortcut;
  group: string;
  run: () => void;
}
export interface ManagementDestination {
  id: string;
  label: string;
  icon: IconName;
  path: string;
}
const hints: Record<string, { description: string; keywords: string }> = {
  overview: {
    description: 'Indicadores e visão geral da filial.',
    keywords: 'inicio dashboard resumo link cliente cardapio online',
  },
  floor: {
    description: 'Consultar mesas, abrir comandas e acompanhar atendimentos.',
    keywords: 'mesa salao atendimento comanda consumo encerrar fechamento',
  },
  orders: {
    description: 'Consultar pedidos, fichas e entregas.',
    keywords: 'pedido ficha entrega cancelar cupom impressao',
  },
  menu: {
    description: 'Gerenciar produtos, categorias, variações e adicionais.',
    keywords: 'produto cardapio categoria variacao adicional preco',
  },
  finance: {
    description: 'Acompanhar vendas e indicadores financeiros da filial.',
    keywords: 'financeiro relatorio faturamento receitas despesas vendas',
  },
  payments: {
    description: 'Consultar recebimentos e estornos.',
    keywords: 'pagamento pix cartao dinheiro estorno reembolso',
  },
  cash: {
    description: 'Abrir, conferir e fechar o caixa.',
    keywords: 'caixa abertura fechamento turno sangria suprimento',
  },
  inventory: {
    description: 'Consultar saldos e movimentar os estoques.',
    keywords: 'estoque saldo reposicao movimentacao local fornecedor compra nota',
  },
  production: {
    description: 'Acompanhar a fila de preparo da cozinha.',
    keywords: 'cozinha producao preparar pronto bar',
  },
  printing: {
    description: 'Gerenciar impressoras, fila e PrintBridge.',
    keywords: 'impressora impressao fila termica cancelar pdf cupom printbridge',
  },
  team: {
    description: 'Gerenciar funcionários, perfis e vínculos com filiais.',
    keywords: 'equipe funcionario usuario acesso permissao filial filiais credenciais senha',
  },
  settings: {
    description: 'Configurar o estabelecimento e seus aplicativos.',
    keywords: 'configuracao politicas pwa aplicativo logo estabelecimento',
  },
};
export function ManagementShortcutProvider({
  children,
  destinations,
  canRead,
  onNavigate,
  onDelivered,
  onCounter,
}: {
  children: ReactNode;
  destinations: ManagementDestination[];
  canRead: boolean;
  onNavigate: (path: string) => void;
  onDelivered: () => void | Promise<void>;
  onCounter?: () => void;
}) {
  const [palette, setPalette] = useState(false),
    [reader, setReader] = useState<ReaderOptions | null>(null);
  const location = useLocation(),
    lastLocation = useRef(location.key),
    pendingNavigation = useRef<(() => void) | null>(null);
  // The browser URL updates before React's route transition commits. An overlay
  // opened during that transition belongs to the destination, not the stale render.
  const overlayLocation = useRef({ reader: window.location.href, palette: window.location.href });
  const toast = useToasts();
  const allowed: Record<ManagementShortcut, boolean> = {
    F1: canRead,
    F2: destinations.some((destination) => destination.id === 'floor'),
    F3: destinations.some((destination) => destination.id === 'menu'),
    F4: true,
  };
  function ready() {
    if (document.querySelector('[role="alertdialog"]:not([aria-hidden="true"])')) {
      toast.info('Conclua a confirmação aberta antes de usar outro atalho.');
      return false;
    }
    if (hasBusyModal()) {
      toast.info('Aguarde a operação em andamento concluir para usar este atalho.');
      return false;
    }
    return true;
  }
  function openReader(options: ReaderOptions = {}) {
    if (!canRead) {
      toast.info('Seu perfil não tem permissão para ler e baixar fichas.');
      return;
    }
    if (!ready()) return;
    if (palette) flushSync(() => setPalette(false));
    if (reader) {
      document
        .querySelector<HTMLInputElement>(
          '.ticket-quick-scan-modal input[aria-label="Código da ficha"]',
        )
        ?.focus();
      return;
    }
    overlayLocation.current.reader = window.location.href;
    setReader(options);
  }
  function navigateTo(path: string) {
    if (!ready()) return;
    pendingNavigation.current = captureModalNavigationCleanup();
    onNavigate(path);
  }
  function activate(key: ManagementShortcut) {
    if (!allowed[key]) {
      toast.info('Seu perfil não tem acesso a esta função.');
      return;
    }
    if (!ready()) return;
    if (key === 'F1') openReader();
    else if (key === 'F4') {
      if (palette)
        document.querySelector<HTMLInputElement>('.management-command-search input')?.focus();
      else {
        overlayLocation.current.palette = window.location.href;
        setPalette(true);
      }
    } else {
      if (palette) flushSync(() => setPalette(false));
      const target = destinations.find(
        (destination) => destination.id === (key === 'F2' ? 'floor' : 'menu'),
      );
      if (target) navigateTo(target.path);
    }
  }
  const latest = useRef(activate);
  latest.current = activate;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const key = functionShortcut(event);
      if (!key) return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) latest.current(key);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);
  useLayoutEffect(() => {
    if (lastLocation.current === location.key) return;
    lastLocation.current = location.key;
    const cleanup = pendingNavigation.current;
    pendingNavigation.current = null;
    cleanup?.();
    if (overlayLocation.current.palette !== window.location.href) setPalette(false);
    if (overlayLocation.current.reader !== window.location.href) setReader(null);
  }, [location.key]);
  const commands: Command[] = [
    ...(canRead
      ? [
          {
            id: 'reader',
            label: 'Ler ficha',
            description: 'Abrir leitor de código de barras ou câmera e baixar fichas.',
            keywords: 'barcode qr qrcode codigo entregar entrega baixa dar baixa ficha leitor',
            icon: 'scan' as IconName,
            key: 'F1' as ManagementShortcut,
            group: 'Atendimento',
            run: () => openReader(),
          },
        ]
      : []),
    ...(onCounter
      ? [
          {
            id: 'counter',
            label: 'Novo pedido avulso',
            description: 'Criar uma venda no balcão, sem vincular a uma mesa.',
            keywords: 'pedido balcao retirada vender venda rapida',
            icon: 'orders' as IconName,
            group: 'Atendimento',
            run: onCounter,
          },
        ]
      : []),
    ...destinations.map((destination) => ({
      id: destination.id,
      label: destination.label,
      icon: destination.icon,
      description: hints[destination.id]?.description ?? 'Abrir esta tela.',
      keywords: hints[destination.id]?.keywords ?? '',
      key:
        destination.id === 'floor'
          ? ('F2' as const)
          : destination.id === 'menu'
            ? ('F3' as const)
            : undefined,
      group: 'Navegação',
      run: () => navigateTo(destination.path),
    })),
    ...(destinations.some((destination) => destination.id === 'settings')
      ? [
          {
            id: 'appearance',
            label: 'Aparência do sistema',
            description: 'Personalizar cores e o fundo do menu lateral.',
            keywords: 'aparencia cores tema sidebar presets',
            icon: 'settings' as IconName,
            group: 'Configurações',
            run: () => navigateTo('/configuracoes?aba=aparencia'),
          },
          {
            id: 'hours',
            label: 'Horário de funcionamento',
            description: 'Configurar os horários e a exibição dos produtos esgotados.',
            keywords: 'horario funcionamento agenda aberto fechado sem estoque esgotados',
            icon: 'clock' as IconName,
            group: 'Configurações',
            run: () => navigateTo('/configuracoes?aba=funcionamento-e-cardapio'),
          },
        ]
      : []),
  ];
  return (
    <ManagementShortcutContext.Provider value={{ activate, allowed, openReader }}>
      {children}
      {palette && (
        <CommandPalette
          commands={commands}
          onClose={() => setPalette(false)}
          onSelect={(command) => {
            if (!ready()) return;
            flushSync(() => setPalette(false));
            command.run();
          }}
        />
      )}
      {reader && (
        <QuickScanDialog
          table={reader.table}
          onClose={() => setReader(null)}
          onDelivered={async () => {
            if (reader.onDelivered) await reader.onDelivered();
            else await onDelivered();
          }}
        />
      )}
    </ManagementShortcutContext.Provider>
  );
}
export function ManagementShortcutBar() {
  const shortcuts = useManagementShortcuts();
  if (!shortcuts) return null;
  return (
    <footer className="management-shortcut-bar" aria-label="Atalhos globais da gestão">
      <span className="management-shortcut-caption">
        <Keyboard size={15} strokeWidth={1.8} aria-hidden="true" />
        Atalhos
      </span>
      <div>
        {(
          [
            ['F1', 'scan', 'Ler ficha'],
            ['F2', 'tables', 'Mesas'],
            ['F3', 'menu', 'Cardápio'],
            ['F4', 'search', 'Buscar funções'],
          ] as const
        ).map(([key, icon, label]) => (
          <button
            key={key}
            type="button"
            className={'management-shortcut shortcut-' + key.toLowerCase()}
            aria-label={label + ' (' + key + ')'}
            aria-keyshortcuts={key}
            disabled={!shortcuts.allowed[key]}
            title={
              shortcuts.allowed[key]
                ? key + ' — ' + label
                : 'Seu perfil não tem acesso a ' + label.toLocaleLowerCase('pt-BR')
            }
            onClick={() => shortcuts.activate(key)}
          >
            <kbd aria-hidden="true">{key}</kbd>
            <Icon name={icon} size={16} />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <span className="management-shortcut-help">Clique ou use o teclado</span>
    </footer>
  );
}
function CommandPalette({
  commands,
  onClose,
  onSelect,
}: {
  commands: Command[];
  onClose: () => void;
  onSelect: (command: Command) => void;
}) {
  const [query, setQuery] = useState(''),
    [active, setActive] = useState(0);
  const listId = useId(),
    results = searchManagementCommands(commands, query),
    selected = Math.min(active, Math.max(0, results.length - 1));
  useEffect(() => {
    document.getElementById(listId + '-' + selected)?.scrollIntoView({ block: 'nearest' });
  }, [selected, listId, query]);
  return (
    <Modal title="Busca rápida de funções" className="management-command-modal" onClose={onClose}>
      <label className="management-command-search">
        <Icon name="search" size={21} />
        <input
          data-modal-autofocus
          role="combobox"
          aria-label="Buscar função"
          aria-expanded="true"
          aria-autocomplete="list"
          aria-controls={listId}
          aria-activedescendant={results.length ? listId + '-' + selected : undefined}
          placeholder="O que você quer fazer?"
          autoComplete="off"
          maxLength={120}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setActive(
                results.length
                  ? (selected + (event.key === 'ArrowDown' ? 1 : -1) + results.length) %
                      results.length
                  : 0,
              );
            } else if (event.key === 'Enter') {
              event.preventDefault();
              if (results[selected]) onSelect(results[selected]);
            }
          }}
        />
        <kbd className="management-keycap" aria-hidden="true">
          F4
        </kbd>
      </label>
      <div className="management-command-meta">
        <span>{query ? 'Resultados da busca' : 'Funções disponíveis para seu perfil'}</span>
        <span role="status" aria-live="polite">
          {results.length} função(ões)
        </span>
      </div>
      <div
        id={listId}
        className="management-command-results"
        role="listbox"
        aria-label="Funções do sistema"
      >
        {results.map((command, index) => (
          <button
            id={listId + '-' + index}
            type="button"
            role="option"
            aria-selected={selected === index}
            key={command.id}
            onMouseDown={(event) => event.preventDefault()}
            onMouseMove={() => setActive(index)}
            onFocus={() => setActive(index)}
            onClick={() => onSelect(command)}
          >
            <span className="management-command-icon">
              <Icon name={command.icon} size={19} />
            </span>
            <span className="management-command-text">
              <small>{command.group}</small>
              <strong>{command.label}</strong>
              <span>{command.description}</span>
            </span>
            {command.key ? (
              <kbd className="management-keycap" aria-hidden="true">
                {command.key}
              </kbd>
            ) : (
              <Icon name="next" size={16} />
            )}
          </button>
        ))}
      </div>
      {!results.length && (
        <div className="management-command-empty">
          <Icon name="search" size={28} />
          <strong>Nenhuma função encontrada</strong>
          <p>Tente buscar por mesas, pedidos, estoque ou outra função disponível no seu perfil.</p>
        </div>
      )}
      <div className="management-command-help">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> navegar
        </span>
        <span>
          <kbd>Enter</kbd> abrir
        </span>
        <span>
          <kbd>Esc</kbd> fechar
        </span>
      </div>
    </Modal>
  );
}
