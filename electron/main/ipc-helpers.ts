import { BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc-channels'

export function broadcastToAll(channel: string, ...args: unknown[]) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.webContents.send(channel, ...args)
  }
}
