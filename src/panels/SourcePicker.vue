<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { SourceInfo } from '@shared/types'

const emit = defineEmits<{ (e: 'close'): void }>()

const sources = ref<SourceInfo[]>([])
const loading = ref(true)
const tab = ref<'screen' | 'window'>('screen')

onMounted(async () => {
  sources.value = await window.api.listSources()
  loading.value = false
})

function pick(s: SourceInfo) {
  window.api.selectSource(s)
  emit('close')
}

const filtered = () => sources.value.filter((s) => s.type === tab.value)
</script>

<template>
  <div class="mask" @click.self="emit('close')">
    <div class="dialog">
      <div class="head">
        <span>选择录制源</span>
        <button class="x" @click="emit('close')">✕</button>
      </div>
      <div class="tabs">
        <button :class="{ active: tab === 'screen' }" @click="tab = 'screen'">屏幕</button>
        <button :class="{ active: tab === 'window' }" @click="tab = 'window'">窗口</button>
      </div>
      <div class="grid" v-if="!loading">
        <div v-for="s in filtered()" :key="s.id" class="item" @click="pick(s)">
          <img v-if="s.thumbnailDataUrl" :src="s.thumbnailDataUrl" />
          <div class="name" :title="s.name">{{ s.name }}</div>
        </div>
        <div v-if="filtered().length === 0" class="empty">没有可用的{{ tab === 'screen' ? '屏幕' : '窗口' }}</div>
      </div>
      <div v-else class="empty">加载中…</div>
    </div>
  </div>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.dialog {
  width: 720px;
  max-width: 92vw;
  max-height: 80vh;
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 700;
}
.x {
  padding: 2px 10px;
}
.tabs {
  display: flex;
  gap: 8px;
}
.tabs button.active {
  background: var(--accent2);
  border-color: var(--accent2);
  color: #fff;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 10px;
  overflow-y: auto;
  padding: 4px;
}
.item {
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  background: var(--bg3);
  transition: border-color 0.15s;
}
.item:hover {
  border-color: var(--accent2);
}
.item img {
  width: 100%;
  display: block;
  background: #000;
  min-height: 60px;
}
.name {
  padding: 6px 8px;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.empty {
  color: var(--text-dim);
  text-align: center;
  padding: 30px 0;
}
</style>
