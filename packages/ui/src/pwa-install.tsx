import { useEffect, useRef, useState } from 'react';
import { Download, Smartphone, ExternalLink } from 'lucide-react';
import { Modal, ModalCloseButton } from './common.js';
import { pwaContext, usePwaIdentity } from './pwa-context.js';
import { stableBase, safePwaSearch } from '../../shared/src/pwa.js';
export function InstallPwaButton() {
  const identity = usePwaIdentity(),
    [open, setOpen] = useState(false),
    [available, setAvailable] = useState(false),
    pending = useRef<any>(null);
  useEffect(() => {
    const install = (event: Event) => {
      event.preventDefault();
      pending.current = event;
      setAvailable(true);
    };
    window.addEventListener('beforeinstallprompt', install);
    return () => window.removeEventListener('beforeinstallprompt', install);
  }, []);
  if (!identity) return null;
  const query = safePwaSearch(new URLSearchParams(location.search), identity.surface),
    launch = stableBase(identity.establishment_id) + (query ? '?' + query : '');
  return (
    <>
      <button type="button" className="pwa-install-button" onClick={() => setOpen(true)}>
        <Smartphone size={16} />
        Instalar aplicativo
      </button>
      {open && (
        <Modal title="Instalar aplicativo" onClose={() => setOpen(false)}>
          <p className="modal-description">
            Abra o aplicativo de {identity.name} diretamente pela tela inicial do seu dispositivo.
          </p>
          {pwaContext()?.base_path !== stableBase(identity.establishment_id) ? (
            <p>
              <a className="pwa-launch-link" href={launch}>
                <ExternalLink size={16} />
                Abrir a versão de instalação
              </a>
            </p>
          ) : (
            available && (
              <button
                className="primary"
                onClick={() => {
                  void pending.current?.prompt();
                  pending.current = null;
                  setAvailable(false);
                }}
              >
                <Download size={16} />
                Instalar neste dispositivo
              </button>
            )
          )}
          <ol className="pwa-install-instructions">
            <li>
              Chrome ou Edge: use “Instalar aplicativo” no menu do navegador quando disponível.
            </li>
            <li>
              No iPhone ou iPad, abra no Safari e use Compartilhar → Adicionar à Tela de Início.
            </li>
            <li>
              Se a opção não aparecer, abra o endereço no navegador principal, fora do navegador de
              outro aplicativo.
            </li>
          </ol>
          <p className="field-hint">
            A instalação e a atualização de nome e ícone variam por navegador. Instalações antigas
            podem precisar ser atualizadas ou reinstaladas. A instalação não substitui o login e
            pedidos exigem conexão.
          </p>
          <div className="modal-footer">
            <ModalCloseButton>Entendi</ModalCloseButton>
          </div>
        </Modal>
      )}
    </>
  );
}
