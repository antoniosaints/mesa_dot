import { useState } from 'react';
import { PwaCustomizationModal } from './pwa-customization.js';
import {
  Smartphone,
  Copy,
  ExternalLink,
  ImagePlus,
  ShieldCheck,
  Palette,
  Download,
  Link as LinkIcon,
} from 'lucide-react';
import { api, type Data } from './client.js';
import { Icon } from './appearance.js';
import { Code, useRefresh } from './common.js';
import { TableLoading } from './pagination.js';
import { iconPath, stableBase } from '../../shared/src/pwa.js';
import { appearanceStore, primaryForeground } from './preferences.js';
import { useToasts } from './toasts.js';
export function PwaSettings({
  settings,
  onChange,
}: {
  settings: Data;
  onChange: () => Promise<void>;
}) {
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(''),
    [editing, setEditing] = useState(false);
  const toast = useToasts();
  async function load() {
    try {
      setData(await api('/settings/pwa'));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useRefresh(load, [settings.name, settings.primary_color]);
  if (!data)
    return error ? (
      <div role="alert" className="alert error">
        {error}
        <button onClick={() => void load()}>Tentar novamente</button>
      </div>
    ) : (
      <TableLoading label="Carregando aplicativo do estabelecimento…" />
    );
  const origin = (import.meta.env.VITE_CUSTOMER_URL ?? 'http://localhost:5174').replace(/\/$/, ''),
    url = origin + data.public_path,
    launch = origin + stableBase(data.establishment_id);
  return (
    <section className="panel pwa-settings business-setting-card">
      <div className="section-head">
        <h2>
          <span className="business-section-symbol">
            <Smartphone size={19} />
          </span>
          Identidade visual e aplicativo
        </h2>
        <button
          className="business-card-edit"
          aria-label="Atualizar aplicativo"
          title="Atualizar aplicativo"
          onClick={() => void load()}
        >
          <Icon name="refresh" size={16} />
        </button>
      </div>
      <p className="muted small">Sua marca no cardápio e na tela inicial do celular.</p>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      <div
        className="pwa-phone-preview"
        style={{
          background: data.background_color,
          color: primaryForeground(data.background_color),
        }}
      >
        <div className="pwa-app-identity">
          <img src={iconPath(data as any, 192)} alt="Ícone do aplicativo" width="64" height="64" />
          <div>
            <strong>{data.name}</strong>
            <span>{data.short_name}</span>
          </div>
        </div>
        <div className="pwa-preview-caption">
          <Smartphone size={14} />
          Aplicativo do estabelecimento<span>Prévia</span>
        </div>
      </div>
      <div className="pwa-colors">
        <Palette size={15} />
        <span style={{ background: data.primary_color }} />
        Principal <code>{data.primary_color}</code>
        <span style={{ background: data.background_color }} />
        Fundo <code>{data.background_color}</code>
      </div>
      <button className="primary pwa-customize-button" onClick={() => setEditing(true)}>
        <ImagePlus size={16} />
        Personalizar aplicativo
      </button>
      <div className="pwa-card-divider" />
      <h3 className="business-subsection-heading">
        <LinkIcon size={17} />
        Acesso ao cardápio
      </h3>
      <div className="pwa-access-grid">
        <div className="pwa-public-info">
          <label>
            Endereço gerado automaticamente
            <input readOnly value={data.slug} />
          </label>
          <label>
            URL pública
            <input readOnly value={url} />
          </label>
        </div>
        <div className="pwa-qr">
          <Code value={url} />
          <span>QR do cardápio</span>
        </div>
      </div>
      <div className="pwa-access-actions">
        <button
          onClick={() =>
            void navigator.clipboard
              .writeText(url)
              .then(() => toast.success('Link copiado.'))
              .catch(() => toast.error('Não foi possível copiar. Selecione o endereço acima.'))
          }
        >
          <Copy size={15} />
          Copiar link
        </button>
        <a className="pwa-launch-link" href={url} target="_blank" rel="noreferrer">
          <ExternalLink size={15} />
          Abrir cardápio
        </a>
      </div>
      <p className="field-hint">
        O endereço acompanha o nome do negócio. Links anteriores e aplicativos já instalados
        continuam funcionando após uma alteração.
      </p>
      <details className="pwa-install-guide">
        <summary>
          <Download size={16} />
          Como instalar o aplicativo
        </summary>
        <p>
          Abra{' '}
          <a href={launch} target="_blank" rel="noreferrer">
            o link de instalação
          </a>{' '}
          no dispositivo.
        </p>
        <ol>
          <li>
            <strong>Android ou computador:</strong> no Chrome/Edge, use Instalar aplicativo.
          </li>
          <li>
            <strong>iPhone/iPad:</strong> no Safari, use Compartilhar → Adicionar à Tela de Início.
          </li>
        </ol>
        <p>
          O link de instalação é permanente. Alterações de nome ou ícone podem exigir atualização ou
          reinstalação pelo navegador.
        </p>
      </details>
      <div className="business-public-note">
        <ShieldCheck size={16} />
        <p>
          O aplicativo pertence a esta filial. O acesso da equipe continua protegido por login e
          permissões.
        </p>
      </div>
      {editing && (
        <PwaCustomizationModal
          data={data}
          onClose={() => setEditing(false)}
          onSaved={async (updated) => {
            setData(updated);
            appearanceStore.setPrimary(updated.primary_color);
            window.dispatchEvent(new Event('mesa:pwa-refresh'));
            await onChange();
            setEditing(false);
          }}
        />
      )}
    </section>
  );
}
