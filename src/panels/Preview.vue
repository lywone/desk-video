<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

const file = ref('')
const duration = ref(0)
const startSec = ref(0)
const endSec = ref(0)
const trimming = ref(false)
const result = ref('')
const videoEl = ref<HTMLVideoElement | null>(null)

const fileUrl = computed(() => {
  if (!file.value) return ''
  // 本地媒体经特权协议 rec:// 承载（http 源页面加载 file:// 会被 Chromium 拦截）
  return `rec://local/${encodeURIComponent(file.value)}`
})

onMounted(() => {
  window.api.onPreviewFile((f) => {
    file.value = f as string
    result.value = ''
    duration.value = 0
    startSec.value = 0
    endSec.value = 0
  })
})

function onMeta() {
  const v = videoEl.value
  if (!v) return
  if (v.duration === Infinity) {
    // MediaRecorder 直录的 webm 不写时长（duration=Infinity、无可 seek 索引），
    // 此时赋值 currentTime 会被拒绝（点击起点/终点无效、画面停在 0）。
    // 先跳到极大位置促使 Chromium 解析出真实时长，再复位。
    resolveUnknownDuration(v)
    return
  }
  duration.value = v.duration
  startSec.value = 0
  endSec.value = v.duration
}

function seekableEnd(v: HTMLVideoElement): number {
  try {
    const s = v.seekable
    if (s && s.length > 0) return s.end(s.length - 1)
  } catch { /* ignore */ }
  return 0
}

function resolveUnknownDuration(v: HTMLVideoElement) {
  let done = false
  const finish = () => {
    if (done) return
    done = true
    v.removeEventListener('timeupdate', finish)
    const d = Number.isFinite(v.currentTime) && v.currentTime > 0.1 ? v.currentTime : seekableEnd(v)
    console.log('[preview] resolve duration:', d, '(raw currentTime =', v.currentTime, ')')
    if (d > 0) {
      duration.value = d
      startSec.value = 0
      endSec.value = d
    }
    v.currentTime = 0
  }
  v.addEventListener('timeupdate', finish, { once: true })
  // 兜底：个别 webm seek 不到末尾、不触发 timeupdate
  window.setTimeout(finish, 1000)
}

function fmt(s: number) {
  if (!Number.isFinite(s) || s < 0) return '--:--'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

/** 跳转到指定时间点并从该处播放预览 */
function previewFrom(sec: number) {
  const v = videoEl.value
  if (!v || !Number.isFinite(sec)) return
  const seekAndPlay = () => {
    // webm 直录文件 duration 可能为 Infinity，用可 seek 范围末端兜底
    const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : seekableEnd(v)
    const maxT = dur > 0.05 ? dur - 0.05 : sec
    const target = Math.min(Math.max(sec, 0), maxT)
    console.log('[preview] seek+play:', target, 'readyState =', v.readyState, 'duration =', v.duration)
    v.currentTime = target
    v.play()?.catch((err: unknown) => {
      // 不再静默吞掉：至少在界面上提示失败原因
      console.warn('[preview] play() 失败', err)
      result.value = `自动播放失败：${(err as DOMException)?.message ?? String(err)}`
    })
  }
  if (v.readyState >= 1) seekAndPlay()
  else v.addEventListener('loadedmetadata', seekAndPlay, { once: true })
}

/** 点击/拖动起点滑块：从起点位置开始播放预览 */
function onStartInput() {
  previewFrom(startSec.value)
}

/** 点击/拖动终点滑块：从切点前一帧开始播放（终点帧本身不包含在裁剪结果里） */
function onEndInput() {
  previewFrom(Math.max(0, endSec.value - 0.05))
}

async function doTrim() {
  trimming.value = true
  result.value = ''
  try {
    const r = await window.api.trim({ file: file.value, startSec: startSec.value, endSec: endSec.value })
    const res = r as { ok: boolean; file?: string; error?: string }
    result.value = res.ok ? `已生成：${res.file}` : `失败：${res.error}`
  } finally {
    trimming.value = false
  }
}

function openFolder() {
  window.api.openOutputDir()
}
</script>

<template>
  <div class="preview">
    <header>
      <span class="title">预览与裁剪</span>
      <span class="file" :title="file">{{ file.split('\\').pop() }}</span>
    </header>

    <div class="video-wrap">
      <video ref="videoEl" :src="fileUrl" controls preload="auto" @loadedmetadata="onMeta" v-if="file"></video>
      <div v-else class="empty">等待录制完成…</div>
    </div>

    <div class="trim" v-if="file && duration > 0">
      <div class="slider-row">
        <button class="time-btn" title="点击从此处播放预览" @click="onStartInput">起点 {{ fmt(startSec) }}</button>
        <input type="range" min="0" :max="duration" step="0.1" v-model.number="startSec" @input="onStartInput" />
      </div>
      <div class="slider-row">
        <button class="time-btn" title="点击从此处播放预览" @click="onEndInput">终点 {{ fmt(endSec) }}</button>
        <input type="range" min="0" :max="duration" step="0.1" v-model.number="endSec" @input="onEndInput" />
      </div>
      <div class="actions">
        <span>裁剪区间：{{ fmt(Math.max(0, endSec - startSec)) }}</span>
        <button class="blue" :disabled="trimming || endSec <= startSec" @click="doTrim">
          {{ trimming ? '处理中…' : '✂ 裁剪并另存' }}
        </button>
        <button @click="openFolder">打开文件夹</button>
      </div>
      <p class="result" v-if="result">{{ result }}</p>
    </div>
  </div>
</template>

<style scoped>
.preview {
  height: 100vh;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
}
header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.title {
  font-weight: 700;
}
.file {
  color: var(--text-dim);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 60%;
}
.video-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #000;
  border-radius: 10px;
  overflow: hidden;
}
video {
  max-width: 100%;
  max-height: 100%;
}
.empty {
  color: #666;
}
.trim {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.slider-row {
  display: grid;
  grid-template-columns: 100px 1fr;
  align-items: center;
  gap: 12px;
}
.slider-row button.time-btn {
  font-size: 12px;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
  background: transparent;
  border: none;
  padding: 4px 6px;
  cursor: pointer;
  text-align: left;
  border-radius: 6px;
}
.slider-row button.time-btn:hover {
  color: var(--text, #fff);
  background: rgba(255, 255, 255, 0.08);
}
.actions {
  display: flex;
  gap: 10px;
  align-items: center;
  font-size: 13px;
}
.result {
  font-size: 12px;
  color: var(--green);
}
</style>
