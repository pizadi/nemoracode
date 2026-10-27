interface ImportMetaEnv {
  readonly NEMORACODE_CHANNEL: string
  readonly NEMORACODE_VERSION?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
