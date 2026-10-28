import { app, protocol } from 'electron'
import path from 'node:path'
import { initStore } from './store'
import { registerIpc } from './ipc'
import { createControlPanel, showControlPanel } from './windows/control-panel'
import { createCompositor } from './windows/compositor'
import { createOverlay } from './windows/overlay'
import { initTray } from './tray'
import { registerShortcuts, unregisterShortcuts } from './global-shortcuts'
import { startCursorWatcher } from './cursor-watcher'
import { broadcastToAll } from './ipc-helpers'
import { registerRecordedProtocol } from './recorded-protocol'

// 允许无手势自动播放：预览页点击起点/终点后 <video> 立即出声出画
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

// 必须在 app ready 前注册特权协议（http 源页面无法加载 file:// 媒体，预览靠 rec:// 承载）
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'rec',
    privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true }
  }
])

// 单实例锁
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

app.on('second-instance', () => {
  showControlPanel()
})

app.whenReady().then(() => {
  registerRecordedProtocol()
  initStore()
  registerIpc()

  createControlPanel()
  createCompositor()
  createOverlay()

  initTray()
  registerShortcuts()
  startCursorWatcher()
})

// 所有窗口关闭也不退出（托盘常驻；overlay 有自动重建）
app.on('window-all-closed', () => {
  /* 保持运行 */
})

app.on('before-quit', () => {
  ;(app as unknown as { isQuitting: boolean }).isQuitting = true
  unregisterShortcuts()
  broadcastToAll('app:quitting')
})

process.on('uncaughtException', (err) => {
  console.error('[main] uncaught:', err)
})

