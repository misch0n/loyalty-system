/**
 * Entry point. Builds the services (composition root), then mounts the app with
 * the services + session providers under a HashRouter.
 */

import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { App } from './App';
import { createServices, type Services } from './services/Services';
import { ServicesProvider } from './ui/common/ServicesContext';
import { SessionProvider } from './ui/common/SessionContext';
import { PairingProvider } from './ui/common/PairingContext';
import './styles.css';

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
      <SessionProvider>
        <HashRouter>
          <PairingProvider>
            <App />
          </PairingProvider>
        </HashRouter>
      </SessionProvider>
    </ServicesProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
