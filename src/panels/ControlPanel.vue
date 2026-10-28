<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { initState, state, fmtDuration, fmtSize, patchState } from '@shared/renderer-store'
import SourcePicker from './SourcePicker.vue'
import SettingsDialog from './SettingsDialog.vue'
import type { RecorderTick } from '@shared/types'

const elapsedMs = ref(0)
const totalBytes = ref(0)
const diskFree = ref(0)
const segments = ref(0)
const micLevel = ref(0)
const sysLevel = ref(0)

onMounted(async () => {
  await initState()
  window.api.onRecorderTick((t) => {
    const tick = t as RecorderTick
    elapsedMs.value = tick.elapsedMs
    totalBytes.value = tick.totalBytes
    diskFree.value = tick.diskFree
    segments.value = tick.segments
  })
  window.api.onAudioLevels((l) => {
    micLevel.value = l.mic
    sysLevel.value = l.system
  })
})

const statusText = computed(() => {
  const map: Record<string, string> = {
    idle: '待机',
    countdown: '倒计时',
    recording: '录制中',
    paused: '已暂停',
    stopping: '正在收尾'
  }
  return map[state.status] ?? state.status
})

const statusClass = computed(() => state.status)

const recording = computed(() => state.status === 'recording' || state.status === 'paused' || state.status === 'countdown' || state.status === 'stopping')

function onStart() {
  window.api.start()
}
function onPauseResume() {
  if (state.status === 'recording') window.api.pause()
  else if (state.status === 'paused') window.api.resume()
}
function onStop() {
  window.api.stop()
}

const showPicker = ref(false)
const showSettings = ref(false)
const api = window.api

async function pickDir() {
  await window.api.pickDirectory()
}
</script>

<template>
  <div class="panel">
    <header>
      <div class="logo">
        <span class="dot"></span>
        <span>Desk-Video</span>
      </div>
      <div class="status-badge" :class="statusClass">
        <span class="pulse" v-if="state.status === 'recording'"></span>
        {{ statusText }}
        <span v-if="state.status === 'countdown'"> {{ state.countdownLeft }}s</span>
      </div>
    </header>

    <div v-if="state.error" class="error-bar">{{ state.error }}</div>

    <!-- 状态卡 -->
    <section class="card stats">
      <div class="stat">
        <label>时长</label>
        <b>{{ fmtDuration(elapsedMs) }}</b>
      </div>
      <div class="stat">
        <label>已录制</label>
        <b>{{ fmtSize(totalBytes) }}</b>
      </div>
      <div class="stat">
        <label>分段</label>
        <b>{{ segments }}</b>
      </div>
      <div class="stat">
        <label>磁盘剩余</label>
        <b>{{ fmtSize(diskFree) }}</b>
      </div>
    </section>

    <!-- 录制源 -->
    <section class="card">
      <div class="card-head">
        <span>录制源</span>
        <button :disabled="recording" @click="showPicker = true">更换…</button>
      </div>
      <div class="source-line">
        <span class="source-name">{{ state.sourceName || '未选择（默认主屏）' }}</span>
        <span class="source-type">{{ state.sourceType === 'window' ? '窗口' : state.sourceType === 'screen' ? '屏幕' : '' }}</span>
      </div>
    </section>

    <!-- 音频 -->
    <section class="card">
      <div class="card-head"><span>音频</span></div>
      <div class="audio-row">
        <label class="switch">
          <input type="checkbox" :checked="state.micEnabled" @change="patchState({ micEnabled: ($event.target as HTMLInputElement).checked })" :disabled="recording" />
          麦克风
        </label>
        <input type="range" min="0" max="1" step="0.05" :value="state.micVolume" @input="patchState({ micVolume: Number(($event.target as HTMLInputElement).value) })" />
        <div class="level"><div class="level-bar" :style="{ width: (micLevel * 100) + '%' }"></div></div>
      </div>
      <div class="audio-row">
        <label class="switch">
          <input type="checkbox" :checked="state.systemEnabled" @change="patchState({ systemEnabled: ($event.target as HTMLInputElement).checked })" :disabled="recording" />
          系统声音
        </label>
        <input type="range" min="0" max="1" step="0.05" :value="state.systemVolume" @input="patchState({ systemVolume: Number(($event.target as HTMLInputElement).value) })" />
        <div class="level"><div class="level-bar blue" :style="{ width: (sysLevel * 100) + '%' }"></div></div>
      </div>
      <p class="hint" v-if="!state.systemEnabled">系统声音关闭后将只录麦克风</p>
    </section>

    <!-- 摄像头 -->
    <section class="card">
      <div class="card-head">
        <span>摄像头</span>
        <label class="switch">
          <input
            type="checkbox"
            :checked="state.cameraEnabled"
            @change="patchState({ cameraEnabled: ($event.target as HTMLInputElement).checked })"
          />
          画中画
        </label>
      </div>
      <div class="audio-row" v-if="state.cameraEnabled">
        <button @click="patchState({ cameraVisible: !state.cameraVisible })">
          {{ state.cameraVisible ? '隐藏画面 (F8)' : '显示画面 (F8)' }}
        </button>
        <span class="camera-ok">✓ 摄像头已连接，开始录制后出现在画面{{ state.cameraCorner === 'br' ? '右下' : state.cameraCorner === 'bl' ? '左下' : state.cameraCorner === 'tr' ? '右上' : '左上' }}角</span>
      </div>
      <p class="hint" v-if="!state.cameraEnabled">开启后立即连接摄像头，失败原因会显示在顶部错误栏；位置大小在「输出 → 设置…」里调</p>
    </section>

    <!-- 控制 -->
    <section class="controls">
      <button class="primary big" :disabled="state.status !== 'idle'" @click="onStart">● 开始录制</button>
      <button class="big" :disabled="!recording" @click="onPauseResume">{{ state.status === 'paused' ? '▶ 继续' : '⏸ 暂停' }}</button>
      <button class="big danger" :disabled="!(state.status === 'recording' || state.status === 'paused')" @click="onStop">■ 停止</button>
    </section>
    <p class="hotkeys">热键：F9 开始/暂停 · F10 停止 · F8 摄像头显隐</p>

    <!-- 输出 -->
    <section class="card">
      <div class="card-head">
        <span>输出</span>
        <button @click="showSettings = true">设置…</button>
      </div>
      <div class="dir-line">
        <span class="dir" :title="state.outputDir">{{ state.outputDir }}</span>
        <button @click="api.openOutputDir()">打开</button>
      </div>
      <div class="last-files" v-if="state.lastOutputFiles.length">
        <div class="card-head"><span>最近输出</span></div>
        <div v-for="f in state.lastOutputFiles" :key="f" class="file-line">{{ f }}</div>
      </div>
    </section>

    <SourcePicker v-if="showPicker" @close="showPicker = false" />
    <SettingsDialog v-if="showSettings" @close="showSettings = false" />
  </div>
