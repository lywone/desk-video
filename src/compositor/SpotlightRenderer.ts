/** 聚光灯：半透明压暗 + 光标圆形亮区（合成端与 overlay 同样式） */
export function drawSpotlight(
  ctx: CanvasRenderingContext2D,
  cursorNorm: { x: number; y: number } | null,
  W: number,
  H: number
) {
  ctx.save()
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'
  ctx.fillRect(0, 0, W, H)
  if (cursorNorm) {
    const radius = W * (180 / 1920)
    ctx.globalCompositeOperation = 'destination-out'
    ctx.beginPath()
    ctx.arc(cursorNorm.x * W, cursorNorm.y * H, radius, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}
