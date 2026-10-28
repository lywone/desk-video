import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc-channels'
import type { AppSettings, RecorderState, RecorderTick, Stroke } from '@shared/types'

const DEFAULT_SETTINGS: AppSettings = {
  outputDir: '',
  resolution: '720p',
  fps: 30,
  segmentMinutes: 10,
  cameraEnabled: false,
  cameraCorner: 'br',
  cameraSize: 0.16,
  micEnabled: true,
  systemEnabled: true,
  micVolume: 1,
  systemVolume: 1,
  videoBitrateMbps: 6,
  countdownSeconds: 3,
  minimizePanelWhileRecording: true
}

const RESOLUTION_MAP = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
  '1440p': { width: 2560, height: 1440 },
  '2160p': { width: 3840, height: 2160 }
} as const

/** native 表示跟随屏幕原始分辨率，由调用方根据 targetBounds 决定 */
export function resolutionSize(res: AppSettings['resolution']) {
  return res === 'native' ? null : RESOLUTION_MAP[res]
}

class MainStore {
  settings: AppSettings
  status: RecorderState['status'] = 'idle'
  sourceId: string | null = null
  sourceType: RecorderState['sourceType'] = null
  sourceName = ''
  sourceDisplayId: string | null = null
  targetBounds: RecorderState['targetBounds'] = null
  tool: RecorderState['tool'] = 'select'
  toolColor = '#ff3b30'
  toolWidth = 4
  spotlightOn = false
  countdownLeft = 0
  currentFile = ''
  lastOutputFiles: string[] = []
  error: string | null = null
  cameraVisible = true

  strokes: Stroke[] = []

  private configPath = path.join(app.getPath('userData'), 'desk-video-config.json')

  constructor() {
    this.settings = { ...DEFAULT_SETTINGS, ...this.loadSettings() }
    if (!this.settings.outputDir) {
      this.settings.outputDir = defaultOutputDir()
    }
  }

  private loadSettings(): Partial<AppSettings> {
    try {
      return JSON.parse(fs.readFileSync(this.configPath, 'utf-8'))
    } catch {
      return {}
    }
  }

  saveSettings() {
    try {
      fs.mkdirSync(path.dirname(this.configPath), { recursive: true })
      fs.writeFileSync(this.configPath, JSON.stringify(this.settings, null, 2), 'utf-8')
    } catch (err) {
      console.error('[store] save settings failed:', err)
    }
  }

  getState(): RecorderState {
    return {
      ...this.settings,
      status: this.status,
      sourceId: this.sourceId,
      sourceType: this.sourceType,
      sourceName: this.sourceName,
      targetBounds: this.targetBounds,
      tool: this.tool,
      toolColor: this.toolColor,
      toolWidth: this.toolWidth,
      spotlightOn: this.spotlightOn,
      countdownLeft: this.countdownLeft,
      currentFile: this.currentFile,
      lastOutputFiles: this.lastOutputFiles,
      error: this.error,
      cameraVisible: this.cameraVisible
    }
  }

  /** 应用局部更新并广播到所有窗口；skipId 之后的窗口不再回发 */
  patch(partial: Partial<RecorderState>, fromWebContentsId?: number) {
    const settingsKeys = Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[]
    let settingsDirty = false
    for (const [k, v] of Object.entries(partial)) {
      if (settingsKeys.includes(k as keyof AppSettings)) {
        ;(this.settings as unknown as Record<string, unknown>)[k] = v
        settingsDirty = true
      } else if (k in this) {
        ;(this as unknown as Record<string, unknown>)[k] = v
      }
    }
    if (settingsDirty) this.saveSettings()
    this.broadcast(partial, fromWebContentsId)
  }

  broadcast(partial: Partial<RecorderState>, fromWebContentsId?: number) {
    const payload = { ...partial }
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue
      if (fromWebContentsId != null && win.webContents.id === fromWebContentsId) continue
      win.webContents.send(IPC.StateChanged, payload)
    }
  }

  setStrokes(strokes: Stroke[], fromWebContentsId?: number) {
    this.strokes = strokes
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue
      if (fromWebContentsId != null && win.webContents.id === fromWebContentsId) continue
      win.webContents.send(IPC.StrokesChanged, strokes)
    }
  }
}

function defaultOutputDir(): string {
  try {
    const videos = app.getPath('videos')
    const dir = path.join(videos, 'desk-video')
    fs.mkdirSync(dir, { recursive: true })
    return dir
  } catch {
    return app.getPath('documents')
  }
}

let store: MainStore | null = null

export function initStore(): MainStore {
  if (!store) store = new MainStore()
  return store
}

export function getStore(): MainStore {
  if (!store) throw new Error('store not initialized')
  return store
}

export function makeTick(tick: RecorderTick) {
  return tick
}
