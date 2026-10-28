import path from 'node:path'

let cached: string | null | undefined

/**
 * ffmpeg 可执行文件路径。
 * 打包后 ffmpeg-static 被 asarUnpack 到 app.asar.unpacked，但 require('ffmpeg-static')
 * 返回的路径仍指向 app.asar 内（child_process.spawn 不会做 asar 重映射），需手动替换。
 */
export function ffmpegPath(): string | null {
  if (cached !== undefined) return cached
  let p: string | null = null
  try {
    p = require('ffmpeg-static') as string | null
  } catch {
    p = null
  }
  if (p && p.includes('app.asar') && !p.includes('app.asar.unpacked')) {
    p = path.resolve(p.replace('app.asar', 'app.asar.unpacked'))
  }
  cached = p
  return p
}
