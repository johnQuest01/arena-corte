/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PARTY_HOST?: string;
  readonly VITE_PING_GRU?: string;
  readonly VITE_PING_IAD?: string;
  readonly VITE_PING_AMS?: string;
  readonly VITE_USE_ROLLBACK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
