import { ModelResultValidationError, ValidatedModelRequest } from '../model-result-retry'
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
import { AssessmentOcrPreparer } from './ocr-regions'
import { AssessmentResponseValidator } from './response-validator'
import { AssessmentTargetResolver } from './target-resolver'
import { AssessmentClickExecutor } from './click-executor'
import { checkAborted } from './wait'
import { AssessmentPageChangedError, remainingAnswerSteps } from './recovery'
import { AssessmentRetrySession, assessmentPageIdentity } from './retry-session'
import { AssessmentScoreMemoryService } from './score-memory-service'
import { AssessmentScoreDecision } from './score-decision'
import { configureAssessmentSessions } from './memory-sessions'
import { validateScoreRecovery } from './score-recovery'

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
  scoreMemory?: AssessmentScoreMemoryService
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
  private readonly ocrPreparer = new AssessmentOcrPreparer()
  private readonly prompts = new AssessmentPromptBuilder()
  private readonly validator = new AssessmentResponseValidator()
  private readonly validatedRequest = new ValidatedModelRequest()
  private readonly targets = new AssessmentTargetResolver()
  private readonly scoreDecision = new AssessmentScoreDecision()
  private readonly scoreMemory: AssessmentScoreMemoryService

  constructor(private readonly dependencies: RunnerDependencies) {
    this.scoreMemory = dependencies.scoreMemory ?? new AssessmentScoreMemoryService()
  }

  async run(
    context: RunContext,
    update: (patch: Partial<AssessmentSnapshot>) => void,
    retry = new AssessmentRetrySession()
  ): Promise<{ preview: boolean; pageKey: string }> {
    const { config, signal, phase } = context
    const checkSelectedAnswers = config.checkSelectedAnswers !== false
    const deps = this.dependencies
    const started = Date.now()
    checkAborted(signal)
    if (!config.profile.apiKey.trim()) throw new Error('请先在设置 → 做题模式中配置 AI API Key')
    configureAssessmentSessions(deps.memory, this.scoreMemory, config)
    const memory = deps.memory.snapshot()
    const scoreSnapshot = this.scoreMemory.snapshot()
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
      layout = this.ocrPreparer.prepare(ocr, {
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
    const prompt = this.prompts.build(
      config,
      capture,
      captureId,
      config.mostLeastEnabled ? scoreSnapshot.context : memory.context,
      layout,
      context.recovery
    )
    const aiStart = Date.now()
    const { output, value } = await this.validatedRequest.run({
      messages: prompt.messages,
      signal,
      request: async (messages) => {
        phase('analyzing')
        let raw = ''
        let oversized = false
        update({ raw })
        try {
          return await deps.ask(messages, prompt.system, config.profile, signal, (chunk) => {
            checkAborted(signal)
            raw += chunk
            if (raw.length > 131072) {
              oversized = true
              throw new ModelResultValidationError(
                'AI 输出超过 128K 字符限制，请精简并返回完整 JSON'
              )
            }
            update({ raw })
          })
        } catch (error) {
          // Stream adapters may wrap callback errors; keep the original validation category.
          if (oversized)
            throw new ModelResultValidationError('AI 输出超过 128K 字符限制，请精简并返回完整 JSON')
          throw error
        }
      },
      validate: (response) => {
        phase('validating')
        const parsed = this.validator.parseAndValidate(response, {
          strategy: config.strategy,
          mostLeastEnabled: config.mostLeastEnabled,
          checkSelectedAnswers,
          requiresSelectedAnswers: checkSelectedAnswers && !!context.recovery,
          captureId,
          layout
        })
        const optionTexts = Object.fromEntries(
          Object.entries(parsed.options).map(([letter, option]) => [letter, option.text])
        )
        const identity = assessmentPageIdentity(parsed, layout)
        if (config.mostLeastEnabled) validateScoreRecovery(parsed, context.recovery, identity)
        const decision = config.mostLeastEnabled
          ? this.scoreDecision.decide(parsed.options, parsed.newScores!, scoreSnapshot)
          : undefined
        if (decision) {
          parsed.answers = decision.answers
          parsed.notices = [...(parsed.notices ?? []), ...decision.notices]
        }
        const memoryInput = {
          question: parsed.question,
          options: optionTexts,
          answers: parsed.answers
        }
        const matched = config.mostLeastEnabled ? undefined : deps.memory.match(memoryInput)
        if (matched) parsed.answers = matched
        const plan = remainingAnswerSteps(
          this.targets.resolve(config, parsed, capture, layout),
          parsed,
          checkSelectedAnswers ? context.recovery : undefined
        )
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
        return {
          parsed,
          optionTexts,
          identity,
          decision,
          memoryInput,
          matched,
          plan,
          optionTargets
        }
      },
      onRetry: (attempt, error) => {
        update({
          error: null,
          notice: `AI 返回结果不完整或格式错误，正在重试 ${attempt}/3：${error}`
        })
      }
    })
    checkAborted(signal)
    const aiMs = Date.now() - aiStart
    const { parsed, optionTexts, identity, decision, memoryInput, matched, plan, optionTargets } =
      value
    const samePage = retry.observe(identity)
    const pageKey = JSON.stringify(identity)
    if (context.verificationOnly) {
      update({ notice: '已确认进入新题，本次任务完成' })
      return { preview: false, pageKey }
    }
    if (samePage)
      parsed.notices = [
        ...(parsed.notices ?? []),
        `页面仍为同一题，正在检查未选项和下一步（重试 ${retry.retryCount}/3）`
      ]
    if (!config.mostLeastEnabled && !retry.memoryCommitted) deps.memory.assertCapacity()
    phase('locating')
    const preview = config.strategy === 'ocr' && config.preview
    const result: AssessmentResult = {
      raw: output,
      ...(decision ? { scoring: decision.scoring } : {}),
      question: parsed.question,
      optionTexts,
      answer: parsed.answers[0],
      answers: parsed.answers,
      notices: parsed.notices,
      ...(context.recovery ? { confirmedSelectedAnswers: parsed.selectedAnswers } : {}),
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
        questionRegionIds: parsed.questionRegionIds,
        nextRegionId: parsed.next.clickRegionId,
        points: plan
          .filter((step) => step.imagePoint)
          .map((step) => ({ label: step.answer ?? '下一步', point: step.imagePoint! }))
      }
    }
    update({
      result: { ...result },
      debug,
      notice: [
        ...(parsed.notices ?? []),
        preview
          ? 'OCR 预览完成，未执行点击，也未写入记忆'
          : matched
            ? '已按历史选项内容保持答案一致'
            : ''
      ]
        .filter(Boolean)
        .join('；')
    })
    if (preview) return { preview: true, pageKey }
    deps.assertClickSupported()
    checkAborted(signal)
    const anchors =
      layout?.regions.filter((r) => parsed.questionRegionIds?.includes(r.id)).map((r) => r.box) ??
      []
    const guard = layout ? deps.guard.prepare(capture, config.captureRegion, anchors) : undefined
    if (decision) this.scoreMemory.commit(decision.additions, scoreSnapshot)
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
      if (!config.mostLeastEnabled && !retry.memoryCommitted) {
        deps.memory.commit({ ...memoryInput, answers: parsed.answers }, memory)
        retry.memoryCommitted = true
      }
      retry.recovery = {
        ...(config.mostLeastEnabled ? { progress: identity.progress } : {}),
        question: parsed.question,
        options: optionTexts,
        intendedAnswers: parsed.answers,
        executedAnswers: [
          ...(context.recovery ? (parsed.selectedAnswers ?? []) : []),
          ...plan.flatMap((step) => (step.answer ? [step.answer] : []))
        ]
      }
      result.execution = 'executed'
      update({
        notice: [
          ...(parsed.notices ?? []),
          `${context.recovery && parsed.selectedAnswers?.length ? `已跳过当前确认选中的 ${parsed.selectedAnswers.join(' → ')}；` : ''}本轮完成 ${plan.length} 次点击${result.next ? '，包含下一步' : ''}；尚未验证点击后的网页状态`
        ].join('；')
      })
    } catch (error) {
      if (error instanceof AssessmentPageChangedError) {
        error.recovery = {
          ...(config.mostLeastEnabled ? { progress: identity.progress } : {}),
          question: parsed.question,
          options: optionTexts,
          intendedAnswers: parsed.answers,
          executedAnswers: [
            ...(context.recovery ? (parsed.selectedAnswers ?? []) : []),
            ...plan
              .slice(0, result.executedSteps)
              .flatMap((step) => (step.answer ? [step.answer] : []))
          ]
        }
      }
      throw error
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
