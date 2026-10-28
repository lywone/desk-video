import { BrowserWindow, screen } from 'electron'
import path from 'node:path'

export function resolveRendererFile(htmlRel: string): string {
  return path.join(__dirname, '../renderer/', htmlRel)
}

export function rendererBaseUrl(): string | null {
  return process.env.ELECTRON_RENDERER_URL ?? null
}

export function loadRenderer(win: BrowserWindow, htmlRel: string) {
  const base = rendererBaseUrl()
  if (base) {
    void win.loadURL(`${base}/${htmlRel}`)
  } else {
    void win.loadFile(resolveRendererFile(htmlRel))
  }
}

/** 主显示器或指定 display 的完整 bounds（非 workArea，覆盖任务栏） */
export function displayBounds(displayId?: string | null) {
  const displays = screen.getAllDisplays()
  const target = displayId ? displays.find((d) => String(d.id) === String(displayId)) : undefined
  return (target ?? screen.getPrimaryDisplay()).bounds
}

/**
 * 从桌面捕获中排除窗口。
 * Windows 实测（2026-10-28，Electron 33）：透明窗仅在创建时设置一次无效，
 * 必须在 show 之后（以及最小化恢复后）重设一次 WDA_EXCLUDEFROMCAPTURE 才生效。
 */
export function applyContentProtection(win: BrowserWindow) {
  win.setContentProtection(true)
  win.once('ready-to-show', () => win.setContentProtection(true))
  win.on('show', () => win.setContentProtection(true))
  win.on('restore', () => win.setContentProtection(true))
}
