<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { initState, initStrokes, state } from '@shared/renderer-store'
import Toolbar from './Toolbar.vue'
import DrawingCanvas from './DrawingCanvas.vue'
import SpotlightMask from './SpotlightMask.vue'

const countdownShown = computed(() => state.status === 'countdown' && state.countdownLeft > 0)

const hovered = ref(false)

/** 穿透控制：非 select 工具时整体接收鼠标；toolbar hover 时也接收 */
const interactive = computed(() => state.tool !== 'select' || hovered.value)

watch(
  interactive,
  (v) => {
    window.api.setIgnoreMouse(!v)
  },
  { immediate: true }
)

onMounted(async () => {
  await initState()
  initStrokes()
})
</script>

<template>
  <div class="overlay">
    <DrawingCanvas v-if="state.tool !== 'select'" />
    <SpotlightMask v-if="state.spotlightOn" />
    <div v-if="countdownShown" class="countdown">{{ state.countdownLeft }}</div>
    <div class="toolbar-wrap" @mouseenter="hovered = true" @mouseleave="hovered = false">
      <Toolbar />
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  pointer-events: none;
}
.toolbar-wrap {
  position: fixed;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  pointer-events: auto;
}
.countdown {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 180px;
  font-weight: 800;
  color: rgba(255, 255, 255, 0.92);
  text-shadow: 0 4px 40px rgba(0, 0, 0, 0.6);
  pointer-events: none;
  font-variant-numeric: tabular-nums;
}
</style>
