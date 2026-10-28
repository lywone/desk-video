import PcmWorkletUrl from './PcmWorklet.js?url'

/**
 * 音频混音：麦克风 + 系统声（或 ffmpeg loopback PCM）→ MediaStreamDestination
 * 同时提供两路电平（AnalyserNode RMS）
 */
export class AudioMixer {
  ctx: AudioContext
  dest: MediaStreamAudioDestinationNode
  private micGain: GainNode
  private sysGain: GainNode
  private micAnalyser: AnalyserNode
  private sysAnalyser: AnalyserNode
  private worklet: AudioWorkletNode | null = null
  private buf: Float32Array<ArrayBuffer>

  constructor() {
    this.ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' })
    this.dest = this.ctx.createMediaStreamDestination()
    this.micGain = this.ctx.createGain()
    this.sysGain = this.ctx.createGain()
    this.micAnalyser = this.ctx.createAnalyser()
    this.micAnalyser.fftSize = 1024
    this.sysAnalyser = this.ctx.createAnalyser()
    this.sysAnalyser.fftSize = 1024
    this.buf = new Float32Array(1024)
  }

  private chainMic(node: AudioNode) {
    node.connect(this.micGain)
    this.micGain.connect(this.micAnalyser)
    this.micAnalyser.connect(this.dest)
  }

  private chainSys(node: AudioNode) {
    node.connect(this.sysGain)
    this.sysGain.connect(this.sysAnalyser)
    this.sysAnalyser.connect(this.dest)
  }

  addStream(stream: MediaStream, which: 'mic' | 'sys') {
    const src = this.ctx.createMediaStreamSource(stream)
    if (which === 'mic') this.chainMic(src)
    else this.chainSys(src)
  }

  async enableLoopback() {
    if (this.worklet) return
    await this.ctx.audioWorklet.addModule(PcmWorkletUrl)
    this.worklet = new AudioWorkletNode(this.ctx, 'pcm-feed', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2]
    })
    this.chainSys(this.worklet)
  }

  /** s16le interleaved stereo PCM → worklet */
  feedPcm(s16le: ArrayBuffer) {
    if (!this.worklet) return
    const i16 = new Int16Array(s16le)
    const frames = i16.length / 2
    const l = new Float32Array(frames)
    const r = new Float32Array(frames)
    for (let i = 0; i < frames; i++) {
      l[i] = i16[i * 2] / 32768
      r[i] = i16[i * 2 + 1] / 32768
    }
    this.worklet.port.postMessage({ l, r }, [l.buffer, r.buffer])
  }

  setVolumes(mic: number, sys: number) {
    this.micGain.gain.value = mic
    this.sysGain.gain.value = sys
  }

  levels(): { mic: number; system: number } {
    const rms = (analyser: AnalyserNode) => {
      analyser.getFloatTimeDomainData(this.buf)
      let sum = 0
      for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i]
      return Math.min(1, Math.sqrt(sum / this.buf.length) * 3.2)
    }
    return { mic: rms(this.micAnalyser), system: rms(this.sysAnalyser) }
  }

  /** 隐藏窗口里 AudioContext 可能被暂停，录制前恢复 */
  async resume() {
    try {
      if (this.ctx.state !== 'running') await this.ctx.resume()
    } catch {
      /* noop */
    }
  }

  audioTracks(): MediaStreamTrack[] {
    return this.dest.stream.getAudioTracks()
  }

  async close() {
    try {
      await this.ctx.close()
    } catch {
      /* noop */
    }
  }
}
