import { BrowserWindow } from 'electron'
import path from 'node:path'
import { applyContentProtection, loadRenderer } from './win-utils'

let previewWin: BrowserWindow | null = null

export function openPreview(file: string) {
  console.log('[preview] openPreview:', file)
  if (previewWin && !previewWin.isDestroyed()) {
    previewWin.focus()
    previewWin.webContents.send('preview:file', file)
    return
  }
  previewWin = new BrowserWindow({
    width: 960,
    height: 680,
    title: '预览与裁剪',
    autoHideMenuBar: true,
    backgroundColor: '#101418',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  previewWin.on('closed', () => {
    previewWin = null
  })
  // 渲染进程 console 转发到主进程终端：play() 失败、seek 异常等只在 renderer console 出现
  previewWin.webContents.on('console-message', (...args: unknown[]) => {
    // Electron 32+: (event, {level, message, sourceId, lineNumber})；旧版: (event, level, message, line, sourceId)
    const d = args[1]
    if (d && typeof d === 'object' && 'message' in (d as object)) {
      const o = d as { message?: string; sourceId?: string; lineNumber?: number }
      console.log(`[preview-web] ${o.message} (${o.sourceId ?? ''}:${o.lineNumber ?? ''})`)
    } else {
      const [, , message, line, sourceId] = args as [unknown, unknown, string, number, string]
      console.log(`[preview-web] ${message} (${sourceId}:${line})`)
    }
  })
  applyContentProtection(previewWin)
  loadRenderer(previewWin, 'panels/preview.html')
  previewWin.webContents.once('did-finish-load', () => {
    previewWin?.webContents.send('preview:file', file)
  })
}

export function getPreviewWindow(): BrowserWindow | null {
  return previewWin && !previewWin.isDestroyed() ? previewWin : null
}
