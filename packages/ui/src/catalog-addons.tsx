import { useState } from 'react';
import { api, brl, type Data } from './client.js';
import { Icon } from './appearance.js';
import { Empty } from './common.js';
import { useFormDialog } from './forms.js';
export function CatalogAddons({
  groups,
  modifiers,
  onChange,
}: {
  groups: Data[];
  modifiers: Data[];
  onChange: () => Promise<void>;
}) {
  const [selected, setSelected] = useState('');
  const forms = useFormDialog();
  const current = groups.find((g) => g.id === selected) ?? groups[0];
  function groupEditor(group: Data = {}) {
    forms.open({
      title: group.id ? 'Editar grupo de adicionais' : 'Novo grupo de adicionais',
      description:
        'Grupo compartilhado: alterações se aplicam aos produtos vinculados. Pedidos já lançados preservam seus valores.',
      fields: [
        { key: 'name', label: 'Nome do grupo', required: true, maxLength: 100 },
        {
          key: 'min_choices',
          label: 'Escolhas mínimas',
          type: 'number',
          required: true,
          initial: 0,
          min: 0,
          max: 20,
        },
        {
          key: 'max_choices',
          label: 'Escolhas máximas',
          type: 'number',
          required: true,
          initial: 1,
          min: 0,
          max: 20,
        },
      ],
      initial: group,
      onSubmit: async (values) => {
        if (values.min_choices > values.max_choices)
          throw new Error('O mínimo não pode superar o máximo.');
        const result = await api(
          '/modifier-groups' + (group.id ? '/' + group.id : ''),
          values,
          group.id ? 'PATCH' : 'POST',
        );
        await onChange();
        return result;
      },
      onSuccess: (result) => setSelected(result.id),
    });
  }
  function modifierEditor(modifier: Data = {}) {
    forms.open({
      title: modifier.id ? 'Editar adicional' : 'Novo adicional',
      description:
        'O adicional pertence a ' +
        current.name +
        '. Produtos vinculados a esse grupo verão a alteração.',
      fields: [
        { key: 'name', label: 'Nome do adicional', required: true, maxLength: 100 },
        {
          key: 'price',
          label: 'Preço do adicional',
          type: 'currency',
          required: true,
          initial: '0.00',
        },
        { key: 'enabled', label: 'Ativo', type: 'checkbox', initial: true },
      ],
      initial: modifier,
      onSubmit: async (values) => {
        await api(
          '/modifiers' + (modifier.id ? '/' + modifier.id : ''),
          { ...values, group_id: current.id },
          modifier.id ? 'PATCH' : 'POST',
        );
        await onChange();
      },
    });
  }
  return (
    <section className="catalog-addons-manager">
      <div className="section-head">
        <div>
          <h2>Grupos e adicionais</h2>
          <p className="muted small">
            Organize as opções de escolha dentro de cada grupo. Vincule os grupos no modal do
            produto.
          </p>
        </div>
        <button type="button" className="primary" onClick={() => groupEditor()}>
          <Icon name="plus" size={16} />
          Novo grupo
        </button>
      </div>
      <div className="catalog-addon-columns">
        <nav aria-label="Grupos de adicionais">
          {groups.map((g) => (
            <button
              type="button"
              key={g.id}
              aria-pressed={current?.id === g.id}
              onClick={() => setSelected(g.id)}
            >
              <Icon name="folder" size={17} />
              <span>{g.name}</span>
              <b>{modifiers.filter((m) => m.group_id === g.id).length}</b>
            </button>
          ))}
        </nav>
        <section>
          {current ? (
            <>
              <div className="section-head">
                <div>
                  <h3>{current.name}</h3>
                  <small>
                    De {current.min_choices} a {current.max_choices} escolhas
                  </small>
                </div>
                <div className="button-row">
                  <button type="button" onClick={() => groupEditor(current)}>
                    <Icon name="edit" size={15} />
                    Editar grupo
                  </button>
                  <button type="button" onClick={() => modifierEditor()}>
                    <Icon name="plus" size={15} />
                    Novo adicional
                  </button>
                </div>
              </div>
              <div className="product-config-list">
                {modifiers
                  .filter((m) => m.group_id === current.id)
                  .map((m) => (
                    <article key={m.id}>
                      <div>
                        <strong>{m.name}</strong>
                        <small>{m.enabled ? 'Ativo' : 'Inativo'}</small>
                      </div>
                      <b>{brl(m.price)}</b>
                      <button
                        type="button"
                        aria-label={'Editar adicional ' + m.name}
                        onClick={() => modifierEditor(m)}
                      >
                        <Icon name="edit" size={16} />
                      </button>
                    </article>
                  ))}
              </div>
              {!modifiers.some((m) => m.group_id === current.id) && (
                <Empty>Este grupo ainda não possui adicionais.</Empty>
              )}
            </>
          ) : (
            <Empty>Crie o primeiro grupo para organizar os adicionais.</Empty>
          )}
        </section>
      </div>
      {forms.dialog}
    </section>
  );
}
