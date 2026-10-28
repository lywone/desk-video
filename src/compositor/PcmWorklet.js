/**
 * PCM 环形缓冲 AudioWorklet：
 * 主线程通过 port.postMessage 喂 Float32 L/R，这里恒定消费，不够时输出静音。
 */
class PcmFeed extends AudioWorkletProcessor {
  private queueL: Float32Array[] = []
  private queueR: Float32Array[] = []
  private cap = sampleRate * 4

  constructor() {
    super()
    this.port.onmessage = (e) => {
      const { l, r } = e.data as { l: Float32Array; r: Float32Array }
      this.queueL.push(l)
      this.queueR.push(r)
      let total = this.queueL.reduce((s, a) => s + a.length, 0)
      // 防积压
      while (total > this.cap && this.queueL.length > 1) {
        this.queueL.shift()
        this.queueR.shift()
        total = this.queueL.reduce((s, a) => s + a.length, 0)
      }
    }
  }

  process(_inputs: unknown, outputs: AudioNode[][]): boolean {
    const out = outputs[0] as Float32Array[]
    if (!out || out.length === 0) return true
    const left = out[0]
    const right = out[1] ?? out[0]

    let li = 0
    let ri = 0
    while ((li < left.length || ri < right.length) && this.queueL.length > 0) {
      const lBuf = this.queueL[0]
      const rBuf = this.queueR[0]
      while (li < left.length && lBuf.length > 0) {
        left[li++] = lBuf[0]
        lBuf.copyWithin(0, 1)
        // 缩短有效长度（用子数组模拟 pop）
        this.queueL[0] = lBuf.subarray(1)
        break
      }
      while (ri < right.length && rBuf.length > 0) {
        right[ri++] = rBuf[0]
        this.queueR[0] = rBuf.subarray(1)
        break
      }
      if (this.queueL[0].length === 0) this.queueL.shift()
      if (this.queueR[0].length === 0) this.queueR.shift()
    }
    // 剩余补静音
    for (; li < left.length; li++) left[li] = 0
    for (; ri < right.length; ri++) right[ri] = 0
    return true
  }
}

registerProcessor('pcm-feed', PcmFeed)