</template>

<style scoped>
.panel {
  height: 100vh;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  overflow-y: auto;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.logo {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
  font-size: 16px;
}
.logo .dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--accent);
  display: inline-block;
}
.status-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: 999px;
  background: var(--bg3);
  border: 1px solid var(--border);
  font-size: 12px;
}
.status-badge.recording {
  color: #ff8080;
  border-color: #5c2525;
}
.pulse {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
  animation: pulse 1s infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
.error-bar {
  background: #3a1d1f;
  border: 1px solid #6b272a;
  color: #ffb4b5;
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 13px;
}
.camera-ok {
  color: var(--text-dim);
  font-size: 12px;
}
.card {
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.card-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
  color: var(--text-dim);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.stats {
  flex-direction: row;
  justify-content: space-between;
}
.stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.stat label {
  font-size: 11px;
  color: var(--text-dim);
}
.stat b {
  font-size: 15px;
  font-variant-numeric: tabular-nums;
}
.source-line {
  display: flex;
  gap: 8px;
  align-items: center;
}
.source-name {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.source-type {
  color: var(--text-dim);
  font-size: 12px;
}
.audio-row {
  display: grid;
  grid-template-columns: 86px 1fr 90px;
  gap: 10px;
  align-items: center;
}
.switch {
  display: flex;
  gap: 6px;
  align-items: center;
  font-size: 13px;
}
.level {
  height: 8px;
  background: var(--bg);
  border-radius: 4px;
  overflow: hidden;
  border: 1px solid var(--border);
}
.level-bar {
  height: 100%;
  background: var(--green);
  transition: width 0.12s;
}
.level-bar.blue {
  background: var(--accent2);
}
.hint {
  font-size: 12px;
  color: var(--text-dim);
}
.controls {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr;
  gap: 10px;
}
.big {
  padding: 14px;
  font-size: 15px;
}
.danger {
  border-color: #5c2525;
}
.hotkeys {
  text-align: center;
  color: var(--text-dim);
  font-size: 12px;
}
.dir-line {
  display: flex;
  gap: 8px;
  align-items: center;
}
.dir {
  flex: 1;
  font-size: 12px;
  color: var(--text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.last-files .file-line {
  font-size: 12px;
  color: var(--text-dim);
  padding: 2px 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
