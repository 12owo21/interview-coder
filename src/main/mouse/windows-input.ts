import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import type { Point } from '../../shared/assessment'
import type { MouseMoveOptions, MouseMovementAlgorithm } from './movement'
import { LinearMouseMovement } from './linear-movement'

const execFileAsync = promisify(execFile)
const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command']

// Read the actual cursor after startup. One process executes the entire path.
// JSON travels over stdin; algorithm output is never interpolated into code.
const script = `
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class MouseInput {
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point point);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
}
'@
[MouseInput]::SetProcessDPIAware() | Out-Null
$point = New-Object MouseInput+Point
if (-not [MouseInput]::GetCursorPos([ref]$point)) { throw 'GetCursorPos failed' }
[Console]::WriteLine(('{"x":' + $point.X + ',"y":' + $point.Y + '}'))
$command = [Console]::ReadLine() | ConvertFrom-Json
if ($null -eq $command) { throw 'Missing mouse command' }
$clock = [System.Diagnostics.Stopwatch]::StartNew()
foreach ($frame in $command.frames) {
  $remaining = [int]$frame.atMs - $clock.ElapsedMilliseconds
  if ($remaining -gt 0) { [System.Threading.Thread]::Sleep([int]$remaining) }
  if (-not [MouseInput]::SetCursorPos([int]$frame.x, [int]$frame.y)) { throw 'SetCursorPos failed' }
}
if (-not [MouseInput]::GetCursorPos([ref]$point)) { throw 'GetCursorPos failed' }
if ($point.X -ne $command.target.x -or $point.Y -ne $command.target.y) { throw 'Cursor did not reach target' }
if ($command.click) {
  try {
    [MouseInput]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
    [System.Threading.Thread]::Sleep(35)
  } finally {
    [MouseInput]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
  }
  [Console]::WriteLine('clicked')
}
[Console]::WriteLine('done')
`

export class WindowsMouseInput {
  constructor(private readonly algorithm: MouseMovementAlgorithm = new LinearMouseMovement()) {}

  async execute(target: Point, click: boolean, options: MouseMoveOptions = {}): Promise<void> {
    if (
      ![target.x, target.y].every(
        (value) => Number.isInteger(value) && value >= 0 && value <= 2147483647
      )
    ) {
      throw new Error('鼠标坐标必须是非负整数')
    }
    if (process.platform !== 'win32') throw new Error('鼠标操作目前仅支持 Windows')
    options.signal?.throwIfAborted()
    try {
      await this.run(target, click, options)
    } catch (error) {
      if (click) {
        // The helper has closed before this release; it cannot send a late down.
        // A forced termination can bypass the helper's finally. Never retry down.
        const release = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class ReleaseMouse { [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint x,uint y,uint d,UIntPtr e); }'; [ReleaseMouse]::mouse_event(0x0004,0,0,0,[UIntPtr]::Zero)`
        try {
          await execFileAsync('powershell.exe', [...args, release], {
            timeout: 5000,
            windowsHide: true
          })
        } catch {
          throw new Error('鼠标操作异常，且无法确认按键已释放；已停止后续操作')
        }
      }
      throw error
    }
  }

  private run(target: Point, click: boolean, options: MouseMoveOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn('powershell.exe', [...args, script], { windowsHide: true })
      let failure: Error | undefined
      let output = ''
      let errors = ''
      let sent = false
      let done = false
      let clicked = false
      const stop = (error: Error): void => {
        failure ??= error
        child.kill()
      }
      const cancel = (): void => stop(new Error('做题任务已停止'))
      const timer = setTimeout(() => stop(new Error('鼠标操作超过 15 秒，已停止')), 15000)
      options.signal?.addEventListener('abort', cancel, { once: true })
      child.on('error', (error) => {
        failure ??= error
      })
      child.stdin.on('error', (error) => stop(error))
      child.stderr.on('data', (data: Buffer) => {
        errors = (errors + data.toString()).slice(-2000)
      })
      child.stdout.on('data', (data: Buffer) => {
        output += data.toString()
        let end: number
        while ((end = output.indexOf('\n')) >= 0) {
          const line = output.slice(0, end).trim()
          output = output.slice(end + 1)
          if (line === 'clicked') {
            clicked = true
            continue
          }
          if (line === 'done') {
            done = true
            continue
          }
          if (sent || failure || !line) continue
          try {
            const start = JSON.parse(line) as Point
            if (![start.x, start.y].every(Number.isSafeInteger)) throw new Error('无法读取鼠标位置')
            const frames = options.smooth
              ? this.algorithm.createPath(start, target)
              : [{ ...target, atMs: 0 }]
            sent = true
            child.stdin.end(`${JSON.stringify({ frames, click, target })}\n`)
          } catch (error) {
            stop(error instanceof Error ? error : new Error(String(error)))
          }
        }
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        options.signal?.removeEventListener('abort', cancel)
        // Preserve confirmed clicks if cancellation came just after mouse-up.
        if (clicked && options.signal?.aborted) resolve()
        else if (failure) reject(failure)
        else if (code !== 0 || !done) reject(new Error(errors || 'Windows 鼠标操作未完成'))
        else resolve()
      })
      if (options.signal?.aborted) cancel()
    })
  }
}
