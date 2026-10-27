import type { ElectronNative } from "../preload/types"

declare global {
  interface ImportMetaEnv {
    readonly NEMORACODE_TEST_ONBOARDING: boolean
  }

  interface Window {
    electron: ElectronNative
    __NEMORACODE__?: {
      deepLinks?: string[]
    }
  }
}
