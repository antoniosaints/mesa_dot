import { prepareBranchTransition } from './branch-transition.js';
import { PageLoading } from './page-loading.js';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Building2, Check, ChevronDown, Plus, RefreshCw, Search } from 'lucide-react';
import { api, session, storeBranchSession, type Data } from './client.js';
import { Brand } from './appearance.js';
import { Modal, ModalCloseButton, useRefresh } from './common.js';
import { TableLoading } from './pagination.js';
import { useToasts } from './toasts.js';
function BranchImage({ branch }: { branch: Data }) {
  const [failed, setFailed] = useState('');
  const source = branch.icon_url;
  return (
    <span className="branch-option-icon">
      {source && source !== failed ? (
        <img
          src={source}
          alt=""
          width={36}
          height={36}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(source)}
        />
      ) : (
        <Building2 size={17} />
      )}
    </span>
  );
}
export function BranchSwitcher() {
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(''),
    [open, setOpen] = useState(false),
    [search, setSearch] = useState(''),
    [creating, setCreating] = useState(false),
    [switching, setSwitching] = useState(''),
    [openingName, setOpeningName] = useState('');
  const trigger = useRef<HTMLButtonElement>(null),
    panel = useRef<HTMLDivElement>(null),
    input = useRef<HTMLInputElement>(null),
    pending = useRef<AbortController | null>(null),
    locked = useRef(false);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 320 });
  const toast = useToasts();
  async function load() {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    try {
      const result = await api(
        '/branches',
        undefined,
        undefined,
        undefined,
        'json',
        controller.signal,
      );
      if (!controller.signal.aborted) {
        setData(result);
        setError('');
      }
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    }
  }
  useRefresh(load, []);
  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => {
    if (!open) return;
    const update = () => {
      const rect = trigger.current!.getBoundingClientRect();
      const width = Math.min(340, window.innerWidth - 24);
      setPosition({
        top: Math.min(rect.bottom + 8, window.innerHeight - 220),
        left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
        width,
      });
    };
    update();
    input.current?.focus();
    const dismiss = (event: PointerEvent) => {
      if (
        !panel.current?.contains(event.target as Node) &&
        !trigger.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        trigger.current?.focus();
      }
    };
    window.addEventListener('resize', update);
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', keyboard);
    return () => {
      window.removeEventListener('resize', update);
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', keyboard);
    };
  }, [open]);
  async function switchTo(branch: Data) {
    if (locked.current || branch.id === session()?.actor?.establishmentId) {
      setOpen(false);
      return;
    }
    locked.current = true;
    setSwitching(branch.id);
    setOpeningName(branch.name);
    setError('');
    let navigating = false;
    try {
      const next = await api('/auth/switch-branch', { establishment_id: branch.id });
      storeBranchSession(next);
      prepareBranchTransition(next.slug, next.actor.establishmentId);
      navigating = true;
      window.location.assign('/' + next.slug + '/');
    } catch (e) {
      navigating = false;
      setError((e as Error).message);
      toast.error((e as Error).message);
      throw e;
    } finally {
      if (!navigating) {
        locked.current = false;
        setSwitching('');
        setOpeningName('');
      }
    }
  }
  const current = data?.branches.find((branch: Data) => branch.id === data.current_id);
  const normalize = (value: string) =>
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('pt-BR');
  const branches: Data[] = (data?.branches ?? []).filter((branch: Data) =>
    normalize(branch.name).includes(normalize(search)),
  );
  return (
    <>
      {switching && <PageLoading label="Abrindo filial…" name={openingName} />}
      <button
        type="button"
        ref={trigger}
        className="branch-trigger"
        aria-label={'Filiais · ' + (current?.name ?? 'Selecionar filial')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          setSearch('');
        }}
        title={'Trocar filial' + (current ? ' · ' + current.name : '')}
      >
        <Brand name={current?.name} subtitle="Filial atual · trocar unidade" />
        <ChevronDown size={16} className="branch-trigger-chevron" />
      </button>
      {open &&
        createPortal(
          <div
            ref={panel}
            role="menu"
            aria-label="Selecionar filial"
            className="branch-menu"
            style={position}
            onKeyDown={(event) => {
              const buttons = [
                ...(panel.current?.querySelectorAll<HTMLButtonElement>(
                  'button[role^="menuitem"]:not(:disabled)',
                ) ?? []),
              ];
              const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
              if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                const next =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? buttons.length - 1
                      : event.key === 'ArrowDown'
                        ? (at + 1) % buttons.length
                        : (at - 1 + buttons.length) % buttons.length;
                buttons[next]?.focus();
              }
            }}
          >
            <div className="branch-menu-heading">
              <Building2 size={18} />
              <div>
                <strong>Suas filiais</strong>
                <small>{data?.account_name ?? 'Carregando conta…'}</small>
              </div>
            </div>
            <label className="branch-search">
              <Search size={16} />
              <input
                ref={input}
                aria-label="Buscar filial"
                placeholder="Buscar filial…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            {error && (
              <div className="branch-menu-error" role="alert">
                <p>{error}</p>
                <button onClick={() => void load()}>
                  <RefreshCw size={14} />
                  Tentar novamente
                </button>
              </div>
            )}
            {!data && !error ? (
              <TableLoading label="Carregando filiais…" compact />
            ) : (
              <div className="branch-menu-list">
                {branches.map((branch) => (
                  <button
                    key={branch.id}
                    role="menuitemradio"
                    aria-checked={branch.id === data?.current_id}
                    disabled={Boolean(switching)}
                    onClick={() => void switchTo(branch).catch(() => {})}
                  >
                    <BranchImage branch={branch} />
                    <span>
                      <strong>{branch.name}</strong>
                      <small>
                        {switching === branch.id ? 'Abrindo filial…' : branch.role_name}
                      </small>
                    </span>
                    {branch.id === data?.current_id && <Check size={16} />}
                  </button>
                ))}
                {!branches.length && <p className="muted">Nenhuma filial encontrada.</p>}
              </div>
            )}
            {data?.can_manage && (
              <button
                className="branch-create"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  setCreating(true);
                }}
              >
                <Plus size={17} />
                Criar nova filial
              </button>
            )}
            <p className="branch-menu-note">
              Cardápio, estoque e financeiro independentes em cada filial.
            </p>
          </div>,
          document.body,
        )}
      {creating && (
        <NewBranch
          onClose={() => setCreating(false)}
          onCreated={async (branch) => {
            await load();
            await switchTo(branch);
          }}
        />
      )}
    </>
  );
}
function NewBranch({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (branch: Data) => Promise<void>;
}) {
  const [name, setName] = useState(''),
    [created, setCreated] = useState<Data | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const attempt = useRef({ name: '', key: crypto.randomUUID() });
  return (
    <Modal
      title="Criar nova filial"
      className="branch-create-modal"
      onClose={onClose}
      dirty={Boolean(name) && !created}
      closeDisabled={busy}
    >
      <p className="muted">
        A filial terá seu próprio cardápio, estoque, mesas, caixa e financeiro. Seu acesso de
        administrador será incluído; os demais usuários são vinculados na tela Equipe.
      </p>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          try {
            if (attempt.current.name !== name) attempt.current = { name, key: crypto.randomUUID() };
            const branch =
              created ?? (await api('/establishments', { name }, 'POST', attempt.current.key));
            setCreated(branch);
            await onCreated(branch);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Nome da filial
          <input
            aria-label="Nome da filial"
            required
            minLength={2}
            maxLength={160}
            autoComplete="organization"
            placeholder="Ex.: CAS Internet · Centro"
            value={name}
            disabled={busy || Boolean(created)}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {created && (
          <div className="flow-note">
            Filial criada: {created.name}. Seu acesso já está liberado.
          </div>
        )}
        {error && (
          <p className="alert error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-footer">
          <ModalCloseButton disabled={busy}>{created ? 'Fechar' : 'Cancelar'}</ModalCloseButton>
          <button className="primary" disabled={busy}>
            <Plus size={16} />
            {busy ? 'Preparando filial…' : created ? 'Acessar filial' : 'Criar e acessar filial'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
