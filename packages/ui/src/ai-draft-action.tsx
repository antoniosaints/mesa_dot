import { useRef, useState } from 'react';
import { Sparkles, ImagePlus, Download, WandSparkles } from 'lucide-react';
import { useAiAssistant } from './ai-assistant.js';
import { Modal, ModalCloseButton, useAction } from './common.js';
import { TableLoading } from './pagination.js';
import type { Data } from './client.js';
export function AiDraftActions({
  context,
  onApply,
  images = false,
}: {
  context: Data;
  onApply: (text: string) => void;
  images?: boolean;
}) {
  const assistant = useAiAssistant();
  const [mode, setMode] = useState<'description' | 'image' | null>(null);
  if (!assistant.allowed) return null;
  return (
    <>
      <div className="ai-draft-actions">
        <button
          type="button"
          className="ai-quick-button"
          disabled={!context.name?.trim()}
          onClick={() => setMode('description')}
        >
          <Sparkles size={15} />
          Gerar descrição com IA
        </button>
        {images && assistant.connection?.supports_images && (
          <button
            type="button"
            className="ai-quick-button"
            disabled={!context.name?.trim()}
            onClick={() => setMode('image')}
          >
            <ImagePlus size={15} />
            Criar imagem com IA
          </button>
        )}
      </div>
      {mode && (
        <DraftGenerator
          key={mode}
          mode={mode}
          context={context}
          onApply={onApply}
          onClose={() => setMode(null)}
        />
      )}
    </>
  );
}
function DraftGenerator({
  mode,
  context,
  onApply,
  onClose,
}: {
  mode: 'description' | 'image';
  context: Data;
  onApply: (text: string) => void;
  onClose: () => void;
}) {
  const assistant = useAiAssistant(),
    image = mode === 'image',
    limit = context.kind === 'business' ? 1000 : 2000;
  const [instructions, setInstructions] = useState(
    image
      ? 'Crie uma imagem ilustrativa de apresentação para este produto, com fundo limpo e composição profissional.'
      : 'Crie uma descrição breve, clara e convidativa usando somente as informações fornecidas.',
  );
  const [ratio, setRatio] = useState('1:1'),
    [result, setResult] = useState<Data | null>(null),
    [text, setText] = useState('');
  const { run, busy } = useAction();
  const attempt = useRef({ signature: '', key: String(crypto.randomUUID()) });
  const ready = assistant.connection?.enabled && assistant.connection.configured;
  return (
    <Modal
      title={image ? 'Criar imagem com IA' : 'Gerar descrição com IA'}
      className="ai-draft-modal"
      dirty={Boolean(result)}
      closeDisabled={busy}
      onClose={onClose}
    >
      <div className="ai-draft-context">
        <span>
          <WandSparkles size={23} />
        </span>
        <div>
          <strong>{context.name}</strong>
          <p>
            {image
              ? 'Gere uma ilustração e baixe após conferir a prévia.'
              : 'Confira o rascunho antes de usar no formulário. O cadastro só será alterado quando você salvar.'}
          </p>
        </div>
      </div>
      {!ready ? (
        <div className="flow-note">
          Configure e ative o Gemini em Complementos para utilizar esta ação.
        </div>
      ) : (
        <>
          <form
            id="ai-draft-request"
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void run(async () => {
                const signature = JSON.stringify([mode, context, instructions, ratio]);
                if (attempt.current.signature !== signature)
                  attempt.current = { signature, key: crypto.randomUUID() };
                const generated = await assistant.generate(
                  {
                    mode,
                    context,
                    question: instructions,
                    aspect_ratio: ratio,
                  },
                  attempt.current.key,
                );
                setResult(generated);
                setText(generated.answer);
                attempt.current = { signature: '', key: crypto.randomUUID() };
              });
            }}
          >
            <label>
              Orientações
              <textarea
                aria-label="Orientações para a IA"
                rows={3}
                maxLength={1500}
                required
                disabled={busy}
                value={instructions}
                onChange={(event) => setInstructions(event.target.value)}
              />
            </label>
            {image && (
              <label>
                Formato
                <select
                  aria-label="Formato da imagem"
                  value={ratio}
                  disabled={busy}
                  onChange={(event) => setRatio(event.target.value)}
                >
                  <option value="1:1">Quadrado · 1:1</option>
                  <option value="4:3">Paisagem · 4:3</option>
                  <option value="16:9">Banner · 16:9</option>
                </select>
              </label>
            )}
            <button type="submit" className="primary" disabled={busy}>
              <Sparkles size={16} />
              {busy
                ? 'Gerando…'
                : result
                  ? 'Gerar outra opção'
                  : image
                    ? 'Gerar imagem'
                    : 'Gerar rascunho'}
            </button>
          </form>
          {busy && (
            <TableLoading
              compact
              label={
                image
                  ? 'Criando sua imagem. Pode levar até 90 segundos…'
                  : 'Preparando sua descrição…'
              }
            />
          )}
          {result && (
            <section className="ai-draft-result" aria-label="Prévia gerada">
              <header>
                <strong>{image ? 'Prévia da imagem' : 'Revise a descrição'}</strong>
                <span>{result.model}</span>
              </header>
              {image ? (
                <>
                  <img src={result.image?.data_url} alt="Imagem ilustrativa gerada por IA" />
                  <p>
                    Ilustração gerada por IA. Confira se representa o produto antes de utilizar.
                  </p>
                </>
              ) : (
                <label>
                  Descrição sugerida
                  <textarea
                    aria-label="Descrição sugerida"
                    value={text}
                    rows={5}
                    maxLength={limit}
                    disabled={busy}
                    onChange={(event) => setText(event.target.value)}
                  />
                  <small>
                    {text.length}/{limit} caracteres
                  </small>
                </label>
              )}
            </section>
          )}
          <p className="field-hint">
            O consumo utiliza a cota do seu projeto Google. A IA pode cometer erros; revise as
            informações.
          </p>
        </>
      )}
      <div className="modal-footer">
        <ModalCloseButton disabled={busy}>Fechar</ModalCloseButton>
        {result &&
          (image ? (
            <a
              className="ai-download-button"
              href={result.image.data_url}
              download={
                'mesa-imagem-ia.' +
                (result.image.mime_type === 'image/jpeg'
                  ? 'jpg'
                  : result.image.mime_type === 'image/webp'
                    ? 'webp'
                    : 'png')
              }
            >
              <Download size={16} />
              Baixar imagem
            </a>
          ) : (
            <button
              className="primary"
              disabled={busy || !text.trim()}
              onClick={() => {
                onApply(text.trim());
                onClose();
              }}
            >
              <Sparkles size={16} />
              Usar descrição
            </button>
          ))}
      </div>
    </Modal>
  );
}
