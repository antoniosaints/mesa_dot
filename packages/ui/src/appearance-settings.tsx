import { useState } from 'react';
import { Icon, useAppearance } from './appearance.js';
import {
  appearanceStore,
  appearancePresets,
  defaultPrimary,
  defaultSidebar,
  primaryForeground,
  sidebarPalette,
  validColor,
} from './preferences.js';
import { Modal, ModalCloseButton, useAction } from './common.js';
import { api } from './client.js';
const palette = [
  ['Azul', '#2584f8'],
  ['Índigo', '#6366f1'],
  ['Violeta', '#8b5cf6'],
  ['Rosa', '#db2777'],
  ['Vermelho', '#dc2626'],
  ['Laranja', '#ea580c'],
  ['Verde', '#059669'],
  ['Turquesa', '#0891b2'],
];
const sidebarColors = [
  ['Marinho', defaultSidebar],
  ['Grafite', '#0f172a'],
  ['Violeta', '#21163b'],
  ['Verde', '#102b25'],
  ['Branco', '#ffffff'],
  ['Cinza claro', '#f1f5f9'],
];
function AppearancePreview({ primary, sidebar }: { primary: string; sidebar: string }) {
  const colors = sidebarPalette(sidebar);
  return (
    <div className="appearance-preview-frame" aria-label="Prévia das cores do sistema">
      <aside style={{ background: sidebar, color: colors.ink }}>
        <strong style={{ background: primary, color: primaryForeground(primary) }}>M</strong>
        <span style={{ background: primary, color: primaryForeground(primary) }}>
          <Icon name="dashboard" size={14} />
          Painel
        </span>
        <span style={{ color: colors.muted }}>
          <Icon name="orders" size={14} />
          Pedidos
        </span>
        <span style={{ color: colors.muted }}>
          <Icon name="menu" size={14} />
          Cardápio
        </span>
      </aside>
      <div>
        <span className="eyebrow">PRÉVIA DO SISTEMA</span>
        <h3>Sua operação, do seu jeito</h3>
        <p>Cor primária nas ações e fundo independente no menu lateral.</p>
        <span
          className="preview-primary"
          style={{ background: primary, color: primaryForeground(primary) }}
        >
          Confirmar <Icon name="check" size={16} />
        </span>
      </div>
    </div>
  );
}
export function AppearanceSettings({
  primary,
  sidebar,
  onChange,
}: {
  primary?: string;
  sidebar?: string;
  onChange: () => void | Promise<void>;
}) {
  const appearance = useAppearance(),
    savedPrimary = primary ?? appearance.primary,
    savedSidebar = sidebar ?? appearance.sidebar;
  const [editing, setEditing] = useState<'primary' | 'sidebar' | null>(null),
    [color, setColor] = useState(savedPrimary),
    [initialColor, setInitialColor] = useState(color);
  const { run, busy } = useAction();
  async function save(colors: { primary_color?: string; sidebar_color?: string }, message: string) {
    return run(async () => {
      const result = await api('/settings', colors, 'PATCH');
      appearanceStore.setColors(result);
      window.dispatchEvent(new Event('mesa:appearance-updated'));
      await onChange();
      return result;
    }, message);
  }
  function edit(mode: 'primary' | 'sidebar') {
    const selected = mode === 'primary' ? savedPrimary : savedSidebar;
    setColor(selected);
    setInitialColor(selected);
    setEditing(mode);
  }
  const draft = validColor(color) ? color : editing === 'sidebar' ? savedSidebar : savedPrimary;
  return (
    <section className="panel appearance-panel">
      <div className="section-head">
        <div>
          <h2>Aparência</h2>
          <p className="muted small">
            Aplique uma combinação pronta ou personalize as cores da unidade.
          </p>
        </div>
      </div>
      <section className="interface-settings" aria-labelledby="interface-style-title">
        <h3 id="interface-style-title">Estilo da interface</h3>
        <p className="muted small">
          Escolha o visual da gestão neste navegador. Os dois estilos funcionam nos modos claro e
          escuro e mantêm as cores da filial.
        </p>
        <div className="interface-options" role="group" aria-label="Estilo da interface">
          {(
            [
              [
                'classic',
                'Visual atual',
                'A interface que você já conhece, com sua organização atual.',
              ],
              [
                'erp',
                'Mesa ERP',
                'Gestão padronizada com tabelas compactas, indicadores claros e formulários consistentes.',
              ],
            ] as const
          ).map(([id, name, description]) => (
            <button
              key={id}
              type="button"
              className={'interface-option ' + (appearance.interfaceStyle === id ? 'selected' : '')}
              aria-label={'Usar ' + name}
              aria-pressed={appearance.interfaceStyle === id}
              onClick={() => appearanceStore.setInterfaceStyle(id)}
            >
              <span className={'interface-option-sample sample-' + id} aria-hidden="true">
                <i />
                <span>
                  <i />
                  <i />
                  <i />
                </span>
              </span>
              <span className="interface-option-copy">
                <strong>{name}</strong>
                <small>{description}</small>
                <span>{appearance.interfaceStyle === id ? 'Em uso' : 'Usar este visual'}</span>
              </span>
              {appearance.interfaceStyle === id && <Icon name="check" size={18} />}
            </button>
          ))}
        </div>
      </section>
      <section className="appearance-presets-section" aria-label="Presets de cores">
        <h3>Presets de cores</h3>
        <p className="muted small">
          Um clique salva a cor primária e o fundo do menu lateral. O tema claro ou escuro continua
          sendo sua preferência neste navegador.
        </p>
        <div className="appearance-presets">
          {appearancePresets.map((preset) => {
            const selected =
              savedPrimary.toLowerCase() === preset.primary &&
              savedSidebar.toLowerCase() === preset.sidebar;
            return (
              <button
                type="button"
                key={preset.name}
                className="appearance-preset"
                aria-label={'Aplicar preset ' + preset.name}
                aria-pressed={selected}
                disabled={busy}
                onClick={() =>
                  void save(
                    { primary_color: preset.primary, sidebar_color: preset.sidebar },
                    'Preset ' + preset.name + ' aplicado.',
                  )
                }
              >
                <span className="appearance-preset-sample" aria-hidden="true">
                  <i style={{ background: preset.sidebar }} />
                  <span>
                    <i style={{ background: preset.primary }} />
                    <i />
                    <i />
                  </span>
                </span>
                <span>
                  {preset.name}
                  {selected && <Icon name="check" size={16} />}
                </span>
              </button>
            );
          })}
        </div>
      </section>
      <div className="appearance-layout">
        <div>
          <h3>Tema do navegador</h3>
          <p className="muted small">Esta preferência fica salva apenas neste navegador.</p>
          <div className="theme-options">
            {(['dark', 'light'] as const).map((theme) => (
              <button
                key={theme}
                className={appearance.theme === theme ? 'selected' : ''}
                aria-pressed={appearance.theme === theme}
                onClick={() => appearanceStore.setTheme(theme)}
              >
                <Icon name={theme === 'dark' ? 'moon' : 'sun'} />
                <span>{theme === 'dark' ? 'Escuro' : 'Claro'}</span>
                {appearance.theme === theme && <Icon name="check" size={16} />}
              </button>
            ))}
          </div>
          <h3>Cor primária do estabelecimento</h3>
          <p className="muted small">
            Aplicada às ações na administração, cliente, garçom e cozinha.
          </p>
          <div className="primary-color-summary">
            <span style={{ background: savedPrimary }} />
            <code>{savedPrimary}</code>
            <button disabled={busy} onClick={() => edit('primary')}>
              <Icon name="edit" size={16} />
              Personalizar cor
            </button>
          </div>
          <h3>Fundo do menu lateral</h3>
          <p className="muted small">
            Cor independente do conteúdo, com textos e ícones ajustados para manter o contraste.
          </p>
          <div className="primary-color-summary">
            <span style={{ background: savedSidebar }} />
            <code>{savedSidebar}</code>
            <button disabled={busy} onClick={() => edit('sidebar')}>
              <Icon name="edit" size={16} />
              Personalizar fundo
            </button>
          </div>
          <p className="appearance-menu-hint muted small">
            <Icon name="sidebar-close" size={17} />
            Use o botão no cabeçalho para recolher ou expandir o menu no computador. No celular, use
            “Abrir menu” e “Fechar menu”.
          </p>
        </div>
        <AppearancePreview primary={savedPrimary} sidebar={savedSidebar} />
      </div>
      {editing && (
        <Modal
          title={
            editing === 'primary'
              ? 'Personalizar cor primária'
              : 'Personalizar fundo do menu lateral'
          }
          dirty={color.toLowerCase() !== initialColor.toLowerCase()}
          closeDisabled={busy}
          onClose={() => setEditing(null)}
        >
          <p className="modal-description">
            A cor será salva para esta unidade. Confira a prévia antes de salvar.
          </p>
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              if (!validColor(color)) return;
              void (async () => {
                const result = await save(
                  editing === 'primary'
                    ? { primary_color: color.toLowerCase() }
                    : { sidebar_color: color.toLowerCase() },
                  editing === 'primary'
                    ? 'Cor primária atualizada em todos os aplicativos.'
                    : 'Fundo do menu lateral atualizado.',
                );
                if (result) setEditing(null);
              })();
            }}
          >
            <div className="color-swatches">
              {(editing === 'primary' ? palette : sidebarColors).map(([name, hex]) => (
                <button
                  type="button"
                  key={hex}
                  aria-label={(editing === 'primary' ? 'Usar cor ' : 'Usar fundo ') + name}
                  aria-pressed={color.toLowerCase() === hex}
                  title={name}
                  style={{ background: hex, color: primaryForeground(hex) }}
                  onClick={() => setColor(hex)}
                >
                  {color.toLowerCase() === hex && <Icon name="check" />}
                </button>
              ))}
            </div>
            <div className="color-custom">
              <label>
                Seletor de cor
                <input
                  type="color"
                  aria-label="Selecionar cor personalizada"
                  value={
                    validColor(color)
                      ? color
                      : editing === 'primary'
                        ? defaultPrimary
                        : defaultSidebar
                  }
                  onChange={(event) => setColor(event.target.value)}
                />
              </label>
              <label>
                Código hexadecimal
                <input
                  value={color}
                  onChange={(event) => setColor(event.target.value)}
                  placeholder={editing === 'primary' ? defaultPrimary : defaultSidebar}
                  pattern="#[a-fA-F0-9]{6}"
                  required
                  maxLength={7}
                  spellCheck={false}
                />
              </label>
            </div>
            <AppearancePreview
              primary={editing === 'primary' ? draft : savedPrimary}
              sidebar={editing === 'sidebar' ? draft : savedSidebar}
            />
            <div className="modal-footer">
              <ModalCloseButton disabled={busy} />
              <button className="primary" disabled={busy || !validColor(color)}>
                {busy ? 'Salvando…' : 'Salvar aparência'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
