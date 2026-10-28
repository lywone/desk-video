export type RecorderStatus = 'idle' | 'countdown' | 'recording' | 'paused' | 'stopping'

export type SourceType = 'screen' | 'window'

export type CameraCorner = 'br' | 'bl' | 'tr' | 'tl'

export type ToolId = 'select' | 'pen' | 'highlighter' | 'arrow' | 'rect' | 'text' | 'eraser'

/** 归一化坐标（相对录制目标屏幕，0~1），规避 DPI 缩放问题 */
export interface StrokePoint {
  x: number
  y: number
}

export interface Stroke {
  id: string
  tool: ToolId
  color: string
  /** 基准 1920 宽度下的像素粗细 */
  width: number
  /** pen / highlighter */
  points?: StrokePoint[]
  /** arrow / rect / text 锚点 */
  x0?: number
  y0?: number
  x1?: number
  y1?: number
  text?: string
  createdAt: number
}

export interface SourceInfo {
  id: string
  name: string
  type: SourceType
  thumbnailDataUrl?: string
  displayId?: string
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface AppSettings {
  outputDir: string
  resolution: '720p' | '1080p' | '1440p' | '2160p' | 'native'
  fps: number
  segmentMinutes: number
  cameraEnabled: boolean
  cameraCorner: CameraCorner
  /** PIP 宽度占画面比例 0.2~0.5 */
  cameraSize: number
  micEnabled: boolean
  systemEnabled: boolean
  micVolume: number
  systemVolume: number
  videoBitrateMbps: number
  countdownSeconds: number
  minimizePanelWhileRecording: boolean
}

export interface RecorderState extends AppSettings {
  status: RecorderStatus
  sourceId: string | null
  sourceType: SourceType | null
  sourceName: string
  /** 录制目标屏幕的虚拟屏幕坐标，用于归一化映射 */
  targetBounds: Rect | null
  tool: ToolId
  toolColor: string
  toolWidth: number
  spotlightOn: boolean
  countdownLeft: number
  currentFile: string
  lastOutputFiles: string[]
  error: string | null
  cameraVisible: boolean
}

/** 每 500ms 广播的录制进度 tick */
export interface RecorderTick {
  elapsedMs: number
  totalBytes: number
  diskFree: number
  segments: number
}

export interface AudioLevels {
  mic: number
  system: number
}

export interface TrimRequest {
  file: string
  startSec: number
  endSec: number
}
