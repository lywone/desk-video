import { screen } from 'electron'
import { broadcastToAll } from './ipc-helpers'
import { IPC } from '@shared/ipc-channels'

/**
 * 全局光标轮询：聚光灯跟随用。
 * 50ms 一次，位置变化才广播（虚拟屏幕全局坐标）。
 */
export function startCursorWatcher() {
  let last = { x: -1, y: -1 }
  setInterval(() => {
    try {
      const p = screen.getCursorScreenPoint()
      if (p.x !== last.x || p.y !== last.y) {
        last = p
        broadcastToAll(IPC.CursorMove, { x: p.x, y: p.y })
      }
    } catch {
      /* ignore */
    }
  }, 50)
}
