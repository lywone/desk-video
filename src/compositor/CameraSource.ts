export class CameraSource {
  private video = document.createElement('video')
  private stream: MediaStream | null = null
  ready = false
  /** 最近一次 open 失败的可读原因 */
  lastError = ''

  async open(): Promise<boolean> {
    if (this.ready) return true
    this.lastError = ''
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: false
      })
      this.video.srcObject = this.stream
      this.video.muted = true
      this.video.playsInline = true
      // 挂到 DOM（不可见），避免隐藏窗口下视频解码被节流
      this.video.style.display = 'none'
      if (!this.video.parentElement) document.body.appendChild(this.video)
      await this.video.play()
      this.ready = true
      return true
    } catch (err) {
      const name = (err as DOMException)?.name ?? String(err)
      this.lastError =
        name === 'NotFoundError'
          ? '未检测到摄像头设备'
          : name === 'NotAllowedError'
            ? '摄像头权限被拒绝'
            : name === 'NotReadableError'
              ? '摄像头被其他应用占用'
              : `摄像头打开失败: ${name}`
      this.ready = false
      return false
    }
  }

  close() {
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.video.srcObject = null
    this.ready = false
  }

  /** 圆形头像式 PIP 绘制（直径 = H * sizeFraction） */
  draw(
    ctx: CanvasRenderingContext2D,
    W: number,
    H: number,
    corner: 'br' | 'bl' | 'tr' | 'tl',
    sizeFraction: number,
    visible: boolean
  ) {
    if (!visible || !this.ready || this.video.videoWidth === 0) return
    const d = H * sizeFraction // 头像直径
    const r = d / 2
    const margin = H * 0.03

    let cx: number
    let cy: number
    if (corner === 'br') {
      cx = W - margin - r
      cy = H - margin - r
    } else if (corner === 'bl') {
      cx = margin + r
      cy = H - margin - r
    } else if (corner === 'tr') {
      cx = W - margin - r
      cy = margin + r
    } else {
      cx = margin + r
      cy = margin + r
    }

    // 视频按圆形区域封面裁切，垂直取景略微上移（人脸通常在画面中上部）
    const vw = this.video.videoWidth
    const vh = this.video.videoHeight
    const scale = Math.max(d / vw, d / vh)
    const sw = d / scale
    const sh = d / scale
    const sx = (vw - sw) / 2
    const sy = Math.max(0, (vh - sh) * 0.4)

    ctx.save()
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.clip()
    ctx.drawImage(this.video, sx, sy, sw, sh, cx - r, cy - r, d, d)
    ctx.restore()

    // 细边框
    ctx.save()
    ctx.strokeStyle = 'rgba(255,255,255,0.65)'
    ctx.lineWidth = Math.max(2, W / 960)
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }
}
