import { PushDeviceButton } from './push-device.js';
import { companySelectionRequested } from './common.js';
import { usePageRoute, RouteNotFound } from './routing.js';
import { AppHeader } from './appearance.js';
import { useStorageKey } from './client.js';
import { Connectivity, Login, useStaff } from './common.js';
import { ProductionWorkspace } from './production-workspace.js';
export function KitchenApp() {
  useStorageKey('bar-staff');
  const { current, setCurrent, signOut } = useStaff();
  const { page, setPage } = usePageRoute(
    { production: '/producao' },
    'production',
    Boolean(current),
  );
  if (!current || companySelectionRequested())
    return <Login onLogin={setCurrent} app="Fila de produção" surface="kitchen" />;
  const scope =
    current.actor.tenantId + ':' + current.actor.establishmentId + ':' + current.actor.id;
  return (
    <div className="kitchen-app">
      <AppHeader onLogout={() => void signOut()}>
        <PushDeviceButton surface="kitchen" />
      </AppHeader>
      <main className="waiter-content">
        <Connectivity />
        {page === 'notfound' ? (
          <RouteNotFound onHome={() => setPage('production')} />
        ) : (
          <ProductionWorkspace key={scope} />
        )}
      </main>
    </div>
  );
}
