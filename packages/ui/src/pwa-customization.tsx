import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import {
  Smartphone,
  Palette,
  ImagePlus,
  Save,
  RotateCcw,
  Upload,
  Eye,
  Check,
  Type,
  UtensilsCrossed,
  LoaderCircle,
} from 'lucide-react';
import { api, type Data } from './client.js';
import { Modal, ModalCloseButton, useAction } from './common.js';
import { formValuesChanged } from './forms.js';
import { iconPath } from '../../shared/src/pwa.js';
import { appearancePresets, primaryForeground, validColor } from './preferences.js';
const primaryPresets = appearancePresets
  .slice(0, 6)
  .map((preset) => ({ name: preset.name, color: preset.primary }));
const backgroundPresets = [
  { name: 'Branco', color: '#ffffff' },
  { name: 'Cinza claro', color: '#f5f7fb' },
  { name: 'Azul escuro', color: '#0d1b2a' },
  { name: 'Grafite', color: '#0f172a' },
];
function ColorField({
  label,
  value,
  onChange,
  presets,
  disabled,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  presets: { name: string; color: string }[];
  disabled: boolean;
  hint: string;
}) {
  const id = useId(),
    [touched, setTouched] = useState(false);
  const invalid = touched && !validColor(value);
  return (
    <div className="pwa-color-field">
      <label htmlFor={id}>{label}</label>
      <div className={'pwa-color-control' + (invalid ? ' is-invalid' : '')}>
        <input
          id={id}
          type="color"
          aria-label={label + ' do aplicativo'}
          value={validColor(value) ? value : '#ffffff'}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
        <input
          aria-label={label + ' em hexadecimal'}
          type="text"
          spellCheck={false}
          autoComplete="off"
          required
          pattern="#[0-9a-fA-F]{6}"
          maxLength={7}
          placeholder="#000000"
          value={value}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={id + '-hint'}
          onBlur={() => setTouched(true)}
          onInvalid={() => setTouched(true)}
          onChange={(event) => onChange(event.target.value.toLowerCase())}
        />
      </div>
      <div className="pwa-color-presets" aria-label={'Cores rápidas: ' + label.toLowerCase()}>
        {presets.map((preset) => (
          <button
            key={preset.color}
            type="button"
            aria-label={label + ': ' + preset.name}
            title={preset.name}
            aria-pressed={value.toLowerCase() === preset.color}
            disabled={disabled}
            style={{ background: preset.color, color: primaryForeground(preset.color) }}
            onClick={() => onChange(preset.color)}
          >
            {value.toLowerCase() === preset.color && <Check size={13} />}
          </button>
        ))}
      </div>
      {invalid && (
        <span className="field-error" role="alert">
          Use o formato #RRGGBB, como #2584f8.
        </span>
      )}
      <p className="field-hint" id={id + '-hint'}>
        {hint}
      </p>
    </div>
  );
}
export function PwaCustomizationModal({
  data,
  onClose,
  onSaved,
}: {
  data: Data;
  onClose: () => void;
  onSaved: (updated: Data) => Promise<void>;
}) {
  const [initial] = useState(() => ({
    short_name: String(data.short_name),
    primary_color: String(data.primary_color),
    background_color: String(data.background_color),
  }));
  const [values, setValues] = useState(initial),
    [image, setImage] = useState(''),
    [fileName, setFileName] = useState(''),
    [reset, setReset] = useState(false);
  const [preparing, setPreparing] = useState(false),
    [uploadError, setUploadError] = useState(''),
    [dragging, setDragging] = useState(false),
    [nameError, setNameError] = useState('');
  const upload = useRef<HTMLInputElement>(null),
    name = useRef<HTMLInputElement>(null),
    generation = useRef(0),
    dragDepth = useRef(0),
    mounted = useRef(true);
  const { run, busy } = useAction();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, []);
  const locked = busy || preparing,
    dirty = formValuesChanged(values, initial) || Boolean(image) || reset;
  const primary = validColor(values.primary_color) ? values.primary_color : initial.primary_color;
  const background = validColor(values.background_color)
    ? values.background_color
    : initial.background_color;
  const standard = reset || String(data.icon_revision).startsWith('default-');
  const icon = image
    ? 'data:image/png;base64,' + image
    : iconPath(
        {
          ...data,
          icon_revision: standard
            ? ('default-' + primary.slice(1) + '-' + background.slice(1)).toLowerCase()
            : data.icon_revision,
        } as any,
        192,
      );
  async function choose(file: File | undefined) {
    if (!file || busy || preparing) return;
    const attempt = ++generation.current;
    setUploadError('');
    setPreparing(true);
    try {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5000000)
        throw new Error('Escolha PNG, JPEG ou WebP de até 5 MB.');
      let bitmap: ImageBitmap;
      try {
        bitmap = await createImageBitmap(file);
      } catch {
        throw new Error(
          'Não foi possível ler esta imagem. Escolha outro arquivo PNG, JPEG ou WebP.',
        );
      }
      try {
        if (bitmap.width * bitmap.height > 16777216)
          throw new Error('A imagem deve ter no máximo 16 megapixels.');
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Não foi possível preparar o logotipo neste navegador.');
        const ratio = Math.min(512 / bitmap.width, 512 / bitmap.height),
          width = bitmap.width * ratio,
          height = bitmap.height * ratio;
        ctx.drawImage(bitmap, (512 - width) / 2, (512 - height) / 2, width, height);
        const encoded = canvas.toDataURL('image/png').split(',')[1];
        if (mounted.current && generation.current === attempt) {
          setImage(encoded);
          setFileName(file.name);
          setReset(false);
        }
      } finally {
        bitmap.close();
      }
    } catch (error) {
      if (mounted.current && generation.current === attempt)
        setUploadError((error as Error).message);
    } finally {
      if (mounted.current && generation.current === attempt) setPreparing(false);
      if (upload.current) upload.current.value = '';
    }
  }
  function restore() {
    setReset(false);
    setImage('');
    setFileName('');
    setUploadError('');
  }
  const previewStyle = {
    '--pwa-preview-primary': primary,
    '--pwa-preview-background': background,
    '--pwa-preview-ink': primaryForeground(background),
    '--pwa-preview-button-ink': primaryForeground(primary),
  } as CSSProperties;
  return (
    <Modal
      title="Personalizar aplicativo PWA"
      className="business-pwa-modal"
      heading={
        <>
          <span className="pwa-editor-heading-icon">
            <Smartphone size={22} />
          </span>
          <span>
            Personalizar aplicativo PWA<small>A identidade da sua casa, também no celular.</small>
          </span>
        </>
      }
      dirty={dirty}
      closeDisabled={locked}
      onClose={onClose}
    >
      <form
        id="pwa-customization-form"
        className="pwa-customization-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (locked) return;
          if (!values.short_name.trim()) {
            setNameError('Informe o nome curto do aplicativo.');
            name.current?.focus();
            return;
          }
          if (!validColor(values.primary_color) || !validColor(values.background_color)) return;
          void run(async () => {
            const updated = await api(
              '/settings/pwa',
              {
                ...values,
                short_name: values.short_name.trim(),
                ...(image ? { icon_base64: image } : {}),
                ...(reset ? { reset_icon: true } : {}),
              },
              'PATCH',
            );
            await onSaved(updated);
          }, 'Aplicativo atualizado.');
        }}
      >
        <div className="pwa-customization-layout">
          <div className="pwa-customization-fields">
            <section className="pwa-editor-section">
              <h3>
                <Type size={17} />
                Identificação
              </h3>
              <label className="pwa-name-label">
                Nome curto<span>{values.short_name.length}/32</span>
                <input
                  ref={name}
                  aria-label="Nome curto do aplicativo"
                  required
                  maxLength={32}
                  value={values.short_name}
                  aria-invalid={Boolean(nameError) || undefined}
                  onChange={(event) => {
                    setNameError('');
                    setValues({ ...values, short_name: event.target.value });
                  }}
                  placeholder={data.name}
                  disabled={locked}
                />
              </label>
              {nameError && (
                <span className="field-error" role="alert">
                  {nameError}
                </span>
              )}
              <p className="field-hint">
                É o nome exibido abaixo do ícone na tela inicial. O nome do negócio continua sendo{' '}
                <strong>{data.name}</strong>.
              </p>
            </section>
            <section className="pwa-editor-section">
              <h3>
                <Palette size={17} />
                Cores do aplicativo
              </h3>
              <div className="pwa-editor-colors">
                <ColorField
                  label="Cor principal"
                  value={values.primary_color}
                  onChange={(primary_color) => setValues({ ...values, primary_color })}
                  presets={primaryPresets}
                  disabled={locked}
                  hint="Botões e destaques. Também atualiza a cor principal desta filial."
                />
                <ColorField
                  label="Cor de fundo"
                  value={values.background_color}
                  onChange={(background_color) => setValues({ ...values, background_color })}
                  presets={backgroundPresets}
                  disabled={locked}
                  hint="Cor de abertura e fundo de instalação do aplicativo."
                />
              </div>
            </section>
            <section className="pwa-editor-section">
              <h3>
                <ImagePlus size={17} />
                Logotipo
              </h3>
              <div
                className={
                  'pwa-logo-upload' +
                  (dragging ? ' is-dragging' : '') +
                  (preparing ? ' is-preparing' : '')
                }
                role="group"
                aria-label="Envio do logotipo"
                onDragEnter={(event) => {
                  event.preventDefault();
                  dragDepth.current++;
                  if (!locked) setDragging(true);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = locked ? 'none' : 'copy';
                }}
                onDragLeave={(event) => {
                  event.preventDefault();
                  dragDepth.current--;
                  if (dragDepth.current <= 0) setDragging(false);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  dragDepth.current = 0;
                  if (locked) return;
                  if (event.dataTransfer.files.length !== 1) {
                    setUploadError('Envie uma imagem por vez.');
                    return;
                  }
                  void choose(event.dataTransfer.files[0]);
                }}
              >
                <img
                  className="pwa-logo-thumbnail"
                  src={icon}
                  width={80}
                  height={80}
                  alt={image ? 'Prévia do logotipo selecionado' : 'Logotipo atual do aplicativo'}
                />
                <div>
                  <strong>
                    {preparing ? 'Preparando imagem…' : fileName || 'Sua marca no aplicativo'}
                  </strong>
                  <p>Arraste uma imagem aqui ou escolha um arquivo.</p>
                  <button type="button" onClick={() => upload.current?.click()} disabled={locked}>
                    {preparing ? (
                      <LoaderCircle size={16} className="pwa-upload-spinner" />
                    ) : (
                      <Upload size={16} />
                    )}
                    {image ? 'Trocar imagem' : 'Escolher imagem'}
                  </button>
                </div>
                <input
                  ref={upload}
                  className="pwa-file-input"
                  type="file"
                  aria-label="Logotipo do aplicativo"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={locked}
                  onChange={(event) => void choose(event.target.files?.[0])}
                />
              </div>
              <p className="field-hint">
                PNG, JPEG ou WebP até 5 MB. A imagem é ajustada sem distorção; o servidor prepara os
                ícones de instalação.
              </p>
              {uploadError && (
                <p className="field-error" role="alert">
                  {uploadError}
                </p>
              )}
              <div className="pwa-logo-actions">
                <button
                  type="button"
                  disabled={locked || reset || (!image && standard)}
                  onClick={() => {
                    setReset(true);
                    setImage('');
                    setFileName('');
                    setUploadError('');
                  }}
                >
                  <RotateCcw size={15} />
                  Usar ícone padrão
                </button>
                {(image || reset) && (
                  <button type="button" disabled={locked} onClick={restore}>
                    Restaurar logotipo salvo
                  </button>
                )}
              </div>
              {reset && <p className="field-hint">O ícone padrão será aplicado ao salvar.</p>}
            </section>
          </div>
          <aside
            className="pwa-live-preview"
            aria-label="Prévia ao vivo do aplicativo"
            style={previewStyle}
          >
            <div className="pwa-live-preview-heading">
              <h3>
                <Eye size={17} />
                Prévia ao vivo
              </h3>
              <span>{dirty ? 'Não salvo' : 'Atual'}</span>
            </div>
            <div className="pwa-preview-device" aria-hidden="true">
              <div className="pwa-device-speaker" />
              <div className="pwa-device-topbar">
                <img src={icon} alt="" width={28} height={28} />
                <strong>{data.name}</strong>
              </div>
              <div className="pwa-device-content">
                <UtensilsCrossed size={30} />
                <small>CARDÁPIO ONLINE</small>
                <h4>{data.name}</h4>
                <p>Seu próximo pedido começa aqui.</p>
                <span className="pwa-device-action">Ver cardápio</span>
              </div>
            </div>
            <div className="pwa-install-preview">
              <img src={icon} alt="Prévia do ícone no aplicativo" width={54} height={54} />
              <div>
                <strong>{values.short_name.trim() || 'Nome do aplicativo'}</strong>
                <span>Na tela inicial do dispositivo</span>
              </div>
            </div>
            <div className="pwa-preview-color-legend">
              <span>
                <i style={{ background: primary }} />
                Principal
              </span>
              <span>
                <i style={{ background }} />
                Fundo
              </span>
            </div>
            <p className="field-hint">
              Prévia ilustrativa. O navegador pode exibir o nome e o ícone de forma diferente após a
              instalação.
            </p>
          </aside>
        </div>
      </form>
      <div className="modal-footer pwa-editor-footer">
        <span>
          {preparing ? 'Preparando logotipo…' : 'As alterações só são aplicadas ao salvar.'}
        </span>
        <ModalCloseButton disabled={locked}>Cancelar</ModalCloseButton>
        <button className="primary" type="submit" form="pwa-customization-form" disabled={locked}>
          <Save size={16} />
          {busy ? 'Salvando…' : 'Salvar aplicativo'}
        </button>
      </div>
    </Modal>
  );
}
