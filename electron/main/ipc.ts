import { app, dialog, desktopCapturer, ipcMain, shell, BrowserWindow, screen } from 'electron'
import { getStore } from './store'
import { getOverlay, fitOverlayToDisplay } from './windows/overlay'
import { getControlPanel } from './windows/control-panel'
import { getCompositor } from './windows/compositor'
import { LoopbackCapture } from './audio-loopback'
import { session, handleRecorderStart, handleRecorderPause, handleRecorderResume, handleRecorderStop, handleRecorderStoppedByCompositor, handleRecorderError } from './main-flow'
import { trimVideo } from './recorder-session'
import { openPreview } from './windows/preview'
import { IPC } from '@shared/ipc-channels'
import type { SourceInfo, Stroke } from '@shared/types'

const loopback = new LoopbackCapture()

export function registerIpc() {
  const store = getStore()

  // ---------- 状态 ----------
  ipcMain.handle(IPC.StateGet, () => store.getState())

  ipcMain.on(IPC.StateSet, (_e, partial: Record<string, unknown>) => {
    store.patch(partial, _e.sender.id)
  })

  // ---------- 源 ----------
  ipcMain.handle(IPC.SourceList, async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 200 },
      fetchWindowIcons: true
    })
    const list: SourceInfo[] = sources.map((s) => ({
      id: s.id,
      name: s.name || (s.id.startsWith('screen:') ? '屏幕' : '窗口'),
      type: s.id.startsWith('screen:') ? 'screen' : 'window',
      thumbnailDataUrl: s.thumbnail.toDataURL(),
      displayId: s.display_id || undefined
    }))
    // 屏幕排前面
    return list.sort((a, b) => (a.type === b.type ? 0 : a.type === 'screen' ? -1 : 1))
  })

  ipcMain.on(IPC.SourceSelect, (_e, info: SourceInfo) => {
    store.sourceId = info.id
    store.sourceType = info.type
    store.sourceName = info.name
    store.sourceDisplayId = info.displayId ?? null
    if (info.type === 'screen') {
      fitOverlayToDisplay(undefined, info.displayId)
      const displays = screen.getAllDisplays()
      const disp =
        displays.find((d) => String(d.id) === String(info.displayId)) ?? screen.getPrimaryDisplay()
      store.targetBounds = disp.bounds
    } else {
      store.targetBounds = screen.getPrimaryDisplay().bounds
    }
    store.patch({
      sourceId: info.id,
      sourceType: info.type,
      sourceName: info.name
    })
  })

  // ---------- 录制控制 ----------
  ipcMain.on(IPC.RecorderStart, () => void handleRecorderStart())
  ipcMain.on(IPC.RecorderPause, () => handleRecorderPause())
  ipcMain.on(IPC.RecorderResume, () => handleRecorderResume())
  ipcMain.on(IPC.RecorderStop, () => void handleRecorderStop())

  // ---------- compositor 事件 ----------
  ipcMain.on(IPC.RecorderEvent, (_e, evt: { type: string; message?: string }) => {
    if (evt.type === 'stopped') {
      void handleRecorderStoppedByCompositor()
    } else if (evt.type === 'error') {
      handleRecorderError(evt.message ?? '未知错误')
    }
  })

  ipcMain.on(IPC.SegmentChunk, (_e, chunk: ArrayBuffer) => {
    session.appendChunk(chunk)
  })

  ipcMain.handle(IPC.RequestSegment, () => session.requestSegment())

  // ---------- 标注 ----------
  ipcMain.on(IPC.StrokesAdd, (e, stroke: Stroke) => {
    const next = [...store.strokes, stroke]
    store.setStrokes(next, e.sender.id)
  })
  ipcMain.on(IPC.StrokesRemove, (e, id: string) => {
    const next = store.strokes.filter((s) => s.id !== id)
    store.setStrokes(next, e.sender.id)
  })
  ipcMain.on(IPC.StrokesUndo, (e) => {
    const next = store.strokes.slice(0, -1)
    store.setStrokes(next, e.sender.id)
  })
  ipcMain.on(IPC.StrokesClear, (e) => {
    store.setStrokes([], e.sender.id)
  })

  // ---------- 系统声兜底 ----------
  ipcMain.handle(IPC.LoopbackStart, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) return { ok: false, error: 'no window' }
    return loopback.start(win)
  })
  ipcMain.on(IPC.LoopbackStop, () => loopback.stop())

  // ---------- 输出 / 预览 / 裁剪 ----------
  ipcMain.on(IPC.OpenOutputDir, () => {
    void shell.openPath(store.settings.outputDir)
  })

  ipcMain.handle(IPC.PickDirectory, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: store.settings.outputDir
    })
    if (result.canceled || result.filePaths.length === 0) return null
    store.settings.outputDir = result.filePaths[0]
    store.saveSettings()
    store.patch({ outputDir: result.filePaths[0] })
    return result.filePaths[0]
  })

  ipcMain.handle(IPC.TrimRequest, async (_e, req: { file: string; startSec: number; endSec: number }) => {
    try {
      const out = await trimVideo(req.file, req.startSec, req.endSec)
      return { ok: true, file: out }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  // ---------- 窗口控制 ----------
  ipcMain.on(IPC.SetIgnoreMouse, (_e, ignore: boolean) => {
    const overlay = getOverlay()
    if (!overlay) return
    if (ignore) overlay.setIgnoreMouseEvents(true, { forward: true })
    else overlay.setIgnoreMouseEvents(false)
  })

  ipcMain.on(IPC.AppQuit, () => app.quit())

  ipcMain.on(IPC.TogglePanel, () => {
    const panel = getControlPanel()
    if (panel?.isVisible()) panel.hide()
    else panel?.show()
  })
}

export function openPreviewWindow(file: string) {
  openPreview(file)
}

export function getOverlayWin() {
  return getOverlay()
}

export function getCompositorWin() {
  return getCompositor()
}
