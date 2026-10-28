import { BrowserWindow } from 'electron'
import path from 'node:path'
import { applyContentProtection, loadRenderer } from './win-utils'

/**
 * 合成窗口：不可见，但必须保持渲染管线活跃。
 * backgroundThrottling=false 保证隐藏时 rAF/计时器不节流，
 * 视频帧通过 canvas.captureStream(0) + requestFrame() 手动推送，不依赖窗口可见性。
 */
export function createCompositor(): BrowserWindow {
  const win = new BrowserWindow({
    width: 960,
    height: 540,
    show: false,
    title: 'compositor',
    paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })
  // 双保险：禁止任何节流
  win.webContents.setBackgroundThrottling(false)
  applyContentProtection(win)
  loadRenderer(win, 'compositor/compositor.html')
  compositorWin = win
  return win
}

let compositorWin: BrowserWindow | null = null

export function getCompositor(): BrowserWindow | null {
  return compositorWin && !compositorWin.isDestroyed() ? compositorWin : null
}
