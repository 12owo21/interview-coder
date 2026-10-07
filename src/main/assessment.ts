import { app, ipcMain } from 'electron'
import {
  settings,
  getAssessmentProfile,
  onSettingsChanged,
  DEFAULT_ASSESSMENT_PERSONALITY_PROMPT
} from './settings'
import { takeScreenshotWithMetadata } from './take-screenshot'
import { recognizeLocalPng } from './ocr'
import { getAssessmentStream } from './ai'
import { consumeStream, extractErrorMessage } from './stream'
import { clickScreenPoint } from './click'
import { assessmentMemory, assessmentScoreMemory } from './assessment-memory'
import { AssessmentController } from './assessment/controller'
import { AssessmentRunner } from './assessment/runner'
import { AssessmentClickExecutor } from './assessment/click-executor'
import { AssessmentPageGuard } from './assessment/page-guard'
import type { AssessmentConfig } from './assessment/types'
import type { AssessmentSnapshot } from '../shared/assessment'

export type { AssessmentResult } from '../shared/assessment'

function readConfig(): AssessmentConfig {
  return {
    profile: { ...getAssessmentProfile() },
    strategy: settings.assessmentFixedClick
      ? 'fixed'
      : settings.assessmentOcrEnabled
        ? 'ocr'
        : 'model',
    preview: settings.assessmentOcrPreviewOnly,
    showDebug: settings.assessmentShowOcrDebug,
    margins: { ...settings.ocrFilterMargins },
    fixedPositions: structuredClone(settings.assessmentFixedPositions),
    nextPosition: settings.assessmentNextPosition ? { ...settings.assessmentNextPosition } : null,
    memoryEnabled: settings.assessmentMemoryEnabled,
    mostLeastEnabled: settings.assessmentMostLeastEnabled,
    checkSelectedAnswers: settings.assessmentCheckSelectedAnswers,
    personality:
      settings.assessmentPersonalityPrompt.trim() || DEFAULT_ASSESSMENT_PERSONALITY_PROMPT,
    captureScreen: settings.captureScreen,
    captureRegion: settings.captureRegion ? { ...settings.captureRegion } : null
  }
}

let pendingSnapshot: AssessmentSnapshot | undefined
let publishTimer: ReturnType<typeof setTimeout> | undefined
let lastImageCaptureId: string | undefined
function publish(snapshot: AssessmentSnapshot): void {
  pendingSnapshot = snapshot
  if (publishTimer) return
  publishTimer = setTimeout(() => {
    publishTimer = undefined
    const state = pendingSnapshot!
    pendingSnapshot = undefined
    const window = global.mainWindow
    if (!window || window.isDestroyed()) return
    if (state.debug?.image) {
      const captureId = state.debug.captureId
      if (captureId === lastImageCaptureId) state.debug = { ...state.debug, image: undefined }
      lastImageCaptureId = captureId
    }
    window.webContents.send('assessment-snapshot', state)
  }, 50)
}

const runner = new AssessmentRunner({
  capture: takeScreenshotWithMetadata,
  ocr: recognizeLocalPng,
  memory: assessmentMemory,
  scoreMemory: assessmentScoreMemory,
  executor: new AssessmentClickExecutor(clickScreenPoint),
  guard: new AssessmentPageGuard(takeScreenshotWithMetadata),
  assertClickSupported: () => {
    if (process.platform !== 'win32') throw new Error('自动点击目前仅支持 Windows；可使用 OCR 预览')
  },
  ask: async (messages, system, profile, signal, chunk) => {
    const controller = new AbortController()
    const cancel = (): void => controller.abort()
    signal.addEventListener('abort', cancel, { once: true })
    if (signal.aborted) controller.abort()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, 120000)
    try {
      const result = await consumeStream(
        (abortSignal) => getAssessmentStream(messages, abortSignal, false, '', { profile, system }),
        controller,
        chunk
      )
      if (timedOut) throw new Error('AI 分析超过 120 秒，已停止')
      if (result.status === 'aborted') throw new Error('做题任务已停止')
      if (result.status === 'failed') throw new Error(extractErrorMessage(result.error))
      return result.text
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', cancel)
      controller.abort()
    }
  }
})

export const assessmentController = new AssessmentController(runner, readConfig, publish)
let lastExecutionConfig: string | undefined
onSettingsChanged(() => {
  const fingerprint = JSON.stringify({ ...readConfig(), showDebug: false })
  if (fingerprint !== lastExecutionConfig && assessmentController.getSnapshot().busy) {
    assessmentController.stop('做题配置已改变，本轮已停止；重新开始后使用新配置')
  }
  lastExecutionConfig = fingerprint
})

export function stopAssessmentLoop(): void {
  assessmentController.stop()
}
export function toggleAssessmentLoop(): void {
  void assessmentController.toggleLoop()
}
export function analyzeAssessmentScreenshot(): Promise<boolean> {
  return assessmentController.runOnce()
}

ipcMain.handle('assessment:analyze', () => analyzeAssessmentScreenshot())
ipcMain.handle('assessment:stop', () => stopAssessmentLoop())
ipcMain.handle('assessment:get-snapshot', () => assessmentController.getSnapshot())
ipcMain.handle('assessment:reset-memory', () => {
  assessmentController.stop('已开始新测评，旧任务正在结束')
  assessmentMemory.reset()
  assessmentScoreMemory.reset()
})
ipcMain.handle('click-screen-point', (_event, point: { x: number; y: number }) =>
  assessmentController.runManual(() => clickScreenPoint(point))
)
app.on('before-quit', stopAssessmentLoop)
