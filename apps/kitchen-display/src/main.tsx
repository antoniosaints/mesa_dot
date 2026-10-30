import { installPwaRuntime } from '../../../packages/ui/src/pwa-context.js';
import { AppRouter } from '../../../packages/ui/src/routing.js';
import { ToastProvider } from '../../../packages/ui/src/toasts.js';
import { AppearanceSync } from '../../../packages/ui/src/appearance.js';
import { createRoot } from 'react-dom/client';
import { KitchenApp } from '../../../packages/ui/src/kitchen-app.js';
import '../../../packages/ui/src/styles.css';
createRoot(document.getElementById('root')!).render(
  <ToastProvider>
    <AppearanceSync />
    <AppRouter>
      <KitchenApp />
    </AppRouter>
  </ToastProvider>,
);
installPwaRuntime();
