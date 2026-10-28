<script setup lang="ts">
import { ref } from 'vue'
import { state, patchState, setTool } from '@shared/renderer-store'
import type { ToolId } from '@shared/types'

const COLORS = ['#ff3b30', '#f7d038', '#3fb96f', '#4da3ff', '#ffffff']
const WIDTHS = [3, 6, 12]

const TOOLS: Array<{ id: ToolId; icon: string; title: string }> = [
  { id: 'select', icon: '🖱', title: '鼠标（不标注）' },
  { id: 'pen', icon: '✏️', title: '画笔' },
  { id: 'highlighter', icon: '🖍', title: '荧光笔' },
  { id: 'arrow', icon: '➡️', title: '箭头' },
  { id: 'rect', icon: '▭', title: '矩形' },
  { id: 'text', icon: '🅣', title: '文字' },
  { id: 'eraser', icon: '🧽', title: '橡皮' }
]

const dragging = ref(false)
const bar = ref<HTMLElement | null>(null)
const api = window.api

function onDragStart(e: MouseEvent) {
  if (e.button !== 0) return
  dragging.value = true
  const startX = e.clientX
  const startY = e.clientY
  const el = bar.value!
  const originX = el.getBoundingClientRect().left
  const originY = el.getBoundingClientRect().top
  const move = (ev: MouseEvent) => {
    el.style.left = `${originX + ev.clientX - startX}px`
    el.style.top = `${originY + ev.clientY - startY}px`
    el.style.transform = 'none'
  }
  const up = () => {
    dragging.value = false
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', up)
  }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
}
</script>

<template>
  <div class="toolbar" ref="bar" @mousedown.stop>
    <div class="grip" @mousedown="onDragStart">⠿</div>

    <button
      v-for="t in TOOLS"
      :key="t.id"
      class="tool"
      :class="{ active: state.tool === t.id }"
      :title="t.title"
      @click="setTool(t.id)"
    >
      {{ t.icon }}
    </button>

    <span class="sep"></span>

    <button
      v-for="c in COLORS"
      :key="c"
      class="color"
      :class="{ active: state.toolColor === c }"
      :style="{ background: c }"
      title="颜色"
      @click="patchState({ toolColor: c })"
    ></button>

    <span class="sep"></span>

    <button
      v-for="(w, i) in WIDTHS"
      :key="w"
      class="width"
      :class="{ active: state.toolWidth === w }"
      title="粗细"
      @click="patchState({ toolWidth: w })"
    >
      <span :style="{ width: 4 + i * 5 + 'px', height: 4 + i * 5 + 'px' }"></span>
    </button>

    <span class="sep"></span>

    <button class="tool" :class="{ active: state.spotlightOn }" title="聚光灯" @click="patchState({ spotlightOn: !state.spotlightOn })">🔦</button>
    <button class="tool" title="撤销" @click="api.undoStroke()">↩️</button>
    <button class="tool" title="清屏" @click="api.clearStrokes()">🗑</button>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  background: rgba(16, 20, 24, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  padding: 6px 10px;
  box-shadow: 0 6px 30px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(10px);
}
.grip {
  cursor: grab;
  color: #77828e;
  padding: 0 6px;
  font-size: 14px;
  user-select: none;
}
.tool {
  width: 34px;
  height: 34px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  border-radius: 8px;
  background: transparent;
  border-color: transparent;
}
.tool:hover {
  background: rgba(255, 255, 255, 0.08);
}
.tool.active {
  background: rgba(77, 163, 255, 0.25);
  border-color: rgba(77, 163, 255, 0.6);
}
.color {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  padding: 0;
  border: 2px solid rgba(255, 255, 255, 0.25);
}
.color.active {
  border-color: #fff;
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.35);
}
.width {
  width: 26px;
  height: 26px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border-color: transparent;
}
.width span {
  display: block;
  border-radius: 50%;
  background: #dfe6ee;
}
.width.active {
  background: rgba(77, 163, 255, 0.25);
}
.sep {
  width: 1px;
  height: 22px;
  background: rgba(255, 255, 255, 0.14);
  margin: 0 4px;
}
</style>
