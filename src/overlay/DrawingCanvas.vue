<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref } from 'vue'
import { state, strokes } from '@shared/renderer-store'
import { drawStrokes, hitStroke } from '../compositor/StrokeRenderer'
import type { Stroke, StrokePoint } from '@shared/types'

const cv = ref<HTMLCanvasElement | null>(null)
let ctx: CanvasRenderingContext2D | null = null
let raf = 0

/** 本地绘制中的 stroke（未提交，不进 IPC 广播） */
const pending = ref<Stroke | null>(null)
const textBox = reactive({ show: false, x: 0, y: 0, value: '' })
const textPos = ref<StrokePoint>({ x: 0, y: 0 })
let drawStart: StrokePoint | null = null

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function norm(e: PointerEvent): StrokePoint {
  const w = window.innerWidth
  const h = window.innerHeight
  return { x: e.clientX / w, y: e.clientY / h }
}

function newStroke(): Stroke {
  return {
    id: uid(),
    tool: state.tool,
    color: state.toolColor,
    width: state.toolWidth,
    createdAt: Date.now()
  }
}

function onDown(e: PointerEvent) {
  if (e.button !== 0) return
  const p = norm(e)
  if (state.tool === 'eraser') {
    const hit = hitStroke(strokes as Stroke[], p.x, p.y, window.innerWidth)
    if (hit) window.api.removeStroke(hit.id)
    return
  }
  if (state.tool === 'text') {
    textBox.show = true
    textBox.x = e.clientX
    textBox.y = e.clientY
    textBox.value = ''
    textPos.value = p
    return
  }
  drawStart = p
  const s = newStroke()
  if (state.tool === 'pen' || state.tool === 'highlighter') s.points = [p]
  else {
    s.x0 = p.x
    s.y0 = p.y
    s.x1 = p.x
    s.y1 = p.y
  }
  pending.value = s
  cv.value?.setPointerCapture(e.pointerId)
}

function onMove(e: PointerEvent) {
  if (!pending.value || !drawStart) return
  const p = norm(e)
  const s = pending.value
  if (s.tool === 'pen' || s.tool === 'highlighter') {
    s.points!.push(p)
  } else {
    s.x1 = p.x
    s.y1 = p.y
  }
}

function onUp() {
  if (!pending.value) return
  window.api.addStroke(JSON.parse(JSON.stringify(pending.value)))
  pending.value = null
  drawStart = null
}

function commitText() {
  const text = textBox.value.trim()
  textBox.show = false
  if (text) {
    const s = newStroke()
    s.x0 = textPos.value.x
    s.y0 = textPos.value.y
    s.text = text
    window.api.addStroke(s)
  }
}

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
    drawStrokes(ctx, strokes as Stroke[], W, H)
    if (pending.value) drawStrokes(ctx, [pending.value], W, H)
  }
  raf = requestAnimationFrame(render)
}

onMounted(() => {
  ctx = cv.value!.getContext('2d')!
  raf = requestAnimationFrame(render)
})

onUnmounted(() => cancelAnimationFrame(raf))
</script>

<template>
  <canvas
    ref="cv"
    class="draw-canvas"
    @pointerdown="onDown"
    @pointermove="onMove"
    @pointerup="onUp"
    @pointercancel="onUp"
  ></canvas>
  <div
    v-if="textBox.show"
    class="text-box"
    :style="{ left: textBox.x + 'px', top: textBox.y + 'px' }"
  >
    <input
      v-model="textBox.value"
      autofocus
      placeholder="输入文字，回车确认"
      @keydown.enter.prevent="commitText"
      @keydown.esc="textBox.show = false"
    />
  </div>
</template>

<style scoped>
.draw-canvas {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  pointer-events: auto;
  cursor: crosshair;
}
.text-box {
  position: fixed;
  z-index: 10;
}
.text-box input {
  background: rgba(16, 20, 24, 0.95);
  border: 1px solid rgba(77, 163, 255, 0.8);
  color: #fff;
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 14px;
  width: 220px;
}
</style>
