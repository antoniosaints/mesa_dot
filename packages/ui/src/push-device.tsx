import { useEffect, useRef, useState } from 'react';
import { BellRing } from 'lucide-react';
import { api, session, type Data } from './client.js';
import { Icon } from './appearance.js';
import { Modal, useAction } from './common.js';
import { TableLoading } from './pagination.js';
type Surface = 'admin' | 'waiter' | 'kitchen';
function supported() {
  return (
    isSecureContext &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}
async function digest(value: string) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
function applicationKey(value: string) {
  const bytes = atob(
    value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4),
  );
  const result = new Uint8Array(new ArrayBuffer(bytes.length));
  for (let i = 0; i < bytes.length; i++) result[i] = bytes.charCodeAt(i);
  return result;
}
function defaultName() {
  return /iPhone|iPad/.test(navigator.userAgent)
    ? 'iPhone / iPad'
    : /Android/.test(navigator.userAgent)
      ? 'Celular Android'
      : /Windows/.test(navigator.userAgent)
        ? 'Computador Windows'
        : /Mac/.test(navigator.userAgent)
          ? 'Computador Mac'
          : 'Meu dispositivo';
}
export function PushDeviceButton({ surface }: { surface: Surface }) {
  const current = session(),
    scope = current?.actor?.id + ':' + current?.actor?.establishmentId + ':' + surface;
  const enabledKey = 'mesa:push-enabled:' + scope;
  const [open, setOpen] = useState(false),
    [context, setContext] = useState<Data | null>(null),
    [device, setDevice] = useState<Data | null>(null),
    [name, setName] = useState(defaultName),
    [loading, setLoading] = useState(false),
    [error, setError] = useState('');
  const native = useRef<PushSubscription | null>(null),
    lock = useRef(false);
  const { busy, run } = useAction();
  const compatible = supported();
  async function load(reconcile = false) {
    if (lock.current) return;
    lock.current = true;
    setLoading(true);
    try {
      const value = await api('/push/context');
      setContext(value);
      setError('');
      let found: Data | undefined;
      if (compatible && Notification.permission === 'granted') {
        native.current =
          (await (
            await navigator.serviceWorker.getRegistration('/')
          )?.pushManager.getSubscription()) ?? null;
        if (native.current) {
          const endpointHash = await digest(native.current.endpoint);
          found = value.subscriptions.find((row: Data) => row.endpoint_hash === endpointHash);
        }
      }
      setDevice(found ?? null);
      if (
        reconcile &&
        found?.enabled &&
        native.current &&
        localStorage.getItem(enabledKey) === '1' &&
        value.public_key &&
        found.vapid_key_hash === (await digest(value.public_key))
      ) {
        const result = await api('/push/subscriptions', {
          subscription: native.current.toJSON(),
          origin: location.origin,
          surface,
          device_name: found.device_name,
          activate: false,
        });
        setDevice({ ...found, enabled: result.enabled });
      }
      if (!found || !found.enabled) localStorage.removeItem(enabledKey);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'Não foi possível consultar as notificações.',
      );
    } finally {
      lock.current = false;
      setLoading(false);
    }
  }
  useEffect(() => {
    void load(true);
    const refresh = () => {
      if (document.visibilityState === 'visible') void load(true);
    };
    const timer = setInterval(refresh, 30 * 60_000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [scope]);
  async function activate() {
    // Permission is requested only from this explicit click, before unrelated asynchronous work.
    const permission =
      Notification.permission === 'default'
        ? Notification.requestPermission()
        : Promise.resolve(Notification.permission);
    await run(async () => {
      if ((await permission) !== 'granted')
        throw new Error('Permita notificações nas configurações deste navegador para continuar.');
      await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const old = subscription.options.applicationServerKey,
          wanted = applicationKey(context!.public_key);
        if (
          !old ||
          new Uint8Array(old).some((byte, i) => byte !== wanted[i]) ||
          old.byteLength !== wanted.byteLength
        ) {
          await subscription.unsubscribe();
          subscription = null;
        }
      }
      subscription ??= await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationKey(context!.public_key),
      });
      await api('/push/subscriptions', {
        subscription: subscription.toJSON(),
        origin: location.origin,
        surface,
        device_name: name.trim() || defaultName(),
        activate: true,
      });
      localStorage.setItem(enabledKey, '1');
      native.current = subscription;
      await load();
    }, 'Notificações ativadas neste dispositivo.');
  }
  const active = Boolean(device?.enabled && compatible && Notification.permission === 'granted');
  return (
    <>
      <button
        className={`push-device-trigger ${active ? 'is-enabled' : ''}`}
        aria-label="Notificações push deste dispositivo"
        title="Notificações push deste dispositivo"
        onClick={() => {
          setOpen(true);
          void load();
        }}
      >
        <BellRing size={17} />
        <span>Push</span>
        {active && <i />}
      </button>
      {open && (
        <Modal
          title="Notificações neste dispositivo"
          onClose={() => setOpen(false)}
          closeDisabled={busy}
        >
          <div className="stack">
            <div className="flow-note">
              <Icon name="bell" size={18} />
              <span>
                Receba avisos desta filial mesmo com o aplicativo em segundo plano. O administrador
                define os eventos e os perfis autorizados.
              </span>
            </div>
            {loading && !context ? (
              <TableLoading label="Consultando notificações…" />
            ) : (
              <>
                <div className="push-device-status">
                  <span className={active ? 'success-text' : 'muted'}>
                    <Icon name={active ? 'ready' : 'info'} size={18} />
                    {active ? 'Ativado nesta filial' : 'Ainda não ativado neste dispositivo'}
                  </span>
                </div>
                {!compatible && (
                  <p className="alert">
                    Este navegador precisa de HTTPS (ou localhost) e suporte a Web Push. No iPhone e
                    iPad, instale o aplicativo na Tela de Início e abra por ele.
                  </p>
                )}
                {context && !context.configured && (
                  <p className="alert">
                    O Web Push ainda precisa ser configurado no servidor pelo administrador.
                  </p>
                )}
                {context?.configured && !context.enabled && (
                  <p className="muted small">
                    Os eventos estão pausados pelo administrador nesta filial. Você pode ativar o
                    dispositivo e enviar um teste.
                  </p>
                )}
                {compatible && Notification.permission === 'denied' && (
                  <p className="alert">
                    As notificações estão bloqueadas no navegador. Libere a permissão nas
                    configurações do site.
                  </p>
                )}
                {!active && (
                  <label>
                    Nome do dispositivo
                    <input
                      value={name}
                      maxLength={100}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="Ex.: Celular do salão"
                    />
                  </label>
                )}
                {active && (
                  <p className="muted small">
                    Dispositivo: {device?.device_name}. Os avisos respeitam seu acesso à filial e
                    deixam de ser enviados ao sair da conta.
                  </p>
                )}
                {error && (
                  <p className="alert error" role="alert">
                    {error}
                  </p>
                )}
                <div className="modal-footer push-device-actions">
                  <button disabled={busy || loading} onClick={() => void load()}>
                    <Icon name="refresh" size={16} />
                    Atualizar
                  </button>
                  {active ? (
                    <>
                      <button
                        disabled={busy}
                        className="danger"
                        onClick={() =>
                          void run(async () => {
                            await api('/push/subscriptions/' + device!.id, undefined, 'DELETE');
                            localStorage.removeItem(enabledKey);
                            setDevice(null);
                            await load();
                          }, 'Notificações desativadas nesta filial.')
                        }
                      >
                        <Icon name="close" size={16} />
                        Desativar nesta filial
                      </button>
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await api('/push/subscriptions/' + device!.id + '/test', {});
                          }, 'Teste adicionado à fila de notificações.')
                        }
                      >
                        <Icon name="send" size={16} />
                        Enviar teste
                      </button>
                    </>
                  ) : (
                    <button
                      className="primary"
                      disabled={
                        busy ||
                        loading ||
                        !compatible ||
                        !context?.configured ||
                        Notification.permission === 'denied'
                      }
                      onClick={() => void activate()}
                    >
                      <Icon name="bell" size={16} />
                      Ativar notificações
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
