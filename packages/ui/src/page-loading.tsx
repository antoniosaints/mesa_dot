import { branchTransitionVisible } from './branch-transition.js';
import { createPortal } from 'react-dom';
import { TableLoading } from './pagination.js';
/** Application transitions fill the viewport; table loaders keep their compact layout. */
export function PageLoading({
  label = 'Carregando ambiente…',
  name,
}: {
  label?: string;
  name?: string;
}) {
  if (branchTransitionVisible()) return null;
  return createPortal(
    <div className="page-loading" aria-busy="true">
      <div className="page-loading-content">
        {name && <strong className="page-loading-name">{name}</strong>}
        <TableLoading label={label} />
        <p>Preparando sua unidade. Aguarde um instante.</p>
      </div>
    </div>,
    document.body,
  );
}
