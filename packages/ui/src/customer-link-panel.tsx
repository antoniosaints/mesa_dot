import { Copy, ExternalLink, QrCode } from 'lucide-react';
import { accessUrl, useAccessIdentity } from './access-links.js';
import { copyText } from './clipboard.js';
import { useToasts } from './toasts.js';
export function CustomerLinkPanel() {
  const { identity, error } = useAccessIdentity();
  const toast = useToasts();
  let url = '',
    failure = error;
  try {
    if (identity) url = accessUrl('customer', identity.slug);
  } catch (reason) {
    failure = (reason as Error).message;
  }
  return (
    <section className="panel customer-link-panel" aria-label="Compartilhar cardápio online">
      <div className="customer-link-heading">
        <span className="customer-link-icon">
          <QrCode size={23} />
        </span>
        <div>
          <h2>Cardápio online</h2>
          <p className="small muted">
            Envie ao cliente para consultar o cardápio, ler uma mesa ou pedir para retirada.
          </p>
        </div>
      </div>
      <div className="customer-link-actions">
        <label>
          <span className="sr-only">Link do cliente</span>
          <input
            aria-label="Link do cliente"
            type="url"
            readOnly
            value={url}
            placeholder="Carregando endereço…"
            onFocus={(event) => event.target.select()}
          />
        </label>
        <button
          className="primary"
          disabled={!url || Boolean(failure)}
          onClick={() =>
            void copyText(url)
              .then(() => toast.success('Link do cliente copiado.'))
              .catch((reason) => toast.error(reason.message))
          }
        >
          <Copy size={16} />
          Copiar link do cliente
        </button>
        {url && (
          <a
            className="button"
            href={url}
            target="_blank"
            rel="noreferrer"
            aria-label="Abrir cardápio do cliente"
          >
            <ExternalLink size={16} />
          </a>
        )}
      </div>
      {failure && (
        <p className="field-error" role="alert">
          {failure}
        </p>
      )}
    </section>
  );
}
