import { Menu, Tray, app, nativeImage } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { showControlPanel, toggleControlPanel } from './windows/control-panel'
import { getStore } from './store'

let tray: Tray | null = null

/** 生成一个简单的内嵌托盘图标（红色圆点），避免依赖外部资源 */
function trayIcon(): Electron.NativeImage {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAb0lEQVRYw+2XsQ3AIAwE2YFfZKMSkYlKRCYqEZnIROWihLakIP5Q2Lxv9/KeNABwzvVqLR97ANgH+G0AC2ADC2ADC2ADC2ADC2ADC2ADC2ADC2ADC2ADC2ADC2ADC2ADC2ADC2ADC2ADC2ADC2BMA9cJe4klg2HlH1D2YAAAAAElFTkSuQmCC',
    'base64'
  )
  return nativeImage.createFromBuffer(png)
}

export function initTray() {
  const store = getStore()
  // 优先使用 resources/icon.png（若存在）
  let icon = trayIcon()
  try {
    const iconPath = path.join(app.getAppPath(), 'resources/icon.png')
    if (fs.existsSync(iconPath)) {
      icon = nativeImage.createFromPath(iconPath)
    }
  } catch {
    /* 用内嵌图标 */
  }

  tray = new Tray(icon)
  tray.setToolTip('Desk-Video')
  rebuildMenu()
  tray.on('click', () => toggleControlPanel())
}

function buildMenuTemplate(): Electron.MenuItemConstructorOptions[] {
  const store = getStore()
  return [
    { label: '打开控制面板', click: () => showControlPanel() },
    { label: '显示/隐藏面板', click: () => toggleControlPanel() },
    { type: 'separator' },
    {
      label: '聚光灯',
      type: 'checkbox',
      checked: store.spotlightOn,
      click: (item) => store.patch({ spotlightOn: item.checked })
    },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ]
}

function rebuildMenu() {
  if (!tray) return
  tray.setContextMenu(Menu.buildFromTemplate(buildMenuTemplate()))
}

export function updateTrayMenu() {
  rebuildMenu()
}

export { toggleControlPanel }
