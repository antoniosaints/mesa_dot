import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Network, KeyRound, Plus, Copy, Check, ChevronDown, Info } from 'lucide-react';
import { api, type Data } from './client.js';
import { Modal, ModalCloseButton, useAction } from './common.js';
import { useToasts } from './toasts.js';
import { SearchSelect } from './controls.js';
import { PrintStationsPanel } from './print-stations.js';
/** Manual credentials belong only to the optional Node TCP/ESC-POS program. */
export function TcpAgentSettings({ printers }: { printers: Data[] }) {
  const [params] = useSearchParams();
  const legacy = params.get('aba') === 'agentes';
  const [open, setOpen] = useState(legacy);
  useEffect(() => {
    if (legacy) setOpen(true);
  }, [legacy]);
  const [creating, setCreating] = useState(false),
    [name, setName] = useState('');
  const [issued, setIssued] = useState<Data | null>(null),
    [printer, setPrinter] = useState('');
  const [revision, setRevision] = useState(0);
  const { busy, run } = useAction(),
    toast = useToasts();
  const base =
    (import.meta.env.VITE_API_URL || window.location.origin).replace(/\/$/, '') + '/api/v1';
  const enabled = printers.filter((p) => p.enabled);
  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(label + ' copiada.');
    } catch {
      toast.error('Não foi possível copiar. Selecione o conteúdo e copie manualmente.');
    }
  }
  const configuration = issued
    ? [
        'NODE_ENV=' + (base.startsWith('https://') ? 'production' : 'development'),
        'PRINT_API_URL=' + base,
        'PRINT_AGENT_TOKEN=' + issued.token,
        'PRINT_PRINTER_ID=' + printer,
        'PRINT_PRINTERS_JSON=',
        'PRINT_HOST=IP_LOCAL_DA_IMPRESSORA',
        'PRINT_PORT=9100',
      ].join('\n')
    : '';
  return (
    <>
      <details
        className="tcp-agent-settings"
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary>
          <Network size={19} />
          <span>
            Impressão TCP/IP<span>Integração avançada · opcional</span>
          </span>
          <ChevronDown size={17} />
        </summary>
        {open && (
          <div className="tcp-agent-settings-body">
            <div className="alert info">
              <Info size={18} />
              <p>
                <strong>Usa PrintBridge? Não precisa criar uma credencial aqui.</strong> O cadastro
                do computador é feito ao ativar a fila local. Use TCP/IP somente para executar o
                programa Node de impressão direta em uma impressora ESC/POS de rede.
              </p>
            </div>
            <PrintStationsPanel
              key={revision}
              transport="TCP"
              action={
                <button
                  onClick={() => {
                    setName('');
                    setCreating(true);
                  }}
                >
                  <Plus size={16} />
                  Criar agente TCP/IP
                </button>
              }
            />
            <div className="tcp-agent-guide">
              <h4>Como funciona</h4>
              <ol>
                <li>
                  Crie a credencial e guarde-a em um arquivo de ambiente protegido no computador que
                  executará o agente.
                </li>
                <li>
                  Configure a URL da API Mesa, o ID da impressora cadastrada, seu IP local e a porta
                  TCP.
                </li>
                <li>
                  Com o projeto compilado e Node 24, execute{' '}
                  <code>node --env-file=.env dist/apps/print-agent/src/index.js</code> e mantenha o
                  processo em execução.
                </li>
              </ol>
              <p>
                A URL Mesa deve ser HTTPS em produção. O computador precisa alcançar a API e a
                impressora de rede. A fila é a mesma usada pelos demais dispositivos.
              </p>
              <p>
                “Online” confirma comunicação com o Mesa; “Concluído” confirma o envio de bytes e
                não garante saída física de papel. O programa processa apenas as impressoras
                configuradas nele.
              </p>
              <a
                href="https://github.com/antoniosaints/mesa_dot/blob/main/docs/printbridge.md"
                target="_blank"
                rel="noreferrer"
              >
                Ver documentação de impressão
              </a>
            </div>
          </div>
        )}
      </details>
      {creating && (
        <Modal
          title="Criar agente TCP/IP"
          closeDisabled={busy}
          dirty={Boolean(name)}
          onClose={() => setCreating(false)}
        >
          <form
            id="tcp-agent-create"
            className="form-grid"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                const result = await api('/print/agents', { name: name.trim(), transport: 'TCP' });
                setCreating(false);
                setRevision((value) => value + 1);
                if (result.token) {
                  setIssued(result);
                  setPrinter(enabled.length === 1 ? enabled[0].id : '');
                } else
                  toast.info(
                    'A credencial já foi emitida e não pode ser exibida novamente. Desative esse agente se a perdeu e crie outro.',
                  );
              }, 'Agente TCP/IP criado.');
            }}
          >
            <p className="modal-description">
              Esta credencial é exclusiva do programa TCP/IP. Para o PrintBridge, conecte e ative a
              fila local.
            </p>
            <label>
              Nome do agente TCP/IP
              <input
                aria-label="Nome do agente TCP/IP"
                required
                maxLength={100}
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={busy}
                placeholder="Ex.: Servidor de impressão da cozinha"
              />
            </label>
          </form>
          <div className="modal-footer">
            <ModalCloseButton disabled={busy}>Cancelar</ModalCloseButton>
            <button
              className="primary"
              form="tcp-agent-create"
              type="submit"
              disabled={busy || !name.trim()}
            >
              <KeyRound size={16} />
              {busy ? 'Criando…' : 'Criar credencial TCP/IP'}
            </button>
          </div>
        </Modal>
      )}
      {issued && (
        <Modal title="Credencial do agente TCP/IP" onClose={() => setIssued(null)}>
          <div className="tcp-agent-credential">
            <div className="alert info">
              <KeyRound size={18} />
              <p>
                <strong>Guarde esta credencial agora.</strong> Ela é exibida uma única vez e permite
                acessar a fila de impressão desta filial. Salve-a no arquivo de ambiente protegido
                do computador agente.
              </p>
            </div>
            <label>
              Credencial do agente
              <input
                aria-label="Credencial do agente"
                value={issued.token}
                readOnly
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <button onClick={() => void copy(issued.token, 'Credencial')}>
              <Copy size={16} />
              Copiar credencial
            </button>
            <label>
              Impressora para a configuração
              <SearchSelect
                label="Impressora para a configuração"
                options={enabled.map((p) => ({ id: p.id, name: p.name + ' · ' + p.sector }))}
                value={printer}
                onChange={setPrinter}
                placeholder="Selecione uma impressora cadastrada"
              />
            </label>
            {!enabled.length && (
              <p className="field-hint">
                Cadastre a impressora na aba Impressoras. A credencial pode ser guardada agora.
              </p>
            )}
            <label>
              Configuração do agente
              <textarea
                aria-label="Configuração do agente"
                readOnly
                rows={7}
                value={configuration}
              />
            </label>
            <button disabled={!printer} onClick={() => void copy(configuration, 'Configuração')}>
              <Copy size={16} />
              Copiar configuração
            </button>
            <p className="field-hint">
              Substitua IP_LOCAL_DA_IMPRESSORA pelo IP do equipamento. O ID corresponde à impressora
              do Mesa; o endereço IP é configurado no computador agente.
            </p>
          </div>
          <div className="modal-footer">
            <ModalCloseButton>
              <Check size={16} />
              Fechar credencial
            </ModalCloseButton>
          </div>
        </Modal>
      )}
    </>
  );
}
