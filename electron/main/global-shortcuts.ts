import { globalShortcut } from 'electron'
import { getStore } from './store'
import { handleRecorderStart, handleRecorderPause, handleRecorderResume, handleRecorderStop } from './main-flow'

export function registerShortcuts() {
  const store = getStore()

  // F9：开始 / 暂停 / 继续
  const okF9 = globalShortcut.register('F9', () => {
    console.log('[shortcut] F9 hit, status =', store.status)
    if (store.status === 'idle') {
      void handleRecorderStart()
    } else if (store.status === 'recording') {
      handleRecorderPause()
    } else if (store.status === 'paused') {
      handleRecorderResume()
    }
  })

  // F10：停止
  const okF10 = globalShortcut.register('F10', () => {
    console.log('[shortcut] F10 hit, status =', store.status)
    if (store.status === 'recording' || store.status === 'paused') {
      void handleRecorderStop()
    }
  })

  // F8：摄像头显隐
  globalShortcut.register('F8', () => {
    store.patch({ cameraVisible: !store.cameraVisible })
  })

  console.log('[shortcut] registered F9 =', okF9, 'F10 =', okF10)
}

export function unregisterShortcuts() {
  globalShortcut.unregisterAll()
}
