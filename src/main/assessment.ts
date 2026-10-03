import { ipcMain } from 'electron'
import type { ModelMessage } from 'ai'
import { takeScreenshotWithMetadata } from './take-screenshot'
import {
  DEFAULT_ASSESSMENT_PERSONALITY_PROMPT,
  getAssessmentProfile,
  settings
} from './settings'
import { getAssessmentStream } from './ai'
import { consumeStream, extractErrorMessage } from './stream'
import { clickScreenPoint } from './click'
import {
  addAssessmentMemory,
  getAssessmentMemoryContext,
  setAssessmentMemoryEnabled
} from './assessment-memory'

type AssessmentOption = { x: number; y: number }
type AnswerLetter = string
type ModelOption =
  | (AssessmentOption & { text: string })
  | { text: string; left: number; top: number; right: number; bottom: number }
export type AssessmentResult = {
  raw: string
  question: string
  optionTexts: Record<string, string>
  /** First answer, retained for compatibility with the previous UI. */
  answer: string
  /** Ordered answers to click, including multi-select/order-sensitive questions. */
  answers: AnswerLetter[]
  options: Record<string, AssessmentOption>
  next: { required: boolean; point: AssessmentOption } | null
  imageSize: { width: number; height: number }
  fullImageSize: { width: number; height: number }
  physicalScreenSize: { width: number; height: number }
  captureOffset: { x: number; y: number }
}

type ParsedAssessment = Omit<
  AssessmentResult,
  'imageSize' | 'fullImageSize' | 'physicalScreenSize' | 'captureOffset'
>

function parseResult(raw: string, requireOptions: boolean): ParsedAssessment {
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('模型没有返回 JSON')
  const value = JSON.parse(match[0]) as {
    question?: unknown
    answer?: unknown
    answers?: unknown
    options?: Record<string, ModelOption>
    next?: {
      required?: unknown
      left?: unknown
      top?: unknown
      right?: unknown
      bottom?: unknown
      x?: unknown
      y?: unknown
    }
  }
  if (typeof value.question !== 'string' || !value.question.trim()) {
    throw new Error('模型没有返回原题目')
  }
  const rawAnswers = value.answers ?? (value.answer ? [value.answer] : undefined)
  if (!Array.isArray(rawAnswers) || rawAnswers.length === 0 || rawAnswers.length > 26) {
    throw new Error('模型返回的 answers 必须是 1 到 26 个选项的数组')
  }
  const answers = rawAnswers.map((answer) => {
    if (typeof answer !== 'string' || !/^[A-Z]$/.test(answer)) {
      throw new Error('模型返回的答案必须是单个大写英文字母')
    }
    return answer as AnswerLetter
  })
  if (new Set(answers).size !== answers.length) {
    throw new Error('模型返回的答案不能重复')
  }
  const options = value.options
  if (!options && requireOptions) throw new Error('模型没有返回选项信息')
  if (!options) {
    return {
      raw,
      question: value.question,
      optionTexts: {},
      answer: answers[0],
      answers,
      options: {},
      next: null
    }
  }
  const letters = Object.keys(options).sort()
  if (letters.length === 0 || letters.some((letter) => !/^[A-Z]$/.test(letter))) {
    throw new Error('模型返回的选项必须使用 A-Z 单个大写字母')
  }
  for (const answer of answers) {
    if (!options[answer]) throw new Error(`答案 ${answer} 不存在于模型返回的选项中`)
  }
  for (const letter of letters) {
    const point = options[letter]
    if (!point || typeof point.text !== 'string' || !point.text.trim()) {
      throw new Error(`模型没有返回选项 ${letter} 的文本`)
    }
  }
  const optionTexts = Object.fromEntries(
    (['A', 'B', 'C', 'D'] as const).map((letter) => [letter, options[letter].text.trim()])
  ) as Record<string, string>
  const normalizedOptions = Object.fromEntries(
    letters.map((letter) => {
      const point = options[letter]
      if ('left' in point) {
        const values = [point.left, point.top, point.right, point.bottom]
        if (!values.every(Number.isInteger) || point.right <= point.left || point.bottom <= point.top) {
          throw new Error(`模型返回的选项 ${letter} 矩形无效`)
        }
        return [letter, {
          x: Math.round((point.left + point.right) / 2),
          y: Math.round((point.top + point.bottom) / 2)
        }]
      }
      if (!requireOptions) return [letter, { x: 0, y: 0 }]
      if (!Number.isInteger(point.x) || !Number.isInteger(point.y)) {
        throw new Error(`模型返回的选项 ${letter} 坐标无效`)
      }
      return [letter, point]
    })
  ) as Record<string, AssessmentOption>
  const nextValue = value.next
  let next: ParsedAssessment['next'] = null
  if (nextValue?.required === true) {
    if (requireOptions) {
      const rectValues = [nextValue.left, nextValue.top, nextValue.right, nextValue.bottom]
      if (!rectValues.every((item) => Number.isInteger(item)) ||
          (nextValue.right as number) <= (nextValue.left as number) ||
          (nextValue.bottom as number) <= (nextValue.top as number)) {
        throw new Error('模型要求点击下一步，但没有返回有效坐标')
      }
      next = {
        required: true,
        point: {
          x: Math.round(((nextValue.left as number) + (nextValue.right as number)) / 2),
          y: Math.round(((nextValue.top as number) + (nextValue.bottom as number)) / 2)
        }
      }
    } else {
      next = { required: true, point: { x: 0, y: 0 } }
    }
  }
  return {
    raw,
    question: value.question,
    optionTexts,
    answer: answers[0],
    answers,
    options: normalizedOptions,
    next
  }
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('做题循环已停止'))
      return
    }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new Error('做题循环已停止'))
    }, { once: true })
  })
}

