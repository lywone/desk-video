export interface RecorderOptions {
  videoBitsPerSecond: number
  audioBitsPerSecond?: number
}

function pickMime(): string {
  const candidates = [
    'video/webm;codecs=h264,opus',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm'
  ]
  for (const m of candidates) {
    if (MediaRecorder.isTypeSupported(m)) return m
  }
  return ''
}

/**
 * 分段录制器：canvas.captureStream(0) 手动推帧 + 音频轨道 → MediaRecorder
 * chunk 每 1s 落盘（IPC append），崩溃最多丢 1 秒。
 */
export class SegmentRecorder {
  private recorder: MediaRecorder | null = null
  private videoTrack: CanvasCaptureMediaStreamTrack | null = null
  private stream: MediaStream | null = null

  get active() {
    return this.recorder?.state === 'recording' || this.recorder?.state === 'paused'
  }

  start(canvas: HTMLCanvasElement, audioTracks: MediaStreamTrack[], opts: RecorderOptions) {
    this.stream = canvas.captureStream(0)
    this.videoTrack = this.stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack
    for (const t of audioTracks) this.stream.addTrack(t)

    const mimeType = pickMime()
    this.recorder = new MediaRecorder(this.stream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: opts.videoBitsPerSecond,
      audioBitsPerSecond: opts.audioBitsPerSecond ?? 128000
    })
    this.recorder.ondataavailable = async (e) => {
      if (e.data && e.data.size > 0) {
        try {
          const buf = await e.data.arrayBuffer()
          window.api.sendSegmentChunk(buf)
        } catch (err) {
          console.error('[recorder] chunk send failed', err)
        }
      }
    }
    this.recorder.start(1000)
  }

  requestFrame() {
    this.videoTrack?.requestFrame()
  }

  pause() {
    if (this.recorder?.state === 'recording') this.recorder.pause()
  }

  resume() {
    if (this.recorder?.state === 'paused') this.recorder.resume()
  }

  /** 停止并在最后 chunk 发送完成后 resolve */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      const rec = this.recorder
      if (!rec || rec.state === 'inactive') {
        resolve()
        return
      }
      rec.onstop = () => {
        // ondataavailable 的最后一个 chunk 在 onstop 前发出，这里再让一拍 IPC
        setTimeout(resolve, 120)
      }
      if (rec.state === 'paused' || rec.state === 'recording') rec.stop()
    })
  }

  dispose() {
    this.recorder = null
    this.videoTrack = null
    this.stream?.getVideoTracks().forEach((t) => t.stop())
    this.stream = null
  }
}
