import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import { IPC } from '../../src/shared/ipc-channels'

function on<T extends unknown[]>(channel: string, cb: (...args: T) => void) {
  const listener = (_e: IpcRendererEvent, ...args: unknown[]) => cb(...(args as T))
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  // 状态
  getState: () => ipcRenderer.invoke(IPC.StateGet),
  setState: (partial: Record<string, unknown>) => ipcRenderer.send(IPC.StateSet, partial),
  onStateChanged: (cb: (partial: Record<string, unknown>) => void) => on(IPC.StateChanged, cb),

  // 源
  listSources: () => ipcRenderer.invoke(IPC.SourceList),
  selectSource: (info: unknown) => ipcRenderer.send(IPC.SourceSelect, info),

  // 录制控制
  start: () => ipcRenderer.send(IPC.RecorderStart),
  pause: () => ipcRenderer.send(IPC.RecorderPause),
  resume: () => ipcRenderer.send(IPC.RecorderResume),
  stop: () => ipcRenderer.send(IPC.RecorderStop),

  // compositor → main
  recorderEvent: (evt: { type: string; message?: string }) =>
    ipcRenderer.send(IPC.RecorderEvent, evt),
  sendSegmentChunk: (chunk: ArrayBuffer) => ipcRenderer.send(IPC.SegmentChunk, chunk),
  requestSegment: () => ipcRenderer.invoke(IPC.RequestSegment),

  // main → renderer
  onSegmentStarted: (cb: (file: string) => void) => on(IPC.SegmentStarted, cb),
  onRecorderTick: (cb: (tick: unknown) => void) => on('recorder:tick', cb),
  onShowPreview: (cb: (file: string) => void) => on(IPC.ShowPreview, cb),
  onPreviewFile: (cb: (file: string) => void) => on('preview:file', cb),

  // 标注
  addStroke: (stroke: unknown) => ipcRenderer.send(IPC.StrokesAdd, stroke),
  removeStroke: (id: string) => ipcRenderer.send(IPC.StrokesRemove, id),
  undoStroke: () => ipcRenderer.send(IPC.StrokesUndo),
  clearStrokes: () => ipcRenderer.send(IPC.StrokesClear),
  onStrokes: (cb: (strokes: unknown[]) => void) => on(IPC.StrokesChanged, cb),

  // 光标
  onCursor: (cb: (pos: { x: number; y: number }) => void) => on(IPC.CursorMove, cb),

  // 音频电平上报
  sendAudioLevels: (levels: { mic: number; system: number }) =>
    ipcRenderer.send(IPC.AudioLevels, levels),
  onAudioLevels: (cb: (l: { mic: number; system: number }) => void) => on(IPC.AudioLevels, cb),

  // 系统声兜底
  loopbackStart: () => ipcRenderer.invoke(IPC.LoopbackStart),
  loopbackStop: () => ipcRenderer.send(IPC.LoopbackStop),
  onLoopbackData: (cb: (buf: ArrayBuffer) => void) => on(IPC.LoopbackData, cb),

  // 输出 / 预览 / 裁剪
  openOutputDir: () => ipcRenderer.send(IPC.OpenOutputDir),
  pickDirectory: () => ipcRenderer.invoke(IPC.PickDirectory),
  trim: (req: { file: string; startSec: number; endSec: number }) =>
    ipcRenderer.invoke(IPC.TrimRequest, req),

  // 窗口
  setIgnoreMouse: (ignore: boolean) => ipcRenderer.send(IPC.SetIgnoreMouse, ignore),
  quitApp: () => ipcRenderer.send(IPC.AppQuit),

  platform: process.platform
}

export type DeskVideoApi = typeof api

contextBridge.exposeInMainWorld('api', api)
