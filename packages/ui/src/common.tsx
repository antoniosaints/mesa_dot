import { ShieldCheck } from 'lucide-react';
import { useInterfaceSurface } from './interface-scope.js';
import { EmptyState, StatusBadge } from './data-display.js';
import { CompanySelection } from './company-selection.js';
export { CompanySelection } from './company-selection.js';
import { iconPath, type PwaSurface } from '../../shared/src/pwa.js';
import { pwaContext } from './pwa-context.js';
import { useModalBlocker } from './navigation-guard.js';
import { createPortal } from 'react-dom';
import { useToasts } from './toasts.js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import QRCode from 'qrcode';
import bwipjs from 'bwip-js/browser';
import { Brand, Icon, ThemeToggle } from './appearance.js';
import { api, saveSession, saveLoginSession, session, subscribe, type Data } from './client.js';
export const Badge = StatusBadge;
export function Empty({ children = 'Nenhum registro por aqui.' }: { children?: ReactNode }) {
  return <EmptyState>{children}</EmptyState>;
}
const modalStack: {
  id: string;
  element: HTMLElement;
  onNavigated: () => void;
  isBusy: () => boolean;
}[] = [];
/** Capture only dialogs that already exist when a management navigation begins. */
export function captureModalNavigationCleanup() {
  const ids = new Set(modalStack.map((modal) => modal.id));
  return () => {
    for (const modal of [...modalStack].reverse()) if (ids.has(modal.id)) modal.onNavigated();
  };
}
export const hasBusyModal = () => modalStack.some((modal) => modal.isBusy());
let bodyOverflow = '';
let modalReturnFocus: HTMLElement | null = null;
const ModalContext = createContext<{
  requestClose: () => void;
  setDirty: (id: string, dirty: boolean) => void;
  headerTarget: HTMLElement | null;
} | null>(null);
export function ModalHeaderActions({ children }: { children: ReactNode }) {
  const target = useContext(ModalContext)?.headerTarget;
  return target ? createPortal(children, target) : null;
}
export function useModalDirty(dirty: boolean) {
  const setDirty = useContext(ModalContext)?.setDirty;
  const id = useId();
  useEffect(() => {
    setDirty?.(id, dirty);
    return () => setDirty?.(id, false);
  }, [setDirty, id, dirty]);
}
export function ModalCloseButton({
  children = 'Cancelar',
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'type'>) {
  const modal = useContext(ModalContext);
  return (
    <button {...props} type="button" onClick={modal?.requestClose}>
      {children}
    </button>
  );
}
export function Modal({
  title,
  heading,
  className,
  children,
  onClose,
  dirty = false,
  closeDisabled = false,
  role = 'dialog',
  routeBound = false,
  focusClose = false,
  size,
}: {
  title: string;
  heading?: ReactNode;
  className?: string;
  children: ReactNode;
  onClose: () => void;
  dirty?: boolean;
  closeDisabled?: boolean;
  role?: 'dialog' | 'alertdialog';
  routeBound?: boolean;
  focusClose?: boolean;
  size?: 'confirm' | 'form' | 'detail' | 'wide';
}) {
  const interfaceSurface = useInterfaceSurface();
  const panel = useRef<HTMLElement>(null);
  const [headerTarget, setHeaderTarget] = useState<HTMLDivElement | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const dirtyChildren = useRef(new Set<string>());
  const [, updateDirty] = useState(0);
  const allowNavigation = useRef(false);
  const blocker = useModalBlocker(
    () => !allowNavigation.current && (closeDisabled || dirty || dirtyChildren.current.size > 0),
  );
  const setDirty = useCallback((id: string, changed: boolean) => {
    if (dirtyChildren.current.has(id) === changed) return;
    if (changed) dirtyChildren.current.add(id);
    else dirtyChildren.current.delete(id);
    updateDirty((version) => version + 1);
  }, []);
  function requestClose() {
    if (closeDisabled) return;
    if (dirty || dirtyChildren.current.size) setConfirmDiscard(true);
    else {
      allowNavigation.current = true;
      onClose();
    }
  }
  function continueEditing() {
    setConfirmDiscard(false);
    if (blocker.state === 'blocked') blocker.reset();
  }
  function discardChanges() {
    allowNavigation.current = true;
    setConfirmDiscard(false);
    if (blocker.state === 'blocked') {
      if (!routeBound) onClose();
      blocker.proceed();
    } else onClose();
  }
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (closeDisabled) blocker.reset();
    else setConfirmDiscard(true);
  }, [blocker, closeDisabled]);
  const backdropPress = useRef<{
    pointerId: number;
    startedOutside: boolean;
    endedOutside: boolean;
  } | null>(null);
  const close = useRef(onClose);
  close.current = requestClose;
  const afterNavigation = useRef(() => {}),
    busyRef = useRef(closeDisabled);
  afterNavigation.current = () => {
    if (!routeBound) onClose();
  };
  busyRef.current = closeDisabled;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const entry = {
      id: crypto.randomUUID(),
      element: panel.current!,
      onNavigated: () => afterNavigation.current(),
      isBusy: () => busyRef.current,
    };
    if (!modalStack.length) {
      bodyOverflow = document.body.style.overflow;
      modalReturnFocus = previous;
    }
    for (const modal of modalStack) {
      modal.element.inert = true;
      modal.element.setAttribute('aria-hidden', 'true');
    }
    modalStack.push(entry);
    document.body.style.overflow = 'hidden';
    const visibleFocus = (selector: string) =>
      [...(panel.current?.querySelectorAll<HTMLElement>(selector) ?? [])].find(
        (element) => element.getClientRects().length && !element.matches(':disabled'),
      );
    (
      visibleFocus('[data-modal-autofocus]') ??
      visibleFocus('input,select,textarea') ??
      visibleFocus('button')
    )?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (modalStack.at(-1)?.id !== entry.id) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        close.current();
      }
      if (event.key !== 'Tab') return;
      const items = [
        ...(panel.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]',
        ) ?? []),
      ].filter((item) => item.getClientRects().length);
      if (!items.length) return;
      if (event.shiftKey && document.activeElement === items[0]) {
        event.preventDefault();
        items.at(-1)?.focus();
      } else if (!event.shiftKey && document.activeElement === items.at(-1)) {
        event.preventDefault();
        items[0].focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const top = modalStack.at(-1)?.id === entry.id;
      const index = modalStack.findIndex((modal) => modal.id === entry.id);
      if (index >= 0) modalStack.splice(index, 1);
      const next = modalStack.at(-1);
      if (next) {
        next.element.inert = false;
        next.element.removeAttribute('aria-hidden');
        if (top && previous?.isConnected) previous.focus();
      } else {
        document.body.style.overflow = bodyOverflow;
        if (modalReturnFocus?.isConnected) modalReturnFocus.focus();
        modalReturnFocus = null;
      }
    };
  }, []);
  return createPortal(
    <ModalContext.Provider value={{ requestClose, setDirty, headerTarget }}>
      <div
        className={['overlay', interfaceSurface].filter(Boolean).join(' ')}
        onPointerDownCapture={(event) => {
          backdropPress.current =
            event.button === 0
              ? {
                  pointerId: event.pointerId,
                  startedOutside: event.target === event.currentTarget,
                  endedOutside: false,
                }
              : null;
        }}
        onPointerUpCapture={(event) => {
          if (backdropPress.current?.pointerId === event.pointerId) {
            backdropPress.current.endedOutside = event.target === event.currentTarget;
          }
        }}
        onPointerCancelCapture={() => {
          backdropPress.current = null;
        }}
        onClick={(event) => {
          const press = backdropPress.current;
          backdropPress.current = null;
          // Browsers can target the backdrop after a selection starts inside the dialog.
          if (event.target === event.currentTarget && press?.startedOutside && press.endedOutside)
            requestClose();
        }}
      >
        <section
          className={['modal', className].filter(Boolean).join(' ')}
          ref={panel}
          role={role}
          aria-modal="true"
          aria-label={title}
          data-size={size}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="section-head modal-header">
            <h2 className="modal-title">{heading ?? title}</h2>
            <div className="modal-header-actions" ref={setHeaderTarget} />
            <button
              type="button"
              className="icon-button modal-header-close"
              data-modal-autofocus={focusClose || undefined}
              disabled={closeDisabled}
              onClick={requestClose}
              aria-label="Fechar"
            >
              <Icon name="close" />
            </button>
          </div>
          <div className="modal-body">{children}</div>
        </section>
      </div>
      {confirmDiscard && (
        <Modal
          title="Descartar alterações?"
          size="confirm"
          role="alertdialog"
          onClose={continueEditing}
        >
          <p className="modal-description">
            Você tem alterações não salvas. Se sair agora, os dados preenchidos serão perdidos.
          </p>
          <div className="modal-footer">
            <button type="button" data-modal-autofocus onClick={continueEditing}>
              Continuar editando
            </button>
            <button type="button" className="danger" onClick={discardChanges}>
              Descartar alterações
            </button>
          </div>
        </Modal>
      )}
    </ModalContext.Provider>,
    document.body,
  );
}
export function useAction() {
  const toast = useToasts();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const reads = useRef('');
  const running = useRef(0);
  async function refresh<T>(work: () => Promise<T>): Promise<T | undefined> {
    try {
      const result = await work();
      reads.current = '';
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao atualizar os dados.';
      if (message !== reads.current) {
        reads.current = message;
        toast.error(message);
      }
    }
  }
  async function run<T>(work: () => Promise<T>, success?: string): Promise<T | undefined> {
    running.current++;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await work();
      if (success) {
        setNotice(success);
        toast.success(success);
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro inesperado.';
      setError(message);
      toast.error(message);
    } finally {
      running.current--;
      setBusy(running.current > 0);
    }
  }
  return { run, refresh, busy, error, notice, feedback: null, clearError: () => setError('') };
}
export function useRefresh(load: () => Promise<void>, deps: unknown[] = []) {
  const callback = useRef(load);
  callback.current = load;
  useEffect(() => {
    let active = true;
    let loading = false;
    let pending = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      if (!active) return;
      if (loading) {
        pending = true;
        return;
      }
      loading = true;
      try {
        await callback.current();
      } finally {
        loading = false;
        if (pending && active) {
          pending = false;
          timer = setTimeout(() => void refresh(), 500);
        }
      }
    };
    void refresh();
    const close = subscribe(() => {
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 500);
    });
    return () => {
      active = false;
      clearTimeout(timer);
      close();
    };
  }, deps); // deps intentionally supplied by caller
}
export function Code({ value, barcode = false }: { value: string; barcode?: boolean }) {
  const [src, setSrc] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!barcode) void QRCode.toDataURL(value, { width: 220, margin: 1 }).then(setSrc);
    else if (canvas.current)
      bwipjs.toCanvas(canvas.current, { bcid: 'code128', text: value, scale: 2, height: 12 });
  }, [value, barcode]);
  return barcode ? (
    <canvas className="barcode" ref={canvas} aria-label="Código de barras Code 128" />
  ) : (
    <img className="qr-code" src={src || undefined} alt="QR Code" />
  );
}
export function companySelectionRequested() {
  return (
    !pwaContext() && new URLSearchParams(window.location.search).get('selecionar-empresa') === '1'
  );
}
export function Login({
  onLogin,
  app = 'Gestão do estabelecimento',
  surface = 'admin',
}: {
  onLogin: (value: Data) => void;
  app?: string;
  surface?: PwaSurface;
}) {
  const { run, busy, feedback } = useAction();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const identity = pwaContext();
  return (
    <div className="login-page">
      <aside>
        <Brand />
        <h1>
          O salão em sintonia.
          <br />
          Do primeiro pedido
          <br />à última mesa.
        </h1>
        <p>
          Comandas, equipe e operação
          <br />
          no mesmo lugar.
        </p>
        <span className="login-note">FEITO PARA QUEM RECEBE BEM</span>
      </aside>
      <main>
        <div className="login-theme">
          <ThemeToggle />
        </div>
        {!identity ? (
          <CompanySelection surface={surface} />
        ) : (
          <form
            className="login-form"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const result = await api('/auth/account-login', {
                  email,
                  password,
                  establishment_slug: identity.slug,
                });
                result.slug = result.slug ?? identity.slug;
                if (!saveLoginSession(result, surface)) onLogin(result);
              });
            }}
          >
            <span className="eyebrow">ACESSO AO SISTEMA</span>
            <h2>Entrar na sua conta</h2>
            <p className="muted">{app}</p>
            <div className="login-company">
              <img src={iconPath(identity, 192)} alt="" width="44" height="44" />
              <div>
                <strong>{identity.name}</strong>
                <span>Ambiente do estabelecimento</span>
              </div>
            </div>
            <label>
              E-mail
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                disabled={busy}
              />
            </label>
            <label>
              Senha
              <input
                required
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                disabled={busy}
              />
            </label>
            {feedback}
            <button className="primary full" disabled={busy}>
              {busy ? 'Entrando…' : 'Entrar na operação →'}
            </button>
            <p className="login-security-note">
              <ShieldCheck size={16} aria-hidden="true" />
              Acesso seguro para a sua equipe.
            </p>
          </form>
        )}
      </main>
    </div>
  );
}
export function useStaff() {
  const [current, setCurrent] = useState<Data | null>(session());
  useEffect(() => {
    const listener = () => setCurrent(null);
    window.addEventListener('bar:logout', listener);
    return () => window.removeEventListener('bar:logout', listener);
  }, []);
  async function signOut() {
    try {
      await api('/auth/logout', {});
    } finally {
      saveSession(null);
      setCurrent(null);
    }
  }
  return { current, setCurrent, signOut };
}
export function PageTitle({
  eyebrow = 'OPERAÇÃO',
  title,
  subtitle,
  action,
  className = '',
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={'page-title ' + className}>
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
export function Connectivity() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return !online ? (
    <div className="alert error" role="alert">
      Sem conexão. Pedidos, pagamentos e entregas exigem acesso ao servidor.
    </div>
  ) : null;
}
