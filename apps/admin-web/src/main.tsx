import { installPwaRuntime } from '../../../packages/ui/src/pwa-context.js';
import { AppRouter } from '../../../packages/ui/src/routing.js';
import { ToastProvider } from '../../../packages/ui/src/toasts.js';
import { AppearanceSync } from '../../../packages/ui/src/appearance.js';
import { createRoot } from 'react-dom/client';
import { AdminEntry } from '../../../packages/ui/src/mesa-site.js';
import '../../../packages/ui/src/styles.css';
import '../../../packages/ui/src/mesa-site.css';
createRoot(document.getElementById('root')!).render(
  <ToastProvider>
    <AppearanceSync />
    <AppRouter>
      <AdminEntry />
    </AppRouter>
  </ToastProvider>,
);
installPwaRuntime();
