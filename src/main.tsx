/**
 * Entry point. Builds the services (composition root), then mounts the app under
 * the provider tree: services → toasts → router → auth → device pairing.
 *
 * CSS order matters: legacy `styles.css` loads FIRST (it carries the classes for
 * the reused common components — QrDisplay/QrScanner/PrivacyNotice/PairDevices),
 * then `ui/theme.css` loads AFTER so the rebuilt design tokens and body styles win.
 */

import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { App } from './App';
import { createServices, type Services } from './services/Services';
import { ServicesProvider } from './ui/common/ServicesContext';
import { PairingProvider } from './ui/common/PairingContext';
import { AuthProvider } from './ui/app/AuthContext';
import { ToastProvider } from './ui/kit';
import './styles.css';
import './ui/theme.css';

function Root() {
  const [services, setServices] = useState<Services | null>(null);

  useEffect(() => {
    createServices().then(setServices);
  }, []);

  if (!services) {
    return <div className="boot">Starting Café Loyalty…</div>;
  }

  return (
    <ServicesProvider value={services}>
      <ToastProvider>
        <HashRouter>
          <AuthProvider>
            <PairingProvider>
              <App />
            </PairingProvider>
          </AuthProvider>
        </HashRouter>
      </ToastProvider>
    </ServicesProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
