/**
 * Entry point. Builds the services (composition root), then mounts the app under
 * the provider tree: services → toasts → router → auth → device pairing.
 *
 * The design foundation is imported once here (`ui/theme/index.css`); every
 * component imports its own co-located stylesheet, so there is no global
 * monolith.
 */

import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { App } from './App';
import { createServices, type Services } from './services/Services';
import { ServicesProvider } from './ui/common/ServicesContext';
import { PairingProvider } from './ui/common/PairingContext';
import { AuthProvider } from './ui/app/AuthContext';
import { ToastProvider } from './ui/components/Toast/Toast';
import { restoreSnapshot } from './ui/common/storageSnapshot';
import './ui/theme/index.css';

// Boot self-heal (prototype): a leftover pairing snapshot means the previous
// session didn't unpair cleanly (a paired tab was closed). A device is never
// legitimately paired at boot — PeerJS connections don't survive a reload — so
// restore the device's own pre-pairing storage before any provider reads it.
restoreSnapshot();

function Root() {
  const [services, setServices] = useState<Services | null>(null);

  useEffect(() => {
    createServices().then(setServices);
  }, []);

  if (!services) {
    return <div className="boot">Starting Ckyka Rewards…</div>;
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
