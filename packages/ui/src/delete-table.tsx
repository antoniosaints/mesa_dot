import { useState } from 'react';
import { api, type Data } from './client.js';
import { Icon } from './appearance.js';
import { Modal, ModalCloseButton, useAction } from './common.js';
export function DeleteTableButton({
  table,
  onChange,
}: {
  table: Data;
  onChange: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const { run, busy, error } = useAction();
  const occupied = Boolean(table.session_id) || table.status !== 'FREE';
  return (
    <>
      <button
        type="button"
        className="table-action delete-table-action"
        title={`Excluir mesa ${table.number}`}
        aria-label={`Excluir mesa ${table.number}`}
        onClick={() => setOpen(true)}
      >
        <Icon name="trash" size={17} />
      </button>
      {open && (
        <Modal
          title={`Excluir mesa ${table.number}?`}
          onClose={() => setOpen(false)}
          closeDisabled={busy}
        >
          <div className="stack">
            <p>
              A mesa será desativada e deixará de aparecer nos cadastros e no salão. O registro será
              mantido no banco, preservando pedidos, comandas, pagamentos e todo o histórico
              vinculado.
            </p>
            <p className="muted small">
              O QR Code antigo deixará de aceitar novos atendimentos. O número poderá ser usado em
              uma nova mesa sem alterar os registros anteriores.
            </p>
            {occupied && (
              <p className="flow-note">
                <Icon name="info" size={18} />
                Encerre o atendimento atual antes de excluir esta mesa.
              </p>
            )}
            {error && (
              <p className="alert error" role="alert">
                {error}
              </p>
            )}
            <div className="modal-footer">
              <ModalCloseButton disabled={busy} />
              <button
                className="danger"
                disabled={busy || occupied}
                onClick={() =>
                  void run(async () => {
                    await api('/tables/' + table.id, undefined, 'DELETE');
                    setOpen(false);
                    await onChange();
                  }, 'Mesa excluída. O histórico foi preservado.')
                }
              >
                <Icon name="trash" size={16} />
                {busy ? 'Excluindo…' : 'Excluir mesa'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
