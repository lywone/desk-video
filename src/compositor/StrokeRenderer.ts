import type { Stroke } from '@shared/types'

/** 把归一化坐标 strokes 画到合成画布（与 overlay 视觉一致） */
export function drawStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  W: number,
  H: number
) {
  const scale = W / 1920
  for (const s of strokes) {
    ctx.save()
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = s.width * scale
    ctx.strokeStyle = s.color
    ctx.fillStyle = s.color
    ctx.globalAlpha = s.tool === 'highlighter' ? 0.45 : 1

    if (s.tool === 'pen' || s.tool === 'highlighter') {
      const pts = s.points ?? []
      if (pts.length === 1) {
        const p = pts[0]
        ctx.beginPath()
        ctx.arc(p.x * W, p.y * H, (s.width * scale) / 2, 0, Math.PI * 2)
        ctx.fill()
      } else if (pts.length > 1) {
        ctx.beginPath()
        ctx.moveTo(pts[0].x * W, pts[0].y * H)
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x * W, pts[i].y * H)
        ctx.stroke()
      }
    } else if (s.tool === 'arrow' && s.x0 != null && s.x1 != null) {
      drawArrow(ctx, s.x0 * W, s.y0! * H, s.x1 * W, s.y1! * H, s.width * scale)
    } else if (s.tool === 'rect' && s.x0 != null && s.x1 != null) {
      ctx.strokeRect(
        Math.min(s.x0, s.x1) * W,
        Math.min(s.y0!, s.y1!) * H,
        Math.abs(s.x1 - s.x0) * W,
        Math.abs(s.y1! - s.y0!) * H
      )
    } else if (s.tool === 'text' && s.text) {
      const fontSize = Math.max(18, s.width * 8 * scale)
      ctx.font = `600 ${fontSize}px "Segoe UI", "Microsoft YaHei", sans-serif`
      ctx.textBaseline = 'top'
      ctx.fillText(s.text, s.x0! * W, s.y0! * H)
    }
    ctx.restore()
  }
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width: number
) {
  const headLen = Math.max(12, width * 3.5)
  const angle = Math.atan2(y1 - y0, x1 - x0)
  ctx.beginPath()
  ctx.moveTo(x0, y0)
  ctx.lineTo(x1, y1)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x1 - headLen * Math.cos(angle - Math.PI / 7), y1 - headLen * Math.sin(angle - Math.PI / 7))
  ctx.lineTo(x1 - headLen * Math.cos(angle + Math.PI / 7), y1 - headLen * Math.sin(angle + Math.PI / 7))
  ctx.closePath()
  ctx.fill()
}

/** 命中测试（eraser 用）：归一化坐标距离阈值 */
export function hitStroke(strokes: Stroke[], nx: number, ny: number, W: number): Stroke | null {
  const threshold = 24 / W
  let best: Stroke | null = null
  let bestDist = Infinity
  for (const s of strokes) {
    const d = distToStroke(s, nx, ny)
    if (d < bestDist) {
      bestDist = d
      best = s
    }
  }
  return best && bestDist < threshold ? best : null
}

function distToStroke(s: Stroke, nx: number, ny: number): number {
  const candidates: Array<[number, number]> = []
  if (s.points) for (const p of s.points) candidates.push([p.x, p.y])
  if (s.x0 != null && s.y0 != null) {
    if (s.x1 != null && s.y1 != null && (s.tool === 'arrow' || s.tool === 'rect')) {
      // 线段采样
      for (let t = 0; t <= 20; t++) {
        const k = t / 20
        candidates.push([s.x0 + (s.x1 - s.x0) * k, s.y0 + (s.y1 - s.y0) * k])
      }
    } else {
      candidates.push([s.x0, s.y0])
    }
  }
  if (candidates.length === 0) return Infinity
  let min = Infinity
  for (const [cx, cy] of candidates) {
    const dx = cx - nx
    const dy = cy - ny
    min = Math.min(min, Math.sqrt(dx * dx + dy * dy))
  }
  return min
}
