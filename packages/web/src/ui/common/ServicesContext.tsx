/** React context that exposes the composed services to the UI. */

import { createContext, useContext } from 'react';
import type { Services } from '../../services/Services';

const ServicesContext = createContext<Services | null>(null);

export const ServicesProvider = ServicesContext.Provider;

export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (!services) throw new Error('useServices must be used within a ServicesProvider.');
  return services;
}
