<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { state } from '@shared/renderer-store'

const cv = ref<HTMLCanvasElement | null>(null)
let ctx: CanvasRenderingContext2D | null = null
let raf = 0
let cursorGlobal: { x: number; y: number } | null = null

onMounted(() => {
  ctx = cv.value!.getContext('2d')!
  window.api.onCursor((pos) => {
    cursorGlobal = pos as { x: number; y: number }
  })
  raf = requestAnimationFrame(render)
})

onUnmounted(() => cancelAnimationFrame(raf))

function render() {
  if (ctx) {
    const dpr = window.devicePixelRatio || 1
    const W = window.innerWidth
    const H = window.innerHeight
    if (ctx.canvas.width !== W * dpr || ctx.canvas.height !== H * dpr) {
      ctx.canvas.width = W * dpr
      ctx.canvas.height = H * dpr
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)

    // 全局坐标 → 归一化（相对 overlay 覆盖的目标屏）
    const b = state.targetBounds
    let nx = -1
    let ny = -1
    if (b && cursorGlobal) {
      nx = (cursorGlobal.x - b.x) / b.width
      ny = (cursorGlobal.y - b.y) / b.height
    }

    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'
    ctx.fillRect(0, 0, W, H)
    if (nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1) {
      ctx.save()
      ctx.globalCompositeOperation = 'destination-out'
      const radius = W * (180 / 1920)
      ctx.beginPath()
      ctx.arc(nx * W, ny * H, radius, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
      // 亮区描边
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(nx * W, ny * H, radius, 0, Math.PI * 2)
      ctx.stroke()
    }
  }
  raf = requestAnimationFrame(render)
}
</script>

<template>
  <canvas ref="cv" class="spotlight"></canvas>
</template>

<style scoped>
.spotlight {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  pointer-events: none;
}
</style>
