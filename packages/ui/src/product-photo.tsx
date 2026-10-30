import { useEffect, useRef, useState } from 'react';
import { ImagePlus, LoaderCircle, Trash2, ZoomIn } from 'lucide-react';
import { type Data } from './client.js';
import { Icon } from './appearance.js';
import { Modal } from './common.js';

export function productPhotoUrl(product: Data, full = false) {
  if (!product.id || !product.establishment_id || !product.photo_revision) return '';
  return (
    (import.meta.env.VITE_API_URL ?? '') +
    '/api/v1/product-photos/' +
    [
      product.establishment_id,
      product.id,
      product.photo_revision,
      full ? 'photo.png' : 'thumbnail.png',
    ]
      .map(encodeURIComponent)
      .join('/')
  );
}
export function ProductPhotoImage({
  product,
  full = false,
  src,
  decorative = false,
}: {
  product: Data;
  full?: boolean;
  src?: string;
  decorative?: boolean;
}) {
  const source = src ?? productPhotoUrl(product, full);
  const [failed, setFailed] = useState('');
  return source && source !== failed ? (
    <img
      className="product-photo-image"
      src={source}
      alt={decorative ? '' : 'Foto de ' + product.name}
      loading={full ? 'eager' : 'lazy'}
      decoding="async"
      onError={() => setFailed(source)}
    />
  ) : (
    <Icon name={product.requires_production ? 'production' : 'menu'} size={32} />
  );
}
export function ProductPhotoPreview({
  product,
  src,
  onClose,
}: {
  product: Data;
  src?: string;
  onClose: () => void;
}) {
  return (
    <Modal title={'Foto · ' + product.name} onClose={onClose} className="product-photo-modal">
      <div className="product-photo-viewer">
        <ProductPhotoImage product={product} full src={src} />
      </div>
      {product.description && <p className="muted product-photo-caption">{product.description}</p>}
      <div className="modal-footer product-photo-footer">
        <button type="button" onClick={onClose}>
          Fechar foto
        </button>
      </div>
    </Modal>
  );
}
async function preparePhoto(file: File) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5000000)
    throw new Error('Escolha uma foto PNG, JPEG ou WebP de até 5 MB.');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('Não foi possível ler esta foto. Escolha outra imagem.');
  }
  try {
    if (bitmap.width * bitmap.height > 16777216)
      throw new Error('A foto deve ter no máximo 16 megapixels.');
    for (const maximum of [1024, 768, 512]) {
      const ratio = Math.min(1, maximum / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
      canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Seu navegador não conseguiu preparar a foto.');
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const encoded = canvas.toDataURL('image/png').split(',')[1];
      if (encoded.length <= 2000000) return encoded;
    }
    throw new Error('Esta foto é muito grande. Escolha uma imagem menor.');
  } finally {
    bitmap.close();
  }
}
export function ProductPhotoEditor({
  product,
  value,
  onChange,
  onPreparingChange,
}: {
  product: Data;
  value: string | null | undefined;
  onChange: (photo: string | null | undefined) => void;
  onPreparingChange: (preparing: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null),
    attempt = useRef(0);
  const [preparing, setPreparing] = useState(false),
    [error, setError] = useState(''),
    [preview, setPreview] = useState(false);
  useEffect(
    () => () => {
      attempt.current++;
    },
    [],
  );
  const source = value
    ? 'data:image/png;base64,' + value
    : value === null
      ? ''
      : productPhotoUrl(product, true);
  async function choose(file: File | undefined) {
    if (!file || preparing) return;
    const generation = ++attempt.current;
    setError('');
    setPreparing(true);
    onPreparingChange(true);
    try {
      const encoded = await preparePhoto(file);
      if (attempt.current === generation) onChange(encoded);
    } catch (problem) {
      if (attempt.current === generation) setError((problem as Error).message);
    } finally {
      if (attempt.current === generation) {
        setPreparing(false);
        onPreparingChange(false);
        if (input.current) input.current.value = '';
      }
    }
  }
  return (
    <section className="product-photo-editor" aria-label="Foto do produto">
      <div className="product-photo-editor-heading">
        <strong>Foto do produto</strong>
        <span>Opcional</span>
      </div>
      <button
        type="button"
        className="product-photo-editor-preview"
        disabled={!source || preparing}
        aria-label="Ampliar foto do produto"
        onClick={() => setPreview(true)}
      >
        <ProductPhotoImage product={product} full src={source} />
        {source && (
          <span>
            <ZoomIn size={15} /> Ampliar
          </span>
        )}
      </button>
      <div className="button-row">
        <button type="button" onClick={() => input.current?.click()} disabled={preparing}>
          {preparing ? (
            <LoaderCircle size={16} className="product-photo-spinner" />
          ) : (
            <ImagePlus size={16} />
          )}
          {preparing ? 'Preparando…' : source ? 'Trocar foto' : 'Adicionar foto'}
        </button>
        {source && (
          <button
            type="button"
            aria-label="Remover foto do produto"
            onClick={() => {
              setError('');
              onChange(null);
            }}
            disabled={preparing}
          >
            <Trash2 size={16} /> Remover
          </button>
        )}
        {value !== undefined && (
          <button
            type="button"
            onClick={() => {
              setError('');
              onChange(undefined);
            }}
            disabled={preparing}
          >
            Desfazer
          </button>
        )}
      </div>
      <input
        ref={input}
        className="product-photo-file-input"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        aria-label="Selecionar foto do produto"
        onChange={(event) => void choose(event.target.files?.[0])}
        disabled={preparing}
      />
      <p className="field-hint">
        PNG, JPEG ou WebP até 5 MB. A foto é otimizada sem distorção e publicada ao salvar o
        produto.
      </p>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {preview && source && (
        <ProductPhotoPreview product={product} src={source} onClose={() => setPreview(false)} />
      )}
    </section>
  );
}
