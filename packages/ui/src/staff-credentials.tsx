import { useRef, useState } from 'react';
import { Copy, Eye, EyeOff, KeyRound, RefreshCw } from 'lucide-react';
import type { PwaSurface } from '../../shared/src/pwa.js';
import { surfaceNames } from '../../shared/src/pwa.js';
import { credentialsText } from '../../shared/src/access-links.js';
import { api, session, type Data } from './client.js';
import { Modal, ModalCloseButton } from './common.js';
import { copyText } from './clipboard.js';
import { accessUrl, useAccessIdentity } from './access-links.js';
import { useToasts } from './toasts.js';
export function StaffCredentials({
  member,
  initialPassword = '',
  onClose,
}: {
  member: Data;
  initialPassword?: string;
  onClose: () => void;
}) {
  const { identity, error: identityError } = useAccessIdentity();
  const [password, setPassword] = useState(initialPassword),
    [visible, setVisible] = useState(false),
    [reset, setReset] = useState(false),
    [saved, setSaved] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const attempt = useRef({ password: '', key: crypto.randomUUID() }),
    locked = useRef(false);
  const toast = useToasts();
  const surface = (member.access_surface ?? 'admin') as PwaSurface;
  let url = '',
    urlError = '';
  try {
    if (identity) url = accessUrl(surface, identity.slug);
  } catch (reason) {
    urlError = (reason as Error).message;
  }
  const mayReset = session()?.actor?.isAccountAdmin && member.user_id !== session()?.actor?.id;
  async function copy() {
    if (locked.current || !identity || !url || !password) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      if (reset && !saved) {
        if (attempt.current.password !== password)
          attempt.current = { password, key: crypto.randomUUID() };
        await api(`/staff/${member.id}/password`, { password }, 'POST', attempt.current.key);
        setSaved(true);
        toast.success('Nova senha salva. As sessões anteriores do funcionário foram encerradas.');
      }
      await copyText(
        credentialsText({
          name: member.name,
          role: member.role_name,
          venue: identity.name,
          url,
          email: member.email,
          password,
        }),
      );
      toast.success('Credenciais copiadas. Envie ao funcionário.');
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      title={'Copiar credenciais · ' + member.name}
      className="staff-credentials-modal"
      closeDisabled={busy}
      dirty={Boolean(reset && password && !saved)}
      onClose={onClose}
    >
      <p className="modal-description">
        O acesso será copiado com o endereço de {surfaceNames[surface]}, perfil, e-mail e senha para
        enviar ao funcionário.
      </p>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          void copy();
        }}
      >
        <div className="access-link-fields">
          <label>
            Link de acesso
            <input type="url" value={url} readOnly onFocus={(event) => event.target.select()} />
          </label>
          <label>
            E-mail de acesso
            <input
              type="email"
              value={member.email}
              readOnly
              onFocus={(event) => event.target.select()}
            />
          </label>
        </div>
        {initialPassword ? (
          <p className="notice" role="status">
            A senha recém-cadastrada está disponível para copiar enquanto este modal estiver aberto.
          </p>
        ) : (
          <>
            <p className="field-hint">
              A senha atual é protegida e não pode ser recuperada. Informe a senha conhecida para
              incluí-la na cópia.
            </p>
            {mayReset && (
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={reset}
                  disabled={busy || saved}
                  onChange={(event) => {
                    setReset(event.target.checked);
                    setPassword('');
                    setError('');
                  }}
                />
                Definir uma nova senha para este funcionário
              </label>
            )}
          </>
        )}
        <label>
          {reset ? 'Nova senha' : 'Senha de acesso'}
          <span className="credential-password-field">
            <input
              type={visible ? 'text' : 'password'}
              value={password}
              minLength={reset ? 12 : 1}
              maxLength={200}
              required
              autoComplete="off"
              disabled={busy || saved}
              onChange={(event) => setPassword(event.target.value)}
            />
            <button
              type="button"
              className="icon-button"
              aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'}
              aria-pressed={visible}
              onClick={() => setVisible(!visible)}
            >
              {visible ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </span>
        </label>
        {reset && !saved && (
          <div className="alert warning">
            <KeyRound size={18} />
            <span>
              Ao confirmar, a nova senha substituirá a atual e encerrará as sessões do funcionário
              em todas as unidades da conta. Use pelo menos 12 caracteres.
            </span>
          </div>
        )}
        {saved && (
          <p className="notice" role="status">
            Nova senha salva. Você pode copiar novamente sem alterar a senha.
          </p>
        )}
        {(error || identityError || urlError) && (
          <div className="alert error" role="alert">
            {error || identityError || urlError}
          </div>
        )}
        <div className="modal-footer">
          <ModalCloseButton disabled={busy}>Concluir</ModalCloseButton>
          <button
            className="primary"
            disabled={busy || !url || !password || Boolean(identityError || urlError)}
          >
            {busy ? <RefreshCw size={16} className="spin" /> : <Copy size={16} />}
            {reset && !saved ? 'Salvar nova senha e copiar' : 'Copiar credenciais'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
