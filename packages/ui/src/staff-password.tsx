import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, KeyRound, ShieldCheck } from 'lucide-react';
import { api, type Data } from './client.js';
import { Modal, ModalCloseButton } from './common.js';
import { useToasts } from './toasts.js';

export function StaffPassword({ member, onClose }: { member: Data; onClose: () => void }) {
  const [password, setPassword] = useState(''),
    [confirmation, setConfirmation] = useState(''),
    [visible, setVisible] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const confirmInput = useRef<HTMLInputElement>(null),
    locked = useRef(false),
    alive = useRef(true),
    attempt = useRef({ password: '', key: crypto.randomUUID() });
  const toast = useToasts();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function save() {
    if (locked.current) return;
    if (password !== confirmation) {
      setError('As senhas não conferem. Verifique a confirmação.');
      confirmInput.current?.focus();
      return;
    }
    locked.current = true;
    setBusy(true);
    setError('');
    if (attempt.current.password !== password)
      attempt.current = { password, key: crypto.randomUUID() };
    try {
      await api('/staff/' + member.id + '/password', { password }, 'POST', attempt.current.key);
      if (alive.current) {
        toast.success('Senha alterada. As sessões anteriores do funcionário foram encerradas.');
        onClose();
      }
    } catch (problem) {
      if (alive.current) setError((problem as Error).message);
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <Modal
      title={'Alterar senha · ' + member.name}
      className="staff-password-modal"
      dirty={Boolean(password || confirmation)}
      closeDisabled={busy}
      onClose={onClose}
    >
      <p className="modal-description">
        Defina uma nova senha de acesso para <strong>{member.name}</strong> · {member.email}.
      </p>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void save();
        }}
      >
        <label>
          Nova senha
          <span className="credential-password-field">
            <input
              aria-label="Nova senha"
              type={visible ? 'text' : 'password'}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setError('');
              }}
              minLength={12}
              maxLength={200}
              required
              autoComplete="new-password"
              disabled={busy}
            />
            <button
              type="button"
              className="icon-button"
              aria-label={visible ? 'Ocultar senhas' : 'Mostrar senhas'}
              aria-pressed={visible}
              onClick={() => setVisible(!visible)}
            >
              <span aria-hidden="true">{visible ? <EyeOff size={16} /> : <Eye size={16} />}</span>
            </button>
          </span>
          <small className="field-hint">Use de 12 a 200 caracteres.</small>
        </label>
        <label>
          Confirmar nova senha
          <input
            aria-label="Confirmar nova senha"
            ref={confirmInput}
            type={visible ? 'text' : 'password'}
            value={confirmation}
            onChange={(event) => {
              setConfirmation(event.target.value);
              setError('');
            }}
            minLength={12}
            maxLength={200}
            required
            autoComplete="new-password"
            disabled={busy}
          />
        </label>
        <div className="notice">
          <ShieldCheck size={18} />
          <span>
            A senha é compartilhada entre as filiais da conta. As sessões anteriores desse
            funcionário serão encerradas.
          </span>
        </div>
        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-footer">
          <ModalCloseButton disabled={busy} />
          <button type="submit" className="primary" disabled={busy}>
            <KeyRound size={16} />
            {busy ? 'Salvando…' : 'Salvar nova senha'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
