import { app, BrowserWindow, screen } from 'electron'
import path from 'node:path'
import { applyContentProtection, loadRenderer } from './win-utils'

/**
 * 标注 Overlay 窗口：
 * - 透明、无边框、置顶（screen-saver 层级）
 * - setContentProtection(true)：从桌面捕获中排除（录制里不会重复出现标注层）
 * - 默认鼠标穿透 + forward，工具条 hover / 画笔模式时由 renderer 请求关闭穿透
 */
export function createOverlay(): BrowserWindow {
  const win = new BrowserWindow({
    x: 0,
    y: 0,
    width: 400,
    height: 300,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    show: false,
    title: 'overlay',
    focusable: true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })

  win.setAlwaysOnTop(true, 'screen-saver')
  // 关键：排除自身被桌面捕获
  applyContentProtection(win)
  win.setIgnoreMouseEvents(true, { forward: true })
  loadRenderer(win, 'overlay/overlay.html')

  win.once('ready-to-show', () => {
    win.showInactive()
    fitOverlayToDisplay(win)
  })

  // 防止 overlay 意外关闭导致标注能力丢失（退出时除外）
  win.on('closed', () => {
    setTimeout(() => {
      if ((app as unknown as { isQuitting?: boolean }).isQuitting) return
      if (!BrowserWindow.getAllWindows().some((w) => w.getTitle() === 'overlay')) {
        createOverlay()
      }
    }, 300)
  })

  return win
}

export function getOverlay(): BrowserWindow | null {
  const win = BrowserWindow.getAllWindows().find((w) => w.getTitle() === 'overlay')
  return win && !win.isDestroyed() ? win : null
}

/** 让 overlay 完整覆盖某个 display（默认主屏） */
export function fitOverlayToDisplay(win?: BrowserWindow, displayId?: string | null) {
  const target = win ?? getOverlay()
  if (!target) return
  const displays = screen.getAllDisplays()
  const disp =
    (displayId ? displays.find((d) => String(d.id) === String(displayId)) : undefined) ??
    screen.getPrimaryDisplay()
  const { x, y, width, height } = disp.bounds
  target.setBounds({ x, y, width, height })
}
