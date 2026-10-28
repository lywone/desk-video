import { BrowserWindow } from 'electron'
import path from 'node:path'
import { applyContentProtection, loadRenderer } from './win-utils'

function pathJoinPreload(): string {
  return path.join(__dirname, '../preload/index.js')
}

let panelWin: BrowserWindow | null = null

export function createControlPanel(): BrowserWindow {
  if (panelWin && !panelWin.isDestroyed()) {
    panelWin.focus()
    return panelWin
  }
  panelWin = new BrowserWindow({
    width: 880,
    height: 680,
    minWidth: 760,
    minHeight: 600,
    title: 'Desk-Video',
    show: true,
    autoHideMenuBar: true,
    backgroundColor: '#101418',
    webPreferences: {
      preload: pathJoinPreload(),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  panelWin.on('closed', () => {
    panelWin = null
  })
  panelWin.on('close', (e) => {
    // 关闭窗口 = 隐藏到托盘，退出走托盘菜单
    if (!(panelWin as unknown as { forceClose?: boolean }).forceClose) {
      e.preventDefault()
      panelWin?.hide()
    }
  })
  applyContentProtection(panelWin)
  loadRenderer(panelWin, 'panels/index.html')
  return panelWin
}

export function getControlPanel(): BrowserWindow | null {
  if (panelWin && !panelWin.isDestroyed()) return panelWin
  return null
}

export function showControlPanel() {
  const win = getControlPanel() ?? createControlPanel()
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

export function toggleControlPanel() {
  const win = getControlPanel()
  if (!win) {
    showControlPanel()
    return
  }
  if (win.isVisible() && !win.isMinimized()) {
    win.hide()
  } else {
    showControlPanel()
  }
}

export function hideControlPanel() {
  panelWin?.hide()
}

