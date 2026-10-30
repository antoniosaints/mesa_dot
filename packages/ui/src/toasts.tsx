import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './appearance.js';
type ToastKind = 'success' | 'error' | 'info';
interface Notice {
  id: string;
  kind: ToastKind;
  message: string;
}
const ToastContext = createContext<(kind: ToastKind, message: string) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const notify = useCallback((kind: ToastKind, message: string) => {
    setNotices((previous) => [...previous.slice(-3), { id: crypto.randomUUID(), kind, message }]);
  }, []);
  const remove = useCallback(
    (id: string) => setNotices((previous) => previous.filter((n) => n.id !== id)),
    [],
  );
  return (
    <ToastContext.Provider value={notify}>
      {children}
      {createPortal(
        <section className="toast-region" aria-label="Notificações do sistema">
          {notices.map((notice) => (
            <ToastItem key={notice.id} notice={notice} remove={remove} />
          ))}
        </section>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}
function ToastItem({ notice, remove }: { notice: Notice; remove: (id: string) => void }) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(() => remove(notice.id), notice.kind === 'error' ? 10000 : 6000);
    return () => clearTimeout(timer);
  }, [notice.id, notice.kind, paused, remove]);
  return (
    <div
      className={`toast toast-${notice.kind}`}
      role={notice.kind === 'error' ? 'alert' : 'status'}
      aria-atomic="true"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span className="toast-symbol">
        <Icon
          name={notice.kind === 'success' ? 'check' : notice.kind === 'error' ? 'close' : 'bell'}
          size={20}
        />
      </span>
      <div>
        <strong>
          {notice.kind === 'success'
            ? 'Tudo certo'
            : notice.kind === 'error'
              ? 'Não foi possível concluir'
              : 'Informação'}
        </strong>
        <p>{notice.message}</p>
      </div>
      <button
        type="button"
        className="icon-button"
        aria-label="Fechar notificação"
        onClick={() => remove(notice.id)}
      >
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}
export function useToasts() {
  const notify = useContext(ToastContext);
  return {
    success: (message: string) => notify('success', message),
    error: (message: string) => notify('error', message),
    info: (message: string) => notify('info', message),
  };
}
