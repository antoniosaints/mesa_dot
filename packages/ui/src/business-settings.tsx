import { useState, type ReactNode } from 'react';
import {
  Building2,
  MapPin,
  Phone,
  Mail,
  FileText,
  CreditCard,
  Pencil,
  Save,
  ShieldCheck,
  Globe,
  CircleCheck,
  CircleDashed,
} from 'lucide-react';
import {
  businessAddress,
  businessPhone,
  readBusinessProfile,
  businessProfileSchema,
  brazilianStates,
  type BusinessProfile,
} from '../../shared/src/business-profile.js';
import { api, brl, type Data } from './client.js';
import { Modal, ModalCloseButton, useAction } from './common.js';
import { SearchSelect } from './controls.js';
import { MoneyInput } from './money-input.js';
import { PhoneInput } from './phone-input.js';
import { PostalCodeInput } from './postal-code-input.js';
import { PwaSettings } from './pwa-settings.js';
import { AiDraftActions } from './ai-draft-action.js';
const paymentModes = [
  { id: 'MIXED', name: 'Misto' },
  { id: 'PREPAID_ONLY', name: 'Somente pré-pago' },
  { id: 'POSTPAID_ONLY', name: 'Somente pós-pago' },
];
function SettingCard({
  title,
  icon,
  action,
  children,
  className = '',
}: {
  title: string;
  icon: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={'panel business-setting-card ' + className}>
      <div className="section-head">
        <h2>
          <span className="business-section-symbol">{icon}</span>
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}
export function BusinessSettings({
  settings,
  onChange,
}: {
  settings: Data;
  onChange: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const profile = readBusinessProfile(settings.business_profile),
    address = businessAddress(profile);
  const sections = [
    Boolean(profile.description),
    Boolean(profile.phone || profile.email),
    address.length > 0,
  ];
  return (
    <div className="business-settings-workspace">
      <div className="business-settings-overview">
        <div className="business-overview-icon">
          <Building2 size={24} />
        </div>
        <div>
          <span className="eyebrow">PERFIL DO ESTABELECIMENTO</span>
          <h2>{settings.name}</h2>
          <p>Dados, apresentação e aplicativo da filial atual.</p>
        </div>
        <span className="business-settings-scope">
          <ShieldCheck size={16} /> Configuração por filial
        </span>
      </div>
      <div className="business-settings-layout">
        <div className="business-settings-details">
          <SettingCard
            title="Informações do negócio"
            icon={<Building2 size={19} />}
            action={
              <button className="primary" onClick={() => setEditing(true)}>
                <Pencil size={15} />
                Editar informações
              </button>
            }
          >
            <dl className="business-data-list">
              <div>
                <dt>Nome do estabelecimento</dt>
                <dd>{settings.name}</dd>
              </div>
              <div>
                <dt>Descrição</dt>
                <dd className={!profile.description ? 'muted' : 'business-description'}>
                  {profile.description || 'Conte aos clientes um pouco sobre a sua casa.'}
                </dd>
              </div>
            </dl>
            <div className="business-profile-progress" aria-label="Preenchimento do perfil">
              {['Descrição', 'Contato', 'Endereço'].map((label, index) => (
                <span key={label} className={sections[index] ? 'is-complete' : ''}>
                  {sections[index] ? <CircleCheck size={14} /> : <CircleDashed size={14} />}
                  {label}
                </span>
              ))}
            </div>
          </SettingCard>
          <div className="business-contact-grid">
            <SettingCard
              title="Contato"
              icon={<Phone size={19} />}
              action={
                <button
                  className="business-card-edit"
                  aria-label="Editar contato"
                  onClick={() => setEditing(true)}
                >
                  <Pencil size={15} />
                </button>
              }
            >
              <dl className="business-data-list">
                <div>
                  <dt>
                    <Phone size={14} /> Telefone
                  </dt>
                  <dd>
                    {profile.phone ? (
                      <a href={'tel:+55' + profile.phone}>{businessPhone(profile.phone)}</a>
                    ) : (
                      <span className="muted">Não informado</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>
                    <Mail size={14} /> E-mail
                  </dt>
                  <dd>
                    {profile.email ? (
                      <a href={'mailto:' + profile.email}>{profile.email}</a>
                    ) : (
                      <span className="muted">Não informado</span>
                    )}
                  </dd>
                </div>
              </dl>
            </SettingCard>
            <SettingCard
              title="Endereço"
              icon={<MapPin size={19} />}
              action={
                <button
                  className="business-card-edit"
                  aria-label="Editar endereço"
                  onClick={() => setEditing(true)}
                >
                  <Pencil size={15} />
                </button>
              }
            >
              {address.length ? (
                <address className="business-address">
                  {address.map((line) => (
                    <span key={line}>{line}</span>
                  ))}
                </address>
              ) : (
                <div className="business-setting-empty">
                  <MapPin size={24} />
                  <p>Adicione o endereço para facilitar a localização da sua casa.</p>
                </div>
              )}
            </SettingCard>
          </div>
          <SettingCard
            title="Políticas de pagamento"
            icon={<CreditCard size={19} />}
            action={
              <button onClick={() => setEditing(true)}>
                <Pencil size={15} />
                Editar políticas
              </button>
            }
          >
            <dl className="business-policy-grid">
              <div>
                <dt>Regime de pagamento</dt>
                <dd>{paymentModes.find((mode) => mode.id === settings.payment_mode)?.name}</dd>
              </div>
              <div>
                <dt>Limite de pós-pago por mesa</dt>
                <dd>{brl(settings.postpaid_limit)}</dd>
              </div>
            </dl>
            <div className="business-order-state">
              <span className={'badge ' + (settings.is_open ? 'available' : 'pending')}>
                {settings.is_open ? 'Novos pedidos habilitados' : 'Novos pedidos pausados'}
              </span>
              <span>Horários e disponibilidade em Funcionamento e cardápio.</span>
            </div>
            <p className="field-hint">
              Pagamentos online usam sandbox até a integração de um gateway real.
            </p>
          </SettingCard>
          <div className="business-public-note">
            <Globe size={17} />
            <p>
              Descrição, contato e endereço ficam disponíveis em “Sobre” no cardápio do cliente.
              Preencha somente os contatos comerciais que deseja divulgar.
            </p>
          </div>
        </div>
        <PwaSettings settings={settings} onChange={onChange} />
      </div>
      {editing && (
        <BusinessProfileEditor
          settings={settings}
          onChange={onChange}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}
function BusinessProfileEditor({
  settings,
  onChange,
  onClose,
}: {
  settings: Data;
  onChange: () => Promise<void>;
  onClose: () => void;
}) {
  const start = {
    name: settings.name as string,
    profile: readBusinessProfile(settings.business_profile),
    payment_mode: settings.payment_mode as string,
    postpaid_limit: settings.postpaid_limit as string,
    is_open: Boolean(settings.is_open),
  };
  const [initial] = useState(start),
    [draft, setDraft] = useState(start),
    [errors, setErrors] = useState<Record<string, string>>({});
  const { run, busy } = useAction();
  function update<K extends keyof BusinessProfile>(key: K, value: BusinessProfile[K]) {
    setDraft((current) => ({ ...current, profile: { ...current.profile, [key]: value } }));
    setErrors((current) => ({ ...current, [key]: '' }));
  }
  const error = (key: string) =>
    errors[key] ? (
      <span className="field-error" role="alert">
        {errors[key]}
      </span>
    ) : null;
  return (
    <Modal
      title="Informações do negócio"
      className="business-profile-modal"
      dirty={JSON.stringify(draft) !== JSON.stringify(initial)}
      closeDisabled={busy}
      onClose={onClose}
    >
      <form
        id="business-profile-form"
        className="business-profile-form"
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = businessProfileSchema.safeParse(draft.profile);
          if (!parsed.success) {
            setErrors(
              Object.fromEntries(
                parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message]),
              ),
            );
            return;
          }
          if (!draft.name.trim()) {
            setErrors({ name: 'Informe o nome do estabelecimento.' });
            return;
          }
          void run(async () => {
            await api(
              '/settings',
              {
                name: draft.name.trim(),
                business_profile: parsed.data,
                payment_mode: draft.payment_mode,
                postpaid_limit: draft.postpaid_limit,
                is_open: draft.is_open,
              },
              'PATCH',
            );
            await onChange();
            window.dispatchEvent(new Event('mesa:pwa-refresh'));
            onClose();
          }, 'Informações do negócio atualizadas.');
        }}
      >
        <div className="business-form-intro">
          <Building2 size={20} />
          <p>
            Atualize a apresentação e os contatos desta filial. Os dados públicos também aparecem no
            cardápio do cliente.
          </p>
        </div>
        <fieldset disabled={busy} className="business-form-section">
          <legend>
            <FileText size={17} />
            Identificação
          </legend>
          <label>
            Nome <span className="required-mark">*</span>
            <input
              aria-label="Nome"
              required
              maxLength={160}
              autoComplete="organization"
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
            {error('name')}
          </label>
          <label>
            Descrição do negócio
            <textarea
              aria-label="Descrição do negócio"
              rows={3}
              maxLength={1000}
              placeholder="Apresente sua casa, o cardápio e o que torna a experiência especial."
              value={draft.profile.description}
              onChange={(event) => update('description', event.target.value)}
            />
            {error('description')}
            <span className="business-character-count">
              {draft.profile.description.length}/1000
            </span>
          </label>
          <AiDraftActions
            context={{ kind: 'business', name: draft.name, description: draft.profile.description }}
            onApply={(description) => update('description', description)}
          />
          <p className="field-hint">
            O nome também é usado no aplicativo. Ao renomear, o endereço público é atualizado e os
            links antigos continuam direcionando para esta filial.
          </p>
        </fieldset>
        <fieldset disabled={busy} className="business-form-section">
          <legend>
            <Phone size={17} />
            Contato comercial
          </legend>
          <div className="business-form-grid">
            <label>
              Telefone
              <PhoneInput
                value={draft.profile.phone}
                onChange={(value) => update('phone', value)}
              />
              {error('phone')}
            </label>
            <label>
              E-mail de contato
              <input
                aria-label="E-mail de contato"
                type="email"
                autoComplete="email"
                maxLength={190}
                placeholder="contato@suaempresa.com.br"
                value={draft.profile.email}
                onChange={(event) => update('email', event.target.value.trim())}
              />
              {error('email')}
            </label>
          </div>
        </fieldset>
        <fieldset disabled={busy} className="business-form-section">
          <legend>
            <MapPin size={17} />
            Endereço do estabelecimento
          </legend>
          <div className="business-form-grid business-address-form">
            <label>
              CEP
              <PostalCodeInput
                value={draft.profile.postal_code}
                onChange={(value) => update('postal_code', value)}
              />
              {error('postal_code')}
            </label>
            <label className="business-form-wide">
              Rua ou avenida
              <input
                aria-label="Rua ou avenida"
                maxLength={160}
                autoComplete="address-line1"
                value={draft.profile.street}
                onChange={(event) => update('street', event.target.value)}
              />
              {error('street')}
            </label>
            <label>
              Número
              <input
                aria-label="Número"
                maxLength={20}
                placeholder="Ex.: 125 ou S/N"
                value={draft.profile.number}
                onChange={(event) => update('number', event.target.value)}
              />
              {error('number')}
            </label>
            <label>
              Complemento
              <input
                aria-label="Complemento"
                maxLength={100}
                autoComplete="address-line2"
                value={draft.profile.complement}
                onChange={(event) => update('complement', event.target.value)}
              />
              {error('complement')}
            </label>
            <label>
              Bairro
              <input
                aria-label="Bairro"
                maxLength={100}
                autoComplete="address-level3"
                value={draft.profile.neighborhood}
                onChange={(event) => update('neighborhood', event.target.value)}
              />
              {error('neighborhood')}
            </label>
            <label>
              Cidade
              <input
                aria-label="Cidade"
                maxLength={100}
                autoComplete="address-level2"
                value={draft.profile.city}
                onChange={(event) => update('city', event.target.value)}
              />
              {error('city')}
            </label>
            <label>
              Estado (UF)
              <SearchSelect
                label="Estado (UF)"
                options={brazilianStates.map(([id, name]) => ({
                  id,
                  name: name + ' (' + id + ')',
                }))}
                value={draft.profile.state}
                onChange={(value) => update('state', value)}
                placeholder="Selecione o estado"
                disabled={busy}
              />
              {error('state')}
            </label>
          </div>
        </fieldset>
        <fieldset disabled={busy} className="business-form-section">
          <legend>
            <CreditCard size={17} />
            Políticas de pagamento
          </legend>
          <div className="business-form-grid">
            <label>
              Regime de pagamento
              <SearchSelect
                label="Regime de pagamento"
                options={paymentModes}
                value={draft.payment_mode}
                onChange={(payment_mode) => setDraft({ ...draft, payment_mode })}
                required
                allowClear={false}
                disabled={busy}
              />
            </label>
            <label>
              Limite de pós-pago por mesa
              <MoneyInput
                label="Limite de pós-pago por mesa"
                value={draft.postpaid_limit}
                required
                onChange={(postpaid_limit) => setDraft({ ...draft, postpaid_limit })}
              />
            </label>
          </div>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={draft.is_open}
              onChange={(event) => setDraft({ ...draft, is_open: event.target.checked })}
            />
            Aberto para pedidos
          </label>
          <p className="field-hint">
            A agenda de funcionamento também é respeitada. Pausar pedidos não impede receber
            pagamentos ou concluir entregas.
          </p>
        </fieldset>
      </form>
      <div className="modal-footer">
        <ModalCloseButton disabled={busy}>Cancelar</ModalCloseButton>
        <button className="primary" type="submit" form="business-profile-form" disabled={busy}>
          <Save size={16} />
          {busy ? 'Salvando…' : 'Salvar'}
        </button>
      </div>
    </Modal>
  );
}
