import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ipcMain } from 'electron'

const execFileAsync = promisify(execFile)

export interface ScreenPoint {
  x: number
  y: number
}

function validatePoint(point: ScreenPoint): void {
  if (
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    !Number.isInteger(point.x) ||
    !Number.isInteger(point.y) ||
    point.x < 0 ||
    point.y < 0
  ) {
    throw new Error('点击坐标必须是非负整数')
  }
}

/** Demo implementation: inject a left click through Windows user32.dll. */
async function clickWindows(point: ScreenPoint): Promise<void> {
  const script = `
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class MouseInput {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll", SetLastError=true)] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll", SetLastError=true)] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
}
'@
[MouseInput]::SetProcessDPIAware() | Out-Null
if (-not [MouseInput]::SetCursorPos(${point.x}, ${point.y})) { throw 'SetCursorPos failed' }
[MouseInput]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 35
[MouseInput]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
`
  await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    script
  ])
}

export async function clickScreenPoint(point: ScreenPoint): Promise<void> {
  validatePoint(point)
  if (process.platform === 'win32') {
    await clickWindows(point)
    return
  }
  throw new Error('当前 Demo 只实现 Windows 鼠标点击注入')
}

ipcMain.handle('click-screen-point', (_event, point: ScreenPoint) => clickScreenPoint(point))
