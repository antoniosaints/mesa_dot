import type { ReactNode } from 'react';
import { Icon, type IconName } from './appearance.js';
import { statusLabel } from './client.js';
import { useManagementInterface } from './interface-scope.js';

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${status.toLowerCase()}`}>{statusLabel[status] ?? status}</span>;
}

export function StatCard({
  label,
  value,
  detail,
  icon,
  tone = '',
  className = '',
  iconClassName = '',
  as: Element = 'section',
}: {
  label: string;
  value: string | number;
  detail: ReactNode;
  icon: ReactNode;
  tone?: string;
  className?: string;
  iconClassName?: string;
  as?: 'section' | 'article';
}) {
  return (
    <Element className={`stat-card ${className} ${tone}`}>
      <span className={'stat-card-icon ' + iconClassName}>{icon}</span>
      <div>
        <span className="stat-card-label">{label}</span>
        <strong className="stat-card-value">{value}</strong>
        <small className="stat-card-detail">{detail}</small>
      </div>
    </Element>
  );
}

export function ChartCard({
  title,
  description,
  action,
  children,
  className = '',
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={'panel chart-card ' + className}>
      <div className="section-head">
        <div>
          <h2>{title}</h2>
          {description && <p className="muted small">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function EmptyState({
  children = 'Nenhum registro encontrado.',
  title,
  icon = 'inventory',
  action,
}: {
  children?: ReactNode;
  title?: string;
  icon?: IconName;
  action?: ReactNode;
}) {
  return (
    <div className="empty ds-empty">
      <Icon name={icon} size={30} />
      {title && <h3>{title}</h3>}
      <p>{children}</p>
      {action}
    </div>
  );
}
export function ErrorState({
  message,
  onRetry,
  title = 'Não foi possível carregar',
}: {
  message: string;
  onRetry?: () => void;
  title?: string;
}) {
  return (
    <div className="error-state alert error" role="alert">
      <Icon name="info" size={22} />
      <div>
        <strong>{title}</strong>
        <p>{message}</p>
      </div>
      {onRetry && (
        <button type="button" onClick={onRetry}>
          <Icon name="refresh" size={16} />
          Tentar novamente
        </button>
      )}
    </div>
  );
}
export function LoadingSkeleton({
  label = 'Carregando informações…',
  rows = 3,
}: {
  label?: string;
  rows?: number;
}) {
  const enhanced = useManagementInterface();
  if (!enhanced) return <div role="status">{label}</div>;
  return (
    <div className="loading-skeleton" role="status" aria-label={label}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: Math.max(1, Math.min(10, rows)) }, (_, index) => (
        <span key={index} aria-hidden="true" />
      ))}
    </div>
  );
}
