import { useState } from 'react';
import {
  Smartphone,
  Copy,
  ExternalLink,
  ImagePlus,
  Save,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import { api, type Data } from './client.js';
import { Icon } from './appearance.js';
import { Code, Modal, ModalCloseButton, useAction, useRefresh } from './common.js';
import { TableLoading } from './pagination.js';
import { formValuesChanged } from './forms.js';
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
  const [values, setValues] = useState<Data>({}),
    [initial, setInitial] = useState<Data>({}),
    [image, setImage] = useState(''),
    [reset, setReset] = useState(false);
  const { run, busy } = useAction(),
    toast = useToasts();
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
  function edit() {
    const v = {
      short_name: data!.short_name,
      background_color: data!.background_color,
      primary_color: data!.primary_color,
    };
    setValues(v);
    setInitial(v);
    setImage('');
    setReset(false);
    setEditing(true);
  }
  async function choose(file: File | undefined) {
    if (!file) return;
    try {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5000000)
        throw new Error('Escolha PNG, JPEG ou WebP de até 5 MB.');
      const bitmap = await createImageBitmap(file);
      if (bitmap.width * bitmap.height > 16777216) {
        bitmap.close();
        throw new Error('A imagem deve ter no máximo 16 megapixels.');
      }
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 512;
      const ctx = canvas.getContext('2d')!;
      const ratio = Math.min(512 / bitmap.width, 512 / bitmap.height),
        w = bitmap.width * ratio,
        h = bitmap.height * ratio;
      ctx.drawImage(bitmap, (512 - w) / 2, (512 - h) / 2, w, h);
      bitmap.close();
      setImage(canvas.toDataURL('image/png').split(',')[1]);
      setReset(false);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  return (
    <section className="panel pwa-settings">
      <div className="section-head">
        <div>
          <h2>
            <Smartphone size={20} />
            Identidade visual e aplicativo
          </h2>
          <p className="muted small">
            Logotipo, cores, link do cardápio e instalação do aplicativo da unidade.
          </p>
        </div>
        <button onClick={() => void load()}>
          <Icon name="refresh" size={16} />
          Atualizar
        </button>
      </div>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      <div className="pwa-settings-grid">
        <div
          className="pwa-phone-preview"
          style={{
            background: data.background_color,
            color: primaryForeground(data.background_color),
          }}
        >
          <img src={iconPath(data as any, 192)} alt="Ícone do aplicativo" width="96" height="96" />
          <strong>{data.name}</strong>
          <span>{data.short_name}</span>
          <button className="primary" style={{ background: data.primary_color }} onClick={edit}>
            <Smartphone size={16} />
            Personalizar aplicativo
          </button>
        </div>
        <div className="pwa-public-info">
          <label>
            Endereço gerado automaticamente
            <input readOnly value={data.slug} />
          </label>
          <p className="field-hint">
            O aplicativo usa o nome cadastrado em Informações do negócio. O endereço é gerado
            automaticamente a partir dele. Alterações no nome podem modificar este endereço, sem
            afetar os dados cadastrados.
          </p>
          <label>
            URL pública
            <input readOnly value={url} />
          </label>
          <div className="button-row">
            <button
              onClick={() =>
                void navigator.clipboard
                  .writeText(url)
                  .then(() => toast.success('Link copiado.'))
                  .catch(() => toast.error('Não foi possível copiar. Selecione o endereço acima.'))
              }
            >
              <Copy size={16} />
              Copiar link
            </button>
            <a className="pwa-launch-link" href={url} target="_blank" rel="noreferrer">
              <ExternalLink size={16} />
              Abrir aplicativo
            </a>
          </div>
          <div className="pwa-colors">
            <span style={{ background: data.primary_color }} />
            Cor principal <code>{data.primary_color}</code>
            <span
              style={{
                background: data.background_color,
                color: primaryForeground(data.background_color),
              }}
            />
            Fundo <code>{data.background_color}</code>
          </div>
        </div>
        <div className="pwa-qr">
          <Code value={url} />
          <span>Escaneie para abrir o aplicativo</span>
        </div>
      </div>
      <div className="pwa-install-instructions">
        <h3>Instalação</h3>
        <p>
          Abra{' '}
          <a href={launch} target="_blank" rel="noreferrer">
            a versão estável de instalação
          </a>{' '}
          no dispositivo. No Chrome/Edge, use Instalar aplicativo. No Safari do iPhone/iPad, use
          Compartilhar → Adicionar à Tela de Início.
        </p>
        <p>
          A rota de abertura instalada utiliza o identificador interno e permanece estável após
          renomear a empresa. Navegadores podem exigir atualização ou reinstalação para mudar nome e
          ícone.
        </p>
      </div>
      <div className="team-security-note">
        <ShieldCheck size={16} />
        <p>
          Cada aplicativo mantém seu contexto de estabelecimento. A instalação não concede acesso
          administrativo; o login e as permissões continuam obrigatórios.
        </p>
      </div>
      {editing && (
        <Modal
          title="Personalizar aplicativo PWA"
          dirty={formValuesChanged(values, initial) || Boolean(image) || reset}
          closeDisabled={busy}
          onClose={() => setEditing(false)}
        >
          <form
            className="form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const updated = await api(
                  '/settings/pwa',
                  {
                    ...values,
                    ...(image ? { icon_base64: image } : {}),
                    ...(reset ? { reset_icon: true } : {}),
                  },
                  'PATCH',
                );
                setData(updated);
                appearanceStore.setPrimary(updated.primary_color);
                window.dispatchEvent(new Event('mesa:pwa-refresh'));
                await onChange();
                setEditing(false);
              }, 'Aplicativo atualizado.');
            }}
          >
            <label>
              Nome curto
              <input
                aria-label="Nome curto do aplicativo"
                required
                maxLength={32}
                value={values.short_name}
                onChange={(e) => setValues({ ...values, short_name: e.target.value })}
              />
            </label>
            <label>
              Cor principal
              <input
                type="color"
                aria-label="Cor principal do aplicativo"
                value={values.primary_color}
                onChange={(e) => setValues({ ...values, primary_color: e.target.value })}
              />
            </label>
            <label>
              Cor de fundo
              <input
                type="color"
                aria-label="Cor de fundo do aplicativo"
                value={values.background_color}
                onChange={(e) => setValues({ ...values, background_color: e.target.value })}
              />
            </label>
            <label className="pwa-upload">
              <ImagePlus size={18} />
              Logotipo
              <input
                type="file"
                aria-label="Logotipo do aplicativo"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => void choose(e.target.files?.[0])}
              />
              <span className="field-hint">
                PNG, JPEG ou WebP até 5 MB. O servidor gera os ícones com margem de segurança para
                instalação.
              </span>
            </label>
            {image && (
              <img
                className="pwa-icon-preview"
                src={'data:image/png;base64,' + image}
                alt="Prévia do logotipo selecionado"
              />
            )}
            <button
              type="button"
              onClick={() => {
                setReset(true);
                setImage('');
              }}
            >
              <RotateCcw size={16} />
              Usar ícone padrão
            </button>
            {reset && <p className="field-hint">O ícone padrão será aplicado ao salvar.</p>}
            <div className="modal-footer">
              <ModalCloseButton disabled={busy} />
              <button className="primary" disabled={busy}>
                <Save size={16} />
                {busy ? 'Salvando…' : 'Salvar aplicativo'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
