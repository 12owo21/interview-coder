import { randomUUID } from 'node:crypto'
import type { ModelMessage } from 'ai'
import type { ApiProfile } from '../../shared/api-profile'
import type {
  AssessmentDebug,
  AssessmentResult,
  AssessmentSnapshot,
  Box,
  OcrLayout
} from '../../shared/assessment'
import type { OcrFilterMargins, OcrResult } from '../../shared/ocr'
import type { ScreenshotCapture } from '../take-screenshot'
import type { CaptureFunction, GuardSession, RunContext } from './types'
import { AssessmentMemoryService } from './memory-service'
import { AssessmentPromptBuilder } from './prompt-builder'
import { OcrLayoutAnalyzer } from './ocr-layout-analyzer'
import { AssessmentResponseValidator } from './response-validator'
import { AssessmentTargetResolver } from './target-resolver'
import { AssessmentClickExecutor } from './click-executor'
import { checkAborted } from './wait'

export interface RunnerDependencies {
  capture: CaptureFunction
  ocr: (png: Uint8Array, signal: AbortSignal, margins: OcrFilterMargins) => Promise<OcrResult>
  ask: (
    messages: ModelMessage[],
    system: string,
    profile: ApiProfile,
    signal: AbortSignal,
    chunk: (text: string) => void
  ) => Promise<string>
  memory: AssessmentMemoryService
  executor: AssessmentClickExecutor
  guard: {
    prepare: (
      capture: ScreenshotCapture,
      region: RunContext['config']['captureRegion'],
      anchors: Box[]
    ) => GuardSession
  }
  assertClickSupported: () => void
}

export class AssessmentRunner {
  private readonly layoutAnalyzer = new OcrLayoutAnalyzer()
  private readonly prompts = new AssessmentPromptBuilder()
  private readonly validator = new AssessmentResponseValidator()
  private readonly targets = new AssessmentTargetResolver()

  constructor(private readonly dependencies: RunnerDependencies) {}

