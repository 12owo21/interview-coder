import { app, dialog, ipcMain, utilityProcess, type UtilityProcess } from 'electron'
import { readFile, stat, access } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { LocalOcrStatus, OcrResult, OcrWorkerReply, OcrFilterMargins } from '../../shared/ocr'
import { filterOcrResult, normalizeOcrFilterMargins } from '../../shared/ocr'
import { settings } from '../settings'
import { inspectOcrPng, MAX_OCR_BYTES } from './image'

const IDLE_RELEASE_MS = 60_000
const REQUEST_TIMEOUT_MS = 90_000
let child: UtilityProcess | undefined
let starting: Promise<void> | undefined
let idleTimer: ReturnType<typeof setTimeout> | undefined
let stopping = false
let busy = false
let jobs = 0
let idleReleaseMs = IDLE_RELEASE_MS
let pending:
  | { id: string; resolve: (result: OcrResult) => void; reject: (error: Error) => void }
  | undefined
let status: LocalOcrStatus = { state: 'stopped', modelLoaded: false, idleReleaseMs }

export function getOcrModelDirectory(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'ocr')
    : join(app.getAppPath(), 'resources/ocr')
}

export function getLocalOcrStatus(): LocalOcrStatus {
  return { ...status }
}

function clearIdle(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = undefined
}

function releaseWorker(state: LocalOcrStatus['state'], error?: string): void {
  clearIdle()
  const current = child
  child = undefined
  status = { state, modelLoaded: false, idleReleaseMs, ...(error ? { error } : {}) }
  current?.kill()
}

function scheduleRelease(): void {
  clearIdle()
  idleTimer = setTimeout(() => {
    if (!busy) releaseWorker('sleeping')
  }, idleReleaseMs)
  idleTimer.unref()
}

export function startLocalOcrService(options: { idleReleaseMs?: number } = {}): Promise<void> {
  if (stopping) return Promise.reject(new Error('OCR 服务已关闭'))
  if (starting) return starting
  if (child) return Promise.resolve()
  idleReleaseMs = options.idleReleaseMs ?? idleReleaseMs
  status = { state: 'starting', modelLoaded: false, idleReleaseMs }
  starting = (async () => {
    const directory = getOcrModelDirectory()
    await Promise.all(
      ['det.onnx', 'rec.onnx', 'keys.txt'].map((name) => access(join(directory, name)))
    )
    if (stopping) throw new Error('OCR 服务已关闭')
    await new Promise<void>((resolve, reject) => {
      const worker = utilityProcess.fork(
        join(app.getAppPath(), 'out/main/ocr-worker.js'),
        [directory],
        {
          serviceName: '本地 OCR',
          stdio: 'pipe',
          env: { ...process.env, OMP_NUM_THREADS: '2', OPENBLAS_NUM_THREADS: '1' }
        }
      )
      child = worker
      jobs = 0
      const timer = setTimeout(() => {
        if (child === worker) releaseWorker('error', 'OCR 服务启动超时')
        reject(new Error('OCR 服务启动超时'))
      }, 15_000)
      // Drain output to avoid pipe backpressure; never log screenshot contents.
      worker.stdout?.on('data', () => undefined)
      worker.stderr?.on('data', (data) => console.warn('[local-ocr]', String(data).trim()))
      worker.on('message', (message: OcrWorkerReply) => {
        if (child !== worker) return
        if (message.type === 'online') {
          clearTimeout(timer)
          status = { state: 'standby', modelLoaded: false, idleReleaseMs, pid: worker.pid }
          scheduleRelease()
          resolve()
        } else if (pending?.id === message.id) {
          if (message.type === 'loading') status = { ...status, state: 'loading' }
          if (message.type === 'recognizing')
            status = { ...status, state: 'recognizing', modelLoaded: true }
          if (message.type === 'result') {
            status = { ...status, state: 'ready', modelLoaded: true, memoryMiB: message.memoryMiB }
            pending.resolve(message.result)
          }
          if (message.type === 'error') {
            pending.reject(new Error(message.error))
            releaseWorker('error', message.error)
          }
        }
      })
      worker.on('exit', (code) => {
        clearTimeout(timer)
        reject(new Error(`OCR 子进程退出（${code}）`))
        if (child !== worker) return
        clearIdle()
        child = undefined
        const error = new Error(`OCR 子进程意外退出（${code}），可重新尝试识别`)
        status = { state: 'error', modelLoaded: false, idleReleaseMs, error: error.message }
        pending?.reject(error)
      })
    })
  })()
    .catch((error) => {
      status = {
        state: stopping ? 'stopped' : 'error',
        modelLoaded: false,
        idleReleaseMs,
        error: String(error)
      }
      throw error
    })
    .finally(() => {
      starting = undefined
    })
  return starting
}

export async function recognizeLocalPng(png: Uint8Array, signal?: AbortSignal, filterMargins?: OcrFilterMargins): Promise<OcrResult> {
  if (busy) throw new Error('OCR 正在识别，请稍后重试')
  if (signal?.aborted) throw new Error('OCR 识别已取消')
  inspectOcrPng(png)
  // Snapshot the settings so an edit during inference applies to the next request.
  const margins = normalizeOcrFilterMargins(filterMargins ?? settings.ocrFilterMargins)
  busy = true
  clearIdle()
  try {
    await startLocalOcrService()
    clearIdle()
    if (signal?.aborted || stopping) throw new Error('OCR 识别已取消')
    return await new Promise<OcrResult>((resolve, reject) => {
      const id = randomUUID()
      const cancel = (): void => {
        releaseWorker('sleeping')
        pending?.reject(new Error('OCR 识别已取消'))
      }
      const timer = setTimeout(() => {
        releaseWorker('error', 'OCR 识别超时，可重新尝试')
        pending?.reject(new Error('OCR 识别超时，可重新尝试'))
      }, REQUEST_TIMEOUT_MS)
      const cleanup = (): void => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', cancel)
      }
      pending = {
        id,
        resolve: (result) => {
          cleanup()
          resolve(filterOcrResult(result, margins))
        },
        reject: (error) => {
          cleanup()
          reject(error)
        }
      }
      signal?.addEventListener('abort', cancel, { once: true })
      try {
        child!.postMessage({ id, png })
      } catch (error) {
        pending.reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  } finally {
    pending = undefined
    busy = false
    jobs += 1
    if (child && (jobs >= 20 || (status.memoryMiB ?? 0) > 450)) releaseWorker('sleeping')
    else if (child) scheduleRelease()
  }
}

export function stopLocalOcrService(): void {
  stopping = true
  pending?.reject(new Error('OCR 服务已关闭'))
  releaseWorker('stopped')
}

ipcMain.handle('ocr:status', () => getLocalOcrStatus())
ipcMain.handle('ocr:test-image', async () => {
  const selection = await dialog.showOpenDialog({
    title: '选择 PNG 图片测试本地 OCR',
    filters: [{ name: 'PNG 截图', extensions: ['png'] }],
    properties: ['openFile']
  })
  if (selection.canceled || !selection.filePaths[0]) return null
  const path = selection.filePaths[0]
  if ((await stat(path)).size > MAX_OCR_BYTES) throw new Error('OCR 图片不能超过 10 MiB')
  return recognizeLocalPng(await readFile(path))
})
