import type { DeskVideoApi } from '../../electron/preload/index'

declare global {
  interface Window {
    api: DeskVideoApi
  }
}

export {}
