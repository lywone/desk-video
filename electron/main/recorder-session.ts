import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { getStore } from './store'
import { ffmpegPath } from './ffmpeg-path'

const FFMPEG = ffmpegPath()

/**
 * 录制会话：负责落盘（webm 流式 append）、分段、停止后 remux 成 mp4。
 * compositor 每 1s 送来一个 chunk，直接 append——崩溃最多丢 1 秒。
 */
export class RecorderSession {
  /** 写盘致命错误回调（由 main-flow 注入 handleRecorderError，避免循环 import） */
  onFatal: ((msg: string) => void) | null = null
  private dir = ''
  private baseName = ''
  private seq = 1
  private stream: fs.WriteStream | null = null
  private currentFile = ''
  private totalBytes = 0
  private startedAt = 0
  private elapsedBeforePause = 0
  private pausedAt: number | null = null
  private files: string[] = []
  private fatalReported = false

  async start(): Promise<void> {
    const store = getStore()
    this.dir = store.settings.outputDir
    fs.mkdirSync(this.dir, { recursive: true })
    const stamp = formatStamp(new Date())
    this.baseName = `rec_${stamp}`
    this.seq = 1
    this.totalBytes = 0
    this.startedAt = Date.now()
    this.elapsedBeforePause = 0
    this.pausedAt = null
    this.files = []
    this.fatalReported = false
    // 不在这里开文件：第一个文件由 compositor 的 segment:request 打开，避免空文件
    this.closeStream()
  }

  private openNewSegment(): string {
    this.closeStream()
    const file = path.join(this.dir, `${this.baseName}_${String(this.seq).padStart(3, '0')}.webm`)
    this.seq += 1
    this.stream = fs.createWriteStream(file, { flags: 'w' })
    // 写盘失败（权限/磁盘满/沙箱限制）：必须上报回 idle，否则状态卡死、按钮永久禁用
    this.stream.on('error', (err) => {
      console.error('[recorder] write stream error:', err)
      if (!this.fatalReported) {
        this.fatalReported = true
        this.onFatal?.(`写入视频文件失败: ${file}（${err.message}）。请检查输出目录权限或在设置中更换`)
      }
    })
    this.currentFile = file
    this.files.push(file)
    const store = getStore()
    store.patch({ currentFile: path.basename(file) })
    return file
  }

  /** compositor 请求新分段：关闭当前，开新文件，返回新文件名 */
  requestSegment(): string {
    this.closeStream()
    return this.openNewSegment()
  }

  appendChunk(chunk: ArrayBuffer | Uint8Array) {
    if (!this.stream) return
    const buf = Buffer.from(chunk as Uint8Array)
    this.stream.write(buf)
    this.totalBytes += buf.byteLength
  }

  pause() {
    if (this.pausedAt == null) this.pausedAt = Date.now()
  }

  resume() {
    if (this.pausedAt != null) {
      this.elapsedBeforePause += Date.now() - this.pausedAt
      this.pausedAt = null
    }
  }

  elapsedMs(): number {
    const now = this.pausedAt ?? Date.now()
    return this.elapsedBeforePause + (this.startedAt ? now - this.startedAt : 0)
  }

  tick() {
    return {
      elapsedMs: this.elapsedMs(),
      totalBytes: this.totalBytes,
      diskFree: 0,
      segments: this.files.length
    }
  }

  /** 停止：关闭流并 remux 全部 webm → mp4；返回 mp4 文件列表 */
  async finalize(): Promise<{ mp4s: string[]; errors: string[] }> {
    this.closeStream()
    const mp4s: string[] = []
    const errors: string[] = []
    for (const webm of this.files) {
      try {
        const mp4 = await remuxToMp4(webm)
        mp4s.push(mp4)
        safeUnlink(webm)
      } catch (err) {
        errors.push(`${path.basename(webm)}: ${String(err)}`)
        mp4s.push(webm) // 保留 webm 兜底
      }
    }
    return { mp4s, errors }
  }

  private closeStream() {
    if (this.stream) {
      try {
        this.stream.end()
      } catch {
        /* noop */
      }
      this.stream = null
    }
  }
}

function formatStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`
}

function safeUnlink(file: string) {
  try {
    fs.unlinkSync(file)
  } catch {
    /* noop */
  }
}

/** webm → mp4：先尝试流拷贝（快），失败则重编码兜底 */
function remuxToMp4(webm: string): Promise<string> {
  const out = webm.replace(/\.webm$/, '.mp4')
  return new Promise((resolve, reject) => {
    if (!FFMPEG) return reject(new Error('ffmpeg not available'))
    const args = [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-i', webm,
      '-c', 'copy',
      '-strict', '-2',
      '-movflags', '+faststart',
      out
    ]
    const proc = spawn(FFMPEG, args, { windowsHide: true })
    let err = ''
    proc.stderr!.on('data', (d: Buffer) => (err += d.toString()))
    proc.on('error', reject)
    proc.on('exit', (code) => {
      if (code === 0 && fs.existsSync(out)) return resolve(out)
      // copy 失败 → 重编码
      transcodeToMp4(webm, out).then(resolve).catch(reject)
    })
  })
}

function transcodeToMp4(webm: string, out: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!FFMPEG) return reject(new Error('ffmpeg not available'))
    const args = [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-i', webm,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      out
    ]
    const proc = spawn(FFMPEG, args, { windowsHide: true })
    let err = ''
    proc.stderr!.on('data', (d: Buffer) => (err += d.toString()))
    proc.on('error', reject)
    proc.on('exit', (code) => {
      if (code === 0 && fs.existsSync(out)) resolve(out)
      else reject(new Error(err.slice(-300) || `ffmpeg exit ${code}`))
    })
  })
}

/** 头尾裁剪 */
export function trimVideo(file: string, startSec: number, endSec: number): Promise<string> {
  const dir = path.dirname(file)
  const base = path.basename(file, path.extname(file))
  const out = path.join(dir, `${base}_trimmed.mp4`)
  return new Promise((resolve, reject) => {
    if (!FFMPEG) return reject(new Error('ffmpeg not available'))
    const dur = Math.max(0, endSec - startSec)
    const args = [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-ss', String(startSec),
      '-i', file,
      '-t', String(dur),
      '-c', 'copy',
      '-movflags', '+faststart',
      out
    ]
    const proc = spawn(FFMPEG, args, { windowsHide: true })
    let err = ''
    proc.stderr!.on('data', (d: Buffer) => (err += d.toString()))
    proc.on('error', reject)
    proc.on('exit', (code) => {
      if (code === 0 && fs.existsSync(out)) resolve(out)
      else reject(new Error(err.slice(-300) || `ffmpeg exit ${code}`))
    })
  })
}

export async function diskFree(dir: string): Promise<number> {
  try {
    const s = await fs.promises.statfs(dir)
    return s.bsize * s.bavail
  } catch {
    return 0
  }
}