  async run(
    context: RunContext,
    update: (patch: Partial<AssessmentSnapshot>) => void,
    previousPage?: string
  ): Promise<{ preview: boolean; pageKey: string }> {
    const { config, signal, phase } = context
    const deps = this.dependencies
    const started = Date.now()
    checkAborted(signal)
    if (!config.profile.apiKey.trim()) throw new Error('请先在设置 → 做题模式中配置 AI API Key')
    deps.memory.configure(config.memoryEnabled, config.personality)
    deps.memory.assertCapacity()
    const memory = deps.memory.snapshot()
    phase('capturing')
    const capture = await deps.capture({
      captureScreen: config.captureScreen,
      captureRegion: config.captureRegion
    })
    checkAborted(signal)
    if (!capture) throw new Error('截图失败，未获取到目标屏幕')
    const captureId = randomUUID()
    let layout: OcrLayout | undefined
    let debug: AssessmentDebug | null = null
    let ocrMs = 0
    if (config.strategy === 'ocr') {
      phase('recognizing')
      const ocrStart = Date.now()
      const ocr = await deps.ocr(Buffer.from(capture.data, 'base64'), signal, config.margins)
      checkAborted(signal)
      ocrMs = Date.now() - ocrStart
      layout = this.layoutAnalyzer.analyze(ocr, {
        width: capture.imageWidth,
        height: capture.imageHeight
      })
      debug = {
        captureId,
        imageSize: { width: capture.imageWidth, height: capture.imageHeight },
        ...(config.showDebug || config.preview ? { image: capture.data } : {}),
        layout
      }
      update({ debug })
    }
    phase('analyzing')
    const prompt = this.prompts.build(config, capture, captureId, memory.context, layout)
    const aiStart = Date.now()
    let raw = ''
    const output = await deps.ask(
      prompt.messages,
      prompt.system,
      config.profile,
      signal,
      (chunk) => {
        checkAborted(signal)
        raw += chunk
        if (raw.length > 131072) throw new Error('AI 输出超过 128K 字符限制')
        update({ raw })
      }
    )
    checkAborted(signal)
    const aiMs = Date.now() - aiStart
    phase('validating')
    const parsed = this.validator.parseAndValidate(output, {
      strategy: config.strategy,
      captureId,
      layout
    })
    const optionTexts = Object.fromEntries(
      Object.entries(parsed.options).map(([letter, value]) => [letter, value.text])
    )
    const memoryInput = { question: parsed.question, options: optionTexts, answers: parsed.answers }
    const matched = deps.memory.match(memoryInput)
    if (matched) parsed.answers = matched
    // Only a short-lived loop guard, not personality history. Keep question numbers
    // so explicitly numbered repetitions on another page remain distinguishable.
    const pageKey = JSON.stringify([
      parsed.question.normalize('NFKC').replace(/\s+/g, ''),
      Object.entries(optionTexts)
        .sort()
        .map(([key, text]) => [key, text.normalize('NFKC').replace(/\s+/g, '')])
    ])
    if (previousPage === pageKey)
      throw new Error('页面未切换或无法区分重复题，已暂停，避免再次点击取消选项')
    phase('locating')
    const plan = this.targets.resolve(config, parsed, capture, layout)
    const optionTargets =
      config.strategy === 'fixed'
        ? Object.fromEntries(
            Object.keys(parsed.options)
              .filter((key) => config.fixedPositions[key])
              .map((key) => [key, config.fixedPositions[key]!])
          )
        : Object.fromEntries(
            this.targets
              .resolve(
                config,
                { ...parsed, answers: Object.keys(parsed.options), next: { required: false } },
                capture,
                layout
              )
              .map((step) => [step.answer!, step.screenPoint])
          )
    const preview = config.strategy === 'ocr' && config.preview
    const result: AssessmentResult = {
      raw: output,
      question: parsed.question,
      optionTexts,
      answer: parsed.answers[0],
      answers: parsed.answers,
      options: optionTargets,
      next:
        plan.at(-1)?.kind === 'next' ? { required: true, point: plan.at(-1)!.screenPoint } : null,
      imageSize: { width: capture.imageWidth, height: capture.imageHeight },
      fullImageSize: { width: capture.fullWidth, height: capture.fullHeight },
      physicalScreenSize: { width: capture.physicalWidth, height: capture.physicalHeight },
      captureOffset: { x: capture.offsetX, y: capture.offsetY },
      captureId,
      strategy: config.strategy,
      execution: preview ? 'preview' : 'planned',
      executedSteps: 0,
      plan,
      timings: { ocrMs, aiMs, clickMs: 0, totalMs: Date.now() - started }
    }
    if (debug) {
      debug = {
        ...debug,
        optionRegions: Object.fromEntries(
          Object.entries(parsed.options).map(([key, value]) => [key, value.regionIds!])
        ),
        points: plan
          .filter((step) => step.imagePoint)
          .map((step) => ({ label: step.answer ?? '下一步', point: step.imagePoint! }))
      }
    }
    update({
      result: { ...result },
      debug,
      notice: preview
        ? 'OCR 预览完成，未执行点击，也未写入记忆'
        : matched
          ? '已按历史选项内容保持答案一致'
          : ''
    })
    if (preview) return { preview: true, pageKey }
    deps.assertClickSupported()
    checkAborted(signal)
    const selectedIds = new Set(
      Object.values(parsed.options).flatMap((option) => option.regionIds ?? [])
    )
    const firstOptionTop = layout
      ? Math.min(...layout.regions.filter((r) => selectedIds.has(r.id)).map((r) => r.box.top))
      : 0
    const block = layout?.blocks.find((b) => b.id === parsed.questionBlockId)
    const anchors =
      layout?.regions
        .filter((r) => block?.regionIds.includes(r.id) && r.box.bottom <= firstOptionTop)
        .map((r) => r.box) ?? []
    const guard = layout ? deps.guard.prepare(capture, config.captureRegion, anchors) : undefined
    phase('clicking')
    const clickStart = Date.now()
    try {
      await deps.executor.execute(
        plan,
        signal,
        async (index) => {
          const remaining = plan.slice(index).flatMap((step) => {
            const ids = step.answer ? parsed.options[step.answer].regionIds : parsed.next.regionIds
            return layout?.regions.filter((r) => ids?.includes(r.id)).map((r) => r.box) ?? []
          })
          await guard?.check(remaining, signal)
        },
        (count) => {
          result.executedSteps = count
          result.execution = 'partial'
          update({ result: { ...result } })
        }
      )
      checkAborted(signal)
      deps.memory.commit({ ...memoryInput, answers: parsed.answers }, memory)
      result.execution = 'executed'
      update({
        notice: `已按顺序执行 ${parsed.answers.join(' → ')}${result.next ? '，已执行下一步点击' : ''}；尚未验证网页选中状态`
      })
    } finally {
      result.timings = {
        ...result.timings,
        clickMs: Date.now() - clickStart,
        totalMs: Date.now() - started
      }
      update({ result: { ...result } })
    }
    return { preview: false, pageKey }
  }
}
