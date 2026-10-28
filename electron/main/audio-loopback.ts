import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process'
import { BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc-channels'

/**
 * ffmpeg WASAPI loopback 兜底：
 * 主路径是 getUserMedia 桌面音频（Chromium 原生），
 * 仅当其不可用时启用本模块，把 PCM 通过 IPC 发给 compositor 的 AudioWorklet 混入。
 */

import { ffmpegPath } from './ffmpeg-path'

const FFMPEG = ffmpegPath()!

export class LoopbackCapture {
  private proc: ChildProcessWithoutNullStreams | null = null
  private win: BrowserWindow | null = null

  async start(win: BrowserWindow): Promise<{ ok: boolean; error?: string }> {
    if (this.proc) return { ok: true }
    if (!FFMPEG) return { ok: false, error: 'ffmpeg not found' }
    this.win = win

    // 探测支持 wasapi 的设备列表（输出设备会以 loopback 形式出现）
    const devices = await listWasapiDevices()
    const target = devices.find((d) => /loopback/i.test(d.name)) ?? devices[0]
    if (!target) {
      return { ok: false, error: '未找到可用的 WASAPI 录音设备，请安装虚拟声卡（如 VB-Cable）' }
    }

    const args = [
      '-hide_banner', '-loglevel', 'error',
      '-f', 'wasapi',
      '-i', target.name,
      '-f', 's16le',
      '-ar', '48000',
      '-ac', '2',
      'pipe:1'
    ]
    try {
      this.proc = spawn(FFMPEG, args, { windowsHide: true })
    } catch (err) {
      return { ok: false, error: `ffmpeg 启动失败: ${String(err)}` }
    }
    this.proc.stdout!.on('data', (buf: Buffer) => {
      if (!this.win?.isDestroyed()) this.win?.webContents.send(IPC.LoopbackData, buf)
    })
    this.proc.stderr!.on('data', (d: Buffer) => console.error('[loopback]', d.toString()))
    this.proc.on('exit', () => {
      this.proc = null
    })
    return { ok: true }
  }

  stop() {
    this.proc?.stdin?.end()
    this.proc?.kill()
    this.proc = null
    this.win = null
  }
}

interface WasapiDevice {
  name: string
}

function listWasapiDevices(): Promise<WasapiDevice[]> {
  return new Promise((resolve) => {
    if (!FFMPEG) return resolve([])
    const proc = spawn(FFMPEG, ['-hide_banner', '-list_devices', 'true', '-f', 'wasapi', '-i', ''], {
      windowsHide: true
    })
    let out = ''
    const collect = (d: Buffer) => (out += d.toString())
    proc.stderr!.on('data', collect)
    proc.on('error', () => resolve([]))
    proc.on('exit', () => {
      const devices: WasapiDevice[] = []
      for (const line of out.split(/\r?\n/)) {
        const m = line.match(/"([^"]+)"/)
        if (m && line.toLowerCase().includes('wasapi')) devices.push({ name: m[1] })
      }
      // 匹配不到结构化行时，退化为所有含引号的行
      if (devices.length === 0) {
        for (const line of out.split(/\r?\n/)) {
          const m = line.match(/"(.+)"/)
          if (m) devices.push({ name: m[1] })
        }
      }
      resolve(devices)
    })
    setTimeout(() => {
      try {
        proc.kill()
      } catch {
        /* noop */
      }
    }, 4000)
  })
}