let assessmentLoopRunning = false
let assessmentLoopGeneration = 0
let assessmentLoopController: AbortController | null = null

function sendAssessmentEvent(channel: string, ...args: unknown[]): void {
  const mainWindow = global.mainWindow
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args)
}

export async function analyzeAssessmentScreenshot(
  controller = new AbortController()
): Promise<boolean> {
  const mainWindow = global.mainWindow
  if (!mainWindow || mainWindow.isDestroyed()) return false
  setAssessmentMemoryEnabled(settings.assessmentMemoryEnabled)
  const profile = getAssessmentProfile()
  if (!profile.apiKey.trim()) {
    mainWindow.webContents.send('assessment-error', '请先在设置 → 做题模式中配置 AI API Key')
    return false
  }

  const capture = await takeScreenshotWithMetadata()
  if (!capture) {
    mainWindow.webContents.send('assessment-error', '截图失败，未获取到屏幕内容')
    return false
  }

  mainWindow.webContents.send('assessment-loading-start')
  const messages: ModelMessage[] = [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: [
            '分析这道题，返回原题目、所有选项文本、答案和可点击坐标。',
            getAssessmentMemoryContext()
              ? `本次测评之前的记录如下，请保持相同题目或相同选项内容的答案一致：\n${getAssessmentMemoryContext()}`
              : ''
          ]
            .filter(Boolean)
            .join('\n\n')
        },
        {
          type: 'text',
          text: `图片尺寸为 ${capture.imageWidth}×${capture.imageHeight} 像素。坐标原点是图片左上角。`
        },
        { type: 'image', image: capture.data }
      ]
    }
  ]
  try {
    const fixedPositions = settings.assessmentFixedClick
    const personalityPrompt = settings.assessmentMemoryEnabled
      ? settings.assessmentPersonalityPrompt.trim() || DEFAULT_ASSESSMENT_PERSONALITY_PROMPT
      : ''
    const outcome = await consumeStream(
      (signal) => getAssessmentStream(messages, signal, fixedPositions, personalityPrompt),
      controller,
      (chunk) => sendAssessmentEvent('assessment-raw-chunk', chunk)
    )
    if (outcome.status === 'failed') throw outcome.error
    if (outcome.status === 'aborted') return false
    const parsed = parseResult(outcome.text, !fixedPositions || settings.assessmentMemoryEnabled)
    // The model sees the cropped image. Convert its points back to the full
    // captured display image before the future click step consumes them.
    const result: AssessmentResult = {
      ...parsed,
      options: Object.fromEntries(
        Object.entries(parsed.options).map(([letter, point]) => [letter, {
          // Model coordinates are in the resized/cropped image. Convert them
          // to physical global screen coordinates for OS-level clicking.
          x: Math.round(
            ((point.x + capture.offsetX) * capture.physicalWidth) / capture.fullWidth +
              capture.originX
          ),
          y: Math.round(
            ((point.y + capture.offsetY) * capture.physicalHeight) / capture.fullHeight +
              capture.originY
          )
        }])
      ) as AssessmentResult['options'],
      imageSize: { width: capture.imageWidth, height: capture.imageHeight },
      fullImageSize: { width: capture.fullWidth, height: capture.fullHeight },
      physicalScreenSize: { width: capture.physicalWidth, height: capture.physicalHeight },
      captureOffset: { x: capture.offsetX, y: capture.offsetY }
    }
    if (result.next?.required) {
      result.next = {
        required: true,
        point: fixedPositions
          ? settings.assessmentNextPosition ?? (() => { throw new Error('模型要求点击下一步，请先配置固定的下一步坐标') })()
          : {
              x: Math.round(
                ((result.next.point.x + capture.offsetX) * capture.physicalWidth) / capture.fullWidth +
                  capture.originX
              ),
              y: Math.round(
                ((result.next.point.y + capture.offsetY) * capture.physicalHeight) / capture.fullHeight +
                  capture.originY
              )
            }
      }
    }
    mainWindow.webContents.send('assessment-result', result)
    const clickOptions = fixedPositions ? settings.assessmentFixedPositions : result.options
    const targets = result.answers.map((answer) => {
      const target = clickOptions[answer]
      if (!target || !Number.isInteger(target.x) || !Number.isInteger(target.y)) {
        throw new Error(`请先在设置中配置选项 ${answer} 的固定坐标`)
      }
      return target
    })
    for (const [index, target] of targets.entries()) {
      if (controller.signal.aborted) return false
      if (index > 0) await wait(500, controller.signal)
      await clickScreenPoint(target)
    }
    if (result.next?.required) {
      if (controller.signal.aborted) return false
      await wait(500, controller.signal)
      await clickScreenPoint(result.next.point)
    }
    addAssessmentMemory({
      question: result.question,
      options: result.optionTexts,
      answers: result.answers
    })
    const lastTarget = result.next?.required ? result.next.point : targets[targets.length - 1]
    mainWindow.webContents.send('assessment-clicked', {
      answers: result.answers,
      x: lastTarget.x,
      y: lastTarget.y,
      nextClicked: Boolean(result.next?.required)
    })
    return true
  } catch (error) {
    if (controller.signal.aborted) return false
    mainWindow.webContents.send('assessment-error', extractErrorMessage(error))
    return false
  } finally {
    mainWindow.webContents.send('assessment-loading-end')
  }
}

