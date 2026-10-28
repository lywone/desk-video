import type { Rect, SourceInfo } from '@shared/types'

export interface ScreenStreamResult {
  stream: MediaStream
  video: HTMLVideoElement
  hasSystemAudio: boolean
}

/**
 * 打开屏幕捕获流。
 * 系统声优先与视频一次请求（chromeMediaSource=desktop 的音频即 WASAPI loopback），
 * 失败则降级为纯视频，由调用方走 ffmpeg loopback 兜底。
 */
export async function openScreenStream(
  sourceId: string,
  res: { width: number; height: number }
): Promise<ScreenStreamResult> {
  const videoMandatory = {
    chromeMediaSource: 'desktop',
    chromeMediaSourceId: sourceId,
    // 只设上限：精确 min 约束在低分屏/帧率不满足时会 OverconstrainedError
    maxWidth: res.width,
    maxHeight: res.height
  }

  // 先尝试带系统声
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'desktop' } },
      video: { mandatory: videoMandatory }
    } as unknown as MediaStreamConstraints)
    const hasSystemAudio = stream.getAudioTracks().length > 0
    const video = attachVideo(stream)
    return { stream, video, hasSystemAudio }
  } catch {
    // 纯视频重试
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { mandatory: videoMandatory }
    } as unknown as MediaStreamConstraints)
    const video = attachVideo(stream)
    return { stream, video, hasSystemAudio: false }
  }
}

function attachVideo(stream: MediaStream): HTMLVideoElement {
  const video = document.createElement('video')
  video.srcObject = stream
  video.muted = true
  video.playsInline = true
  void video.play()
  return video
}

/** sourceId 为空时（热键直录）默认取第一个屏幕 */
export async function resolveSourceId(preferred: string | null): Promise<string> {
  if (preferred) return preferred
  const list = await window.api.listSources()
  const screen = list.find((s: SourceInfo) => s.type === 'screen')
  if (!screen) throw new Error('没有可用的屏幕源')
  return screen.id
}

/** 把全局光标坐标归一化到目标屏幕 */
export function normalizeCursor(
  pos: { x: number; y: number },
  bounds: Rect | null
): { x: number; y: number } | null {
  if (!bounds) return null
  const { x, y, width, height } = bounds
  const nx = (pos.x - x) / width
  const ny = (pos.y - y) / height
  if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return null
  return { x: nx, y: ny }
}

/** cover 方式绘制视频到画布 */
export function drawCover(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  W: number,
  H: number
) {
  const vw = video.videoWidth || W
  const vh = video.videoHeight || H
  const scale = Math.max(W / vw, H / vh)
  const dw = vw * scale
  const dh = vh * scale
  ctx.drawImage(video, (W - dw) / 2, (H - dh) / 2, dw, dh)
}
