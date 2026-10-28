import { reactive } from 'vue'
import type { RecorderState, Stroke } from '@shared/types'

/** 渲染端响应式状态镜像：初始从 main 拉全量，之后吃广播增量 */
export const state = reactive<RecorderState>({
  outputDir: '',
  resolution: '720p',
  fps: 30,
  segmentMinutes: 10,
  cameraEnabled: false,
  cameraCorner: 'br',
  cameraSize: 0.25,
  micEnabled: true,
  systemEnabled: true,
  micVolume: 1,
  systemVolume: 1,
  videoBitrateMbps: 6,
  countdownSeconds: 3,
  minimizePanelWhileRecording: true,
  status: 'idle',
  sourceId: null,
  sourceType: null,
  sourceName: '',
  targetBounds: null,
  tool: 'select',
  toolColor: '#ff3b30',
  toolWidth: 4,
  spotlightOn: false,
  countdownLeft: 0,
  currentFile: '',
  lastOutputFiles: [],
  error: null,
  cameraVisible: true
})

let initialized = false

export async function initState() {
  if (initialized) return
  initialized = true
  const full = await window.api.getState()
  Object.assign(state, full)
  window.api.onStateChanged((partial: Record<string, unknown>) => {
    Object.assign(state, partial as Partial<RecorderState>)
  })
}

/** strokes 本地镜像（overlay / compositor 共用） */
export const strokes = reactive<Stroke[]>([])

export function initStrokes() {
  window.api.onStrokes((list: unknown[]) => {
    strokes.splice(0, strokes.length, ...(list as Stroke[]))
  })
}

export function setTool(tool: RecorderState['tool']) {
  state.tool = tool
  window.api.setState({ tool })
}

export function patchState(partial: Partial<RecorderState>) {
  Object.assign(state, partial)
  window.api.setState(partial as Record<string, unknown>)
}

export function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const p = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`
}

export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}
