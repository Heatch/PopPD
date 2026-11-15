/// <reference types="vite/client" />

import type { PopdApi } from "../../shared/types"

declare global {
  interface Window {
    popd: PopdApi
  }
}
