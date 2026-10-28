<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { initState, initStrokes, state, strokes } from '@shared/renderer-store'
import { openScreenStream, resolveSourceId, normalizeCursor, drawCover, type ScreenStreamResult } from './ScreenSource'
import { CameraSource } from './CameraSource'
import { AudioMixer } from './AudioMixer'
import { drawStrokes } from './StrokeRenderer'
import { drawSpotlight } from './SpotlightRenderer'
import { SegmentRecorder } from './Recorder'

const canvasEl = ref<HTMLCanvasElement | null>(null)
let canvas: HTMLCanvasElement | null = null
let ctx: CanvasRenderingContext2D | null = null

let screenInfo: ScreenStreamResult | null = null
let micStream: MediaStream | null = null
const camera = new CameraSource()
let mixer: AudioMixer | null = null
const recorder = new SegmentRecorder()

let cursorGlobal: { x: number; y: number } | null = null
let renderTimer: number | null = null
let levelTimer: number | null = null
let recElapsedMs = 0
let lastFrameAt = 0
let preparePromise: Promise<void> | null = null

onMounted(async () => {
  canvas = canvasEl.value
  ctx = canvas!.getContext('2d', { alpha: false })!
  await initState()
  initStrokes()
  window.api.onCursor((pos) => {
    cursorGlobal = pos as { x: number; y: number }
  })
  window.api.onLoopbackData((buf) => {
    mixer?.feedPcm(buf as ArrayBuffer)
  })

  renderTimer = window.setInterval(() => renderLoop(), 33)
  levelTimer = window.setInterval(() => {
    if (mixer) window.api.sendAudioLevels(mixer.levels())
  }, 200)
})

onUnmounted(() => {
  if (renderTimer) clearInterval(renderTimer)
  if (levelTimer) clearInterval(levelTimer)
})

// ---------- 状态机 ----------
// 摄像头随时可开关：开启即尝试连接，失败立即上报（面板错误栏可见）
watch(
  () => state.cameraEnabled,
  async (on) => {
    if (on) {
      const ok = await camera.open()
      if (!ok) {
        window.api.recorderEvent({ type: 'error', message: camera.lastError })
      }
    } else {
      camera.close()
    }
  }
)

watch(
  () => state.status,
  async (now, prev) => {
    if (now === 'countdown' && prev !== 'countdown') {
      preparePromise = prepare()
    } else if (now === 'recording' && prev === 'countdown') {
      // 等流准备完成再开录（倒计时时间不够时顺延）
      await preparePromise
      await beginRecording()
    } else if (now === 'recording' && prev === 'paused') {
      recorder.resume()
    } else if (now === 'paused') {
      recorder.pause()
    } else if (now === 'stopping') {
      await stopAll()
    }
  }
)

async function prepare() {
  if (!canvas || !ctx) return
  try {
    // native = 跟随目标屏幕原始分辨率（取偶数尺寸，编码器要求）
    const RES_MAP = {
      '720p': { width: 1280, height: 720 },
      '1080p': { width: 1920, height: 1080 },
      '1440p': { width: 2560, height: 1440 },
      '2160p': { width: 3840, height: 2160 }
    } as const
    const res =
      state.resolution === 'native'
        ? state.targetBounds
          ? { width: state.targetBounds.width & ~1, height: state.targetBounds.height & ~1 }
          : { width: 1920, height: 1080 }
        : { ...RES_MAP[state.resolution] }
    canvas.width = res.width
    canvas.height = res.height
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    const sourceId = await resolveSourceId(state.sourceId)
    screenInfo = await openScreenStream(sourceId, res)

    mixer = new AudioMixer()
    await mixer.resume()
    if (state.systemEnabled) {
      if (screenInfo.hasSystemAudio) {
        mixer.addStream(screenInfo.stream, 'sys')
      } else {
        // ffmpeg loopback 兜底
        const r = await window.api.loopbackStart()
        if (r && r.ok) await mixer.enableLoopback()
        else {
          window.api.recorderEvent({
            type: 'error',
            message: `无法捕获系统声音: ${r?.error ?? '未找到 loopback 设备'}，仅录麦克风`
          })
        }
      }
    }
    if (state.micEnabled) {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1
          }
        })
        mixer.addStream(micStream, 'mic')
      } catch {
        window.api.recorderEvent({ type: 'error', message: '无法访问麦克风' })
      }
    }
    if (state.cameraEnabled) {
      const ok = await camera.open()
      if (!ok) {
        window.api.recorderEvent({
          type: 'error',
          message: `${camera.lastError}，本段视频将没有摄像头画面`
        })
      }
    }
    mixer.setVolumes(state.micEnabled ? state.micVolume : 0, state.systemEnabled ? state.systemVolume : 0)
  } catch (err) {
    window.api.recorderEvent({ type: 'error', message: `准备录制失败: ${String(err)}` })
  }
}

async function beginRecording() {
  recElapsedMs = 0
  lastFrameAt = performance.now()
  await startSegment()
}

async function startSegment() {
  if (!canvas) return
  await window.api.requestSegment()
  recorder.start(canvas, mixer ? mixer.audioTracks() : [], {
    videoBitsPerSecond: state.videoBitrateMbps * 1_000_000
  })
}

async function doSegment() {
  await recorder.stop()
  recorder.dispose()
  await startSegment()
}

async function stopAll() {
  try {
    await recorder.stop()
    recorder.dispose()
  } finally {
    window.api.loopbackStop()
    // 释放全部流，下次录制重新拉起
    screenInfo?.stream.getTracks().forEach((t) => t.stop())
    screenInfo = null
    micStream?.getTracks().forEach((t) => t.stop())
    micStream = null
    camera.close()
    if (mixer) {
      await mixer.close()
      mixer = null
    }
    window.api.recorderEvent({ type: 'stopped' })
  }
}

// ---------- 渲染循环 ----------
function renderLoop() {
  const now = performance.now()
  const dt = now - lastFrameAt
  lastFrameAt = now

  if (state.status === 'recording') {
    recElapsedMs += dt
    // 分段
    if (
      state.segmentMinutes > 0 &&
      recElapsedMs >= state.segmentMinutes * 60_000
    ) {
      recElapsedMs = 0
      void doSegment()
      return
    }
    draw()
    recorder.requestFrame()
  } else if (state.status === 'countdown') {
    // 预热绘制（不推帧）
    draw()
  }
}

function draw() {
  const W = canvas.width
  const H = canvas.height
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)

  if (screenInfo) {
    drawCover(ctx, screenInfo.video, W, H)
  }

  const cursorNorm = normalizeCursor(cursorGlobal ?? { x: -9999, y: -9999 }, state.targetBounds)
  if (state.spotlightOn) {
    drawSpotlight(ctx, cursorNorm, W, H)
  }

  drawStrokes(ctx, strokes as unknown as import('@shared/types').Stroke[], W, H)

  if (mixer) mixer.setVolumes(state.micEnabled ? state.micVolume : 0, state.systemEnabled ? state.systemVolume : 0)
  camera.draw(ctx, W, H, state.cameraCorner, state.cameraSize, state.cameraEnabled && state.cameraVisible)
}
</script>

<template>
  <div class="compositor">
    <canvas ref="canvasEl" width="640" height="360"></canvas>
    <p>合成窗口（不可见）— 请勿关闭</p>
  </div>
</template>

<style scoped>
.compositor {
  width: 100vw;
  height: 100vh;
  background: #000;
  color: #666;
  font-size: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
canvas {
  max-width: 90%;
  border: 1px solid #222;
}
</style>
