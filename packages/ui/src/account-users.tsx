import { useEffect, useRef, useState } from 'react';
import { Building2, Check, ShieldCheck, UserRound, X } from 'lucide-react';
import { api, session, type Data } from './client.js';
import { Modal, ModalCloseButton } from './common.js';
import { Pagination, TableLoading } from './pagination.js';
import { SearchSelect } from './controls.js';
import { useToasts } from './toasts.js';
const membershipFingerprint = (value: Record<string, string>) =>
  JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
export function AccountUsers({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged: () => void;
}) {
  const [data, setData] = useState<Data | null>(null),
    [search, setSearch] = useState(''),
    [page, setPage] = useState(1),
    [size, setSize] = useState(10),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [selected, setSelected] = useState(''),
    [version, setVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const timer = setTimeout(() => {
      void api(
        '/account/users?' +
          new URLSearchParams({ page: String(page), page_size: String(size), search }),
        undefined,
        undefined,
        undefined,
        'json',
        controller.signal,
      )
        .then((result) => {
          if (!controller.signal.aborted) {
            setData(result);
            if (result.page !== page) setPage(result.page);
          }
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(e.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search, page, size, version]);
  return (
    <Modal title="Usuários e filiais da conta" className="account-users-modal" onClose={onClose}>
      <div className="account-users-intro">
        <ShieldCheck size={20} />
        <p>
          O usuário usa o mesmo e-mail e senha em todas as filiais vinculadas. Defina um perfil para
          cada filial; os dados da operação continuam separados.
        </p>
      </div>
      <label className="account-users-search">
        Buscar usuário
        <input
          type="search"
          aria-label="Buscar usuário da conta"
          value={search}
          maxLength={120}
          placeholder="Nome ou e-mail…"
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
      </label>
      {error ? (
        <div className="alert error" role="alert">
          {error}
          <button onClick={() => setVersion((v) => v + 1)}>Tentar novamente</button>
        </div>
      ) : loading ? (
        <TableLoading label="Carregando usuários da conta…" />
      ) : (
        <div className="account-user-list">
          {data?.rows.map((user: Data) => (
            <article key={user.id}>
              <span className="account-user-avatar">
                <UserRound size={20} />
              </span>
              <div>
                <strong>{user.name}</strong>
                {Boolean(user.is_account_admin) && <span className="badge info">Admin geral</span>}
                <small>{user.email}</small>
                <div className="account-user-branches">
                  {user.branches.map((branch: Data) => (
                    <span key={branch.id}>
                      <Building2 size={12} />
                      {branch.name}
                      <small>· {branch.role_name}</small>
                    </span>
                  ))}
                  {!user.branches.length && <small>Sem acesso a filiais</small>}
                </div>
              </div>
              <button
                onClick={() => setSelected(user.id)}
                aria-label={'Definir filiais de ' + user.name}
              >
                <Building2 size={15} />
                Definir filiais
              </button>
            </article>
          ))}
          {!data?.rows.length && <p className="empty">Nenhum usuário encontrado nesta conta.</p>}
        </div>
      )}
      <Pagination
        label="Usuários da conta"
        total={data?.total ?? 0}
        page={page}
        pageSize={size}
        loading={loading}
        onPageChange={setPage}
        onPageSizeChange={setSize}
      />
      <div className="modal-footer">
        <ModalCloseButton>Fechar</ModalCloseButton>
      </div>
      {selected && (
        <UserBranches
          userId={selected}
          onClose={() => setSelected('')}
          onSaved={() => {
            setSelected('');
            setVersion((v) => v + 1);
            onChanged();
          }}
        />
      )}
    </Modal>
  );
}
export function UserBranches({
  userId,
  onClose,
  onSaved,
}: {
  userId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [data, setData] = useState<Data | null>(null),
    [selected, setSelected] = useState<Record<string, string>>({}),
    [original, setOriginal] = useState(''),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [version, setVersion] = useState(0);
  const attempt = useRef({ body: '', key: crypto.randomUUID() }),
    toast = useToasts();
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void api(
      '/account/users/' + userId + '/branches',
      undefined,
      undefined,
      undefined,
      'json',
      controller.signal,
    )
      .then((result) => {
        if (!controller.signal.aborted) {
          const initial = Object.fromEntries(
            result.branches
              .filter((branch: Data) => branch.enabled)
              .map((branch: Data) => [branch.id, branch.role_id]),
          );
          setData(result);
          setSelected(initial);
          setOriginal(membershipFingerprint(initial));
          setError('');
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [userId, version]);
  const dirty = Boolean(data) && membershipFingerprint(selected) !== original;
  const self = userId === session()?.actor?.id;
  return (
    <Modal
      title={data ? 'Filiais de ' + data.user.name : 'Definir filiais do usuário'}
      className="user-branches-modal"
      onClose={onClose}
      dirty={dirty}
      closeDisabled={busy}
    >
      {loading ? (
        <TableLoading label="Carregando filiais e perfis…" />
      ) : data ? (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError('');
            try {
              const body = {
                expected_version: data.version,
                branches: Object.entries(selected)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([establishment_id, role_id]) => ({
                    establishment_id,
                    role_id,
                  })),
              };
              const fingerprint = JSON.stringify(body);
              if (attempt.current.body !== fingerprint)
                attempt.current = { body: fingerprint, key: crypto.randomUUID() };
              await api(
                '/account/users/' + userId + '/branches',
                body,
                'PATCH',
                attempt.current.key,
              );
              toast.success('Filiais e perfis atualizados.');
              onSaved();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="branch-user-heading">
            <UserRound size={25} />
            <div>
              <strong>{data.user.name}</strong>
              <small>{data.user.email}</small>
            </div>
            <span>{Object.keys(selected).length} filial(is)</span>
          </div>
          <p className="field-hint">
            Marque as filiais permitidas e escolha o perfil em cada uma. Ao remover uma filial ou
            alterar o perfil, as sessões dessa filial serão encerradas.
          </p>
          <div className="branch-access-list">
            {data.branches.map((branch: Data) => {
              const protectedSelf = self && branch.id === data.current_id;
              const enabled = Object.hasOwn(selected, branch.id);
              return (
                <section className={enabled ? 'is-selected' : ''} key={branch.id}>
                  <div>
                    <label className="branch-checkbox">
                      <input
                        type="checkbox"
                        aria-label={'Permitir acesso a ' + branch.name}
                        checked={enabled}
                        disabled={busy || protectedSelf}
                        onChange={(event) =>
                          setSelected((previous) => {
                            const next = { ...previous };
                            if (event.target.checked)
                              next[branch.id] =
                                branch.role_id ??
                                branch.roles.find((role: Data) => role.name === 'Garçom')?.id ??
                                branch.roles[0]?.id ??
                                '';
                            else delete next[branch.id];
                            return next;
                          })
                        }
                      />
                      <span>
                        <strong>{branch.name}</strong>
                        <small>
                          {protectedSelf
                            ? 'Seu acesso atual está protegido'
                            : '/' + branch.slug + '/'}
                        </small>
                      </span>
                    </label>
                    {enabled ? <Check size={16} /> : <X size={16} />}
                  </div>
                  {enabled && (
                    <label>
                      Perfil nesta filial
                      <SearchSelect
                        label={'Perfil em ' + branch.name}
                        value={selected[branch.id]}
                        onChange={(value) => setSelected({ ...selected, [branch.id]: value })}
                        options={branch.roles.map((role: Data) => ({
                          id: role.id,
                          name: role.name,
                        }))}
                        required
                        allowClear={false}
                        disabled={busy || protectedSelf}
                      />
                    </label>
                  )}
                </section>
              );
            })}
          </div>
          {error && (
            <div className="alert error" role="alert">
              {error}
            </div>
          )}
          <div className="modal-footer">
            <ModalCloseButton disabled={busy} />
            <button className="primary" disabled={busy || !dirty}>
              <Check size={16} />
              {busy ? 'Salvando acessos…' : 'Salvar filiais'}
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="alert error" role="alert">
            {error || 'Não foi possível carregar os vínculos.'}
          </div>
          <button onClick={() => setVersion((v) => v + 1)}>Tentar novamente</button>
        </>
      )}
    </Modal>
  );
}