export function stopAssessmentLoop(): void {
  if (!assessmentLoopRunning && !assessmentLoopController) return
  assessmentLoopRunning = false
  assessmentLoopGeneration += 1
  assessmentLoopController?.abort()
  assessmentLoopController = null
  sendAssessmentEvent('assessment-loop-stopped')
}

export function toggleAssessmentLoop(): void {
  if (assessmentLoopRunning) {
    stopAssessmentLoop()
    return
  }
  const generation = ++assessmentLoopGeneration
  assessmentLoopRunning = true
  sendAssessmentEvent('assessment-loop-started')
  void (async () => {
    try {
      while (assessmentLoopRunning && generation === assessmentLoopGeneration) {
        const controller = new AbortController()
        assessmentLoopController = controller
        const completed = await analyzeAssessmentScreenshot(controller)
        if (!completed || !assessmentLoopRunning || generation !== assessmentLoopGeneration) break
        await wait(3000, controller.signal)
      }
    } catch (error) {
      if (assessmentLoopRunning && generation === assessmentLoopGeneration) {
        sendAssessmentEvent('assessment-error', extractErrorMessage(error))
      }
    } finally {
      if (generation === assessmentLoopGeneration) {
        assessmentLoopRunning = false
        assessmentLoopController = null
        sendAssessmentEvent('assessment-loop-stopped')
      }
    }
  })()
}

ipcMain.handle('assessment:analyze', () => analyzeAssessmentScreenshot())
