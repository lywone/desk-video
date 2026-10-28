import { desktopCapturer, dialog, screen, shell, BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { getStore } from './store'
import { broadcastToAll } from './ipc-helpers'
import { RecorderSession, diskFree, trimVideo } from './recorder-session'
import { hideControlPanel, showControlPanel } from './windows/control-panel'
import { fitOverlayToDisplay, getOverlay } from './windows/overlay'
import { openPreview } from './windows/preview'
import { IPC } from '@shared/ipc-channels'
import type { RecorderTick } from '@shared/types'

export const session = new RecorderSession()
let countdownTimer: NodeJS.Timeout | null = null
let tickTimer: NodeJS.Timeout | null = null

// 写盘致命错误 → 走统一错误处理（回 idle、显示错误、尝试收尾）
session.onFatal = (msg) => handleRecorderError(msg)

/** 未手动选源时自动选主屏（与面板"未选择（默认主屏）"提示一致） */
async function autoSelectPrimaryScreen(): Promise<boolean> {
  const sources = await desktopCapturer.getSources({ types: ['screen'] })
  const s = sources[0]
  if (!s) return false
  const store = getStore()
  store.sourceId = s.id
  store.sourceType = 'screen'
  store.sourceName = s.name || '屏幕'
  store.sourceDisplayId = s.display_id || null
  const disp =
    screen.getAllDisplays().find((d) => String(d.id) === String(s.display_id)) ??
    screen.getPrimaryDisplay()
  store.targetBounds = disp.bounds
  fitOverlayToDisplay(undefined, s.display_id || null)
  store.patch({ sourceId: s.id, sourceType: 'screen', sourceName: store.sourceName })
  return true
}

export async function handleRecorderStart() {
  const store = getStore()
  console.log('[recorder] start requested, status =', store.status)
  if (store.status !== 'idle') return
  if (!store.sourceId) {
    const ok = await autoSelectPrimaryScreen()
    console.log('[recorder] autoSelect done, ok =', ok)
    if (!ok) {
      store.error = '未找到可用的屏幕源，无法开始录制'
      store.patch({ error: store.error })
      showControlPanel()
      return
    }
  }
  store.error = null
  store.lastOutputFiles = []
  // 预检输出目录可写：沙箱终端/权限问题在此早暴露，避免录制中写盘失败导致状态卡死
  try {
    const probe = path.join(store.settings.outputDir, `.write-test-${Date.now()}`)
    fs.writeFileSync(probe, '')
    fs.unlinkSync(probe)
  } catch {
    const msg =
      `输出目录不可写: ${store.settings.outputDir}。` +
      '若从 IDE 内置终端启动，可能被沙箱限制——请改用系统终端运行 npm run dev，或在「设置…」中把输出目录改到其他位置'
    store.error = msg
    store.patch({ error: msg })
    showControlPanel()
    return
  }
  try {
    await session.start()
    console.log('[recorder] session.start ok')
  } catch (err) {
    const msg = `录制启动失败: ${String(err)}`
    store.status = 'idle'
    store.error = msg
    store.patch({ status: 'idle', error: msg })
    showControlPanel()
    return
  }
  // 倒计时
  const total = Math.max(0, store.settings.countdownSeconds)
  store.status = 'countdown'
  store.countdownLeft = total
  store.patch({ status: 'countdown', countdownLeft: total, error: null })
  let left = total
  countdownTimer = setInterval(() => {
    left -= 1
    store.countdownLeft = left
    if (left <= 0) {
      if (countdownTimer) clearInterval(countdownTimer)
      countdownTimer = null
      store.status = 'recording'
      console.log('[recorder] countdown finished -> recording')
      store.patch({ status: 'recording', countdownLeft: 0 })
      startTick()
      if (store.settings.minimizePanelWhileRecording) hideControlPanel()
    } else {
      store.patch({ countdownLeft: left })
    }
  }, 1000)
}

function startTick() {
  stopTick()
  const store = getStore()
  tickTimer = setInterval(async () => {
    const tick: RecorderTick = session.tick()
    tick.diskFree = await diskFree(store.settings.outputDir)
    broadcastToAll('recorder:tick', tick)
  }, 500)
}

function stopTick() {
  if (tickTimer) clearInterval(tickTimer)
  tickTimer = null
}

export function handleRecorderPause() {
  const store = getStore()
  if (store.status !== 'recording') return
  session.pause()
  store.status = 'paused'
  store.patch({ status: 'paused' })
}

export function handleRecorderResume() {
  const store = getStore()
  if (store.status !== 'paused') return
  session.resume()
  store.status = 'recording'
  store.patch({ status: 'recording' })
}

export async function handleRecorderStop() {
  const store = getStore()
  if (store.status !== 'recording' && store.status !== 'paused') return
  if (countdownTimer) {
    clearInterval(countdownTimer)
    countdownTimer = null
  }
  store.status = 'stopping'
  store.patch({ status: 'stopping' })
  console.log('[recorder] stop requested -> stopping')
  stopTick()
  showControlPanel()
}

/** compositor 报告已完全停止（最后 chunk 已发出），此时落盘收尾 */
export async function handleRecorderStoppedByCompositor() {
  const store = getStore()
  const { mp4s, errors } = await session.finalize()
  console.log(
    '[recorder] finalize done:',
    mp4s.map((f) => path.basename(f)).join(', ') || '(no files)',
    errors.length ? `| errors: ${errors.join('; ')}` : '| no errors'
  )
  store.lastOutputFiles = mp4s
  store.status = 'idle'
  store.patch({
    status: 'idle',
    lastOutputFiles: mp4s,
    error: errors.length ? `部分文件转换失败: ${errors.join('; ')}` : null,
    currentFile: ''
  })
  if (mp4s.length > 0) {
    // 自动打开预览（裁剪头尾）
    console.log('[preview] auto open:', path.basename(mp4s[mp4s.length - 1]))
    openPreview(mp4s[mp4s.length - 1])
  }
}

export function abortCountdown() {
  if (countdownTimer) {
    clearInterval(countdownTimer)
    countdownTimer = null
  }
}

/** compositor 报告错误：中止当前流程回 idle；已写入的数据尝试收尾恢复 */
export function handleRecorderError(message: string) {
  console.error('[recorder] error:', message)
  const store = getStore()
  abortCountdown()
  stopTick()
  const wasActive = ['countdown', 'recording', 'paused'].includes(store.status)
  const hadData = store.status === 'recording' || store.status === 'paused'
  if (wasActive) {
    store.status = 'idle'
    showControlPanel()
  }
  store.error = message
  store.patch({ status: 'idle', error: message })
  if (hadData) {
    void session.finalize().then(({ mp4s, errors }) => {
      if (mp4s.length > 0) {
        store.patch({
          lastOutputFiles: mp4s,
          error: errors.length ? `${message}（已恢复部分文件）` : message
        })
      }
    })
  }
}

export { trimVideo, shell, dialog, BrowserWindow, fitOverlayToDisplay, getOverlay }
