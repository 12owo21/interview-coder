import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

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
try {
  [MouseInput]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 35
} finally {
  [MouseInput]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
}
`
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command']
  try {
    await execFileAsync('powershell.exe', [...args, script], { timeout: 15000, windowsHide: true })
  } catch (error) {
    // A forced timeout may bypass PowerShell's finally. Attempt only mouse-up,
    // never repeat the down event or move to another target after an error.
    const release = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class ReleaseMouse { [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint x,uint y,uint d,UIntPtr e); }'; [ReleaseMouse]::mouse_event(0x0004,0,0,0,[UIntPtr]::Zero)`
    try {
      await execFileAsync('powershell.exe', [...args, release], {
        timeout: 5000,
        windowsHide: true
      })
    } catch {
      throw new Error('鼠标操作异常，且无法确认按键已释放；已停止后续点击')
    }
    throw error
  }
}

export async function clickScreenPoint(point: ScreenPoint): Promise<void> {
  validatePoint(point)
  if (process.platform === 'win32') {
    await clickWindows(point)
    return
  }
  throw new Error('当前 Demo 只实现 Windows 鼠标点击注入')
}
