/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Where "Get Started" sends people. Set per environment; defaults to the local twin. */
  readonly VITE_TWIN_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
