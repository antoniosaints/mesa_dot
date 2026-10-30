import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { ChevronLeft, ChevronRight, Download, FileText, RefreshCw } from 'lucide-react';
import { api } from './client.js';
import { Modal, ModalCloseButton } from './common.js';
import { TableLoading } from './pagination.js';

/** Render the authenticated PDF itself and download the exact bytes that were previewed. */
export function PdfPreviewModal({
  title,
  source,
  filename,
  toolbar,
  onClose,
}: {
  title: string;
  source: string;
  filename: string;
  toolbar?: ReactNode;
  onClose: () => void;
}) {
  const [resource, setResource] = useState<{
    key: string;
    pdf: PDFDocumentProxy;
    blob: Blob;
  } | null>(null);
  const [error, setError] = useState(''),
    [retry, setRetry] = useState(0);
  const [page, setPage] = useState(1),
    [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(0),
    [rendered, setRendered] = useState('');
  const [text, setText] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null),
    viewport = useRef<HTMLDivElement>(null);
  const documentKey = source + ':' + retry;
  const current = resource?.key === documentKey ? resource : null;
  const pageNumber = Math.min(page, current?.pdf.numPages ?? 1);
  const displayWidth = Math.round(Math.max(120, Math.min(460, width - 32)) * zoom);
  const renderKey = `${documentKey}:${pageNumber}:${displayWidth}`;
  const ready = Boolean(current && rendered === renderKey && !error);

  useEffect(() => {
    let live = true;
    let task: PDFDocumentLoadingTask | undefined;
    const controller = new AbortController();
    setResource(null);
    setError('');
    setPage(1);
    setText('');
    void (async () => {
      const blob: Blob = await api(
        source,
        undefined,
        'GET',
        crypto.randomUUID(),
        'blob',
        controller.signal,
      );
      const pdfjs = await import('pdfjs-dist');
      const data = new Uint8Array(await blob.arrayBuffer());
      if (!live) return;
      pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      task = pdfjs.getDocument({ data });
      const pdf = await task.promise;
      if (live) setResource({ key: documentKey, pdf, blob });
    })().catch((reason: unknown) => {
      if (live)
        setError(reason instanceof Error ? reason.message : 'Não foi possível abrir o PDF.');
    });
    return () => {
      live = false;
      controller.abort();
      void task?.destroy().catch(() => {});
    };
  }, [source, retry]);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!current || !canvas.current) return;
    let live = true,
      task: RenderTask | undefined;
    setError('');
    void (async () => {
      const pdfPage = await current.pdf.getPage(pageNumber);
      if (!live || !canvas.current) return;
      const natural = pdfPage.getViewport({ scale: 1 });
      const scale = displayWidth / natural.width;
      const density = Math.min(window.devicePixelRatio || 1, 2);
      const renderedViewport = pdfPage.getViewport({ scale: scale * density });
      // Finish the new bitmap offscreen so resizing never clears the visible receipt mid-paint.
      const element = document.createElement('canvas');
      element.width = Math.ceil(renderedViewport.width);
      element.height = Math.ceil(renderedViewport.height);
      task = pdfPage.render({ canvas: element, viewport: renderedViewport });
      await task.promise;
      const content = await pdfPage.getTextContent();
      if (live && canvas.current) {
        const visible = canvas.current;
        visible.width = element.width;
        visible.height = element.height;
        visible.getContext('2d')!.drawImage(element, 0, 0);
        visible.style.width = displayWidth + 'px';
        visible.style.height = natural.height * scale + 'px';
        setText(content.items.map((item) => ('str' in item ? item.str : '')).join('\n'));
        setRendered(renderKey);
      }
    })().catch((reason: unknown) => {
      if (live)
        setError(reason instanceof Error ? reason.message : 'Não foi possível visualizar o PDF.');
    });
    return () => {
      live = false;
      task?.cancel();
    };
  }, [current, pageNumber, displayWidth, renderKey]);

  function download() {
    if (!ready || !current) return;
    const url = URL.createObjectURL(current.blob),
      link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  return (
    <Modal title={title} className="pdf-preview-modal" onClose={onClose}>
      <div className="pdf-preview-toolbar">
        {toolbar}
        <label>
          Zoom
          <select
            aria-label="Zoom do PDF"
            value={zoom}
            disabled={!current}
            onChange={(event) => setZoom(Number(event.target.value))}
          >
            <option value="1">Ajustar à tela</option>
            <option value="1.25">125%</option>
            <option value="1.5">150%</option>
          </select>
        </label>
        <div className="pdf-preview-pages" aria-label="Páginas do PDF">
          <button
            type="button"
            aria-label="Página anterior do PDF"
            disabled={!current || pageNumber <= 1}
            onClick={() => setPage(pageNumber - 1)}
          >
            <ChevronLeft size={16} />
          </button>
          <span aria-live="polite">
            {pageNumber} / {current?.pdf.numPages ?? '—'}
          </span>
          <button
            type="button"
            aria-label="Próxima página do PDF"
            disabled={!current || pageNumber >= current.pdf.numPages}
            onClick={() => setPage(pageNumber + 1)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      <p className="pdf-preview-description">
        <FileText size={15} />
        Confira o documento antes de baixar. O arquivo salvo será este mesmo PDF.
      </p>
      <div className="pdf-preview-viewport" aria-busy={!ready && !error}>
        {error ? (
          <div className="pdf-preview-overlay pdf-preview-error" role="alert">
            <p>Não foi possível preparar a prévia.</p>
            <small>{error}</small>
            <button type="button" onClick={() => setRetry((value) => value + 1)}>
              <RefreshCw size={15} />
              Tentar novamente
            </button>
          </div>
        ) : (
          !ready && (
            <div className="pdf-preview-overlay">
              <TableLoading label="Preparando prévia do PDF…" />
            </div>
          )
        )}
        <div className="pdf-preview-scroll" ref={viewport}>
          <canvas
            ref={canvas}
            className="pdf-preview-canvas"
            style={{ visibility: rendered && !error ? 'visible' : 'hidden' }}
            aria-hidden={!ready}
            role="img"
            aria-label={`Página ${pageNumber} do PDF`}
          />
          {rendered && !error && (
            <details className="pdf-preview-text">
              <summary>Ver texto desta página</summary>
              <pre>{text}</pre>
            </details>
          )}
        </div>
      </div>
      <div className="modal-footer pdf-preview-footer">
        <ModalCloseButton>Fechar prévia</ModalCloseButton>
        <button type="button" className="primary" disabled={!ready} onClick={download}>
          <Download size={16} />
          Baixar PDF
        </button>
      </div>
    </Modal>
  );
}
