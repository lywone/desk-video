import { protocol } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm'
}

/**
 * rec://local/<encodeURIComponent(绝对路径)>
 * 承载本地录制媒体：dev 下预览页是 http://localhost 源，直接用 file:// 会被 Chromium 拦截。
 * 必须手动实现 Range/206 分段响应：<video> 的 seek 依赖 Range 支持，
 * 服务端不支持 Range 时 seek 会被拒绝或从头全量扫描（表现为点击起点/终点画面停在原地、不播放）。
 */
export function registerRecordedProtocol() {
  protocol.handle('rec', (request) => {
    try {
      const u = new URL(request.url)
      if (u.host !== 'local') return new Response('bad host', { status: 400 })
      const file = decodeURIComponent(u.pathname.replace(/^\/+/, ''))
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
        return new Response('not found', { status: 404 })
      }
      const mime = MIME[path.extname(file).toLowerCase()]
      if (!mime) return new Response('forbidden', { status: 403 })
      const size = fs.statSync(file).size
      const baseHeaders: Record<string, string> = {
        'Content-Type': mime,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache'
      }
      const range = request.headers.get('range')
      const m = range ? /bytes=(\d*)-(\d*)/.exec(range) : null
      if (m) {
        let start: number
        let end: number
        if (!m[1] && m[2]) {
          // bytes=-N → 末尾 N 字节
          start = Math.max(0, size - parseInt(m[2], 10))
          end = size - 1
        } else {
          start = m[1] ? parseInt(m[1], 10) : 0
          end = m[2] ? parseInt(m[2], 10) : size - 1
          if (!Number.isFinite(end) || end >= size) end = size - 1
        }
        if (start > end || start >= size) {
          return new Response(null, {
            status: 416,
            headers: { 'Content-Range': `bytes */${size}` }
          })
        }
        const part = Readable.toWeb(
          fs.createReadStream(file, { start, end })
        ) as unknown as ReadableStream
        return new Response(part, {
          status: 206,
          headers: {
            ...baseHeaders,
            'Content-Length': String(end - start + 1),
            'Content-Range': `bytes ${start}-${end}/${size}`
          }
        })
      }
      const whole = Readable.toWeb(fs.createReadStream(file)) as unknown as ReadableStream
      return new Response(whole, {
        status: 200,
        headers: { ...baseHeaders, 'Content-Length': String(size) }
      })
    } catch (err) {
      return new Response(String(err), { status: 500 })
    }
  })
}

/** 页面侧把绝对路径转成可加载的媒体 URL */
export function toRecUrl(file: string) {
  return `rec://local/${encodeURIComponent(file)}`
}
