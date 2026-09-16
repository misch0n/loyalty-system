/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEV_TRANSPORT?: 'peer' | 'bridge';
  readonly VITE_DATASTORE?: 'api' | 'indexeddb';
  readonly VITE_API_BASE?: string;
  readonly VITE_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
