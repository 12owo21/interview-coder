import { ipcMain } from 'electron'
import type { ModelMessage } from 'ai'
import { takeScreenshotWithMetadata } from './take-screenshot'
import { getAssessmentProfile, settings } from './settings'
import { getAssessmentStream } from './ai'
import { consumeStream, extractErrorMessage } from './stream'
import { clickScreenPoint } from './click'
import {
  addAssessmentMemory,
  getAssessmentMemoryContext,
  setAssessmentMemoryEnabled
} from './assessment-memory'

type AssessmentOption = { x: number; y: number }
type AnswerLetter = 'A' | 'B' | 'C' | 'D'
type ModelOption =
  | (AssessmentOption & { text: string })
  | { text: string; left: number; top: number; right: number; bottom: number }
export type AssessmentResult = {
  raw: string
  question: string
  optionTexts: Record<AnswerLetter, string>
  /** First answer, retained for compatibility with the previous UI. */
  answer: AnswerLetter
  /** Ordered answers to click, including multi-select/order-sensitive questions. */
  answers: AnswerLetter[]
  options: Record<AnswerLetter, AssessmentOption>
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
    options?: Record<AnswerLetter, ModelOption>
  }
  if (typeof value.question !== 'string' || !value.question.trim()) {
    throw new Error('模型没有返回原题目')
  }
  const rawAnswers = value.answers ?? (value.answer ? [value.answer] : undefined)
  if (!Array.isArray(rawAnswers) || rawAnswers.length === 0 || rawAnswers.length > 4) {
    throw new Error('模型返回的 answers 必须是 1 到 4 个选项的数组')
  }
  const answers = rawAnswers.map((answer) => {
    if (typeof answer !== 'string' || !['A', 'B', 'C', 'D'].includes(answer)) {
      throw new Error('模型返回的答案只能是 A/B/C/D')
    }
    return answer as AnswerLetter
  })
  if (new Set(answers).size !== answers.length) {
    throw new Error('模型返回的答案不能重复')
  }
  const options = value.options
  if (!options && requireOptions) throw new Error('模型没有返回四个选项的坐标')
  if (!options) {
    return {
      raw,
      question: value.question,
      optionTexts: { A: '', B: '', C: '', D: '' },
      answer: answers[0],
      answers,
      options: {} as AssessmentResult['options']
    }
  }
  for (const letter of ['A', 'B', 'C', 'D'] as const) {
    const point = options?.[letter]
    if (!point || typeof point.text !== 'string' || !point.text.trim()) {
      throw new Error(`模型没有返回选项 ${letter} 的文本`)
    }
  }
  const optionTexts = Object.fromEntries(
    (['A', 'B', 'C', 'D'] as const).map((letter) => [letter, options[letter].text.trim()])
  ) as Record<AnswerLetter, string>
  const normalizedOptions = Object.fromEntries(
    (['A', 'B', 'C', 'D'] as const).map((letter) => {
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
  ) as Record<AnswerLetter, AssessmentOption>
  return {
    raw,
    question: value.question,
    optionTexts,
    answer: answers[0],
    answers,
    options: normalizedOptions
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function analyzeAssessmentScreenshot(): Promise<void> {
  const mainWindow = global.mainWindow
  if (!mainWindow || mainWindow.isDestroyed()) return
  setAssessmentMemoryEnabled(settings.assessmentMemoryEnabled)
  const profile = getAssessmentProfile()
  if (!profile.apiKey.trim()) {
    mainWindow.webContents.send('assessment-error', '请先在设置 → 做题模式中配置 AI API Key')
    return
  }

  const capture = await takeScreenshotWithMetadata()
  if (!capture) {
    mainWindow.webContents.send('assessment-error', '截图失败，未获取到屏幕内容')
    return
  }

  mainWindow.webContents.send('assessment-loading-start')
  const messages: ModelMessage[] = [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: [
            '分析这道题，返回原题目、四个选项文本、答案和可点击坐标。',
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
  const controller = new AbortController()
  try {
    const fixedPositions = settings.assessmentFixedClick
    const outcome = await consumeStream(
      (signal) => getAssessmentStream(messages, signal, fixedPositions),
      controller,
      () => {}
    )
    if (outcome.status === 'failed') throw outcome.error
    if (outcome.status === 'aborted') return
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
      if (index > 0) await wait(500)
      await clickScreenPoint(target)
    }
    addAssessmentMemory({
      question: result.question,
      options: result.optionTexts,
      answers: result.answers
    })
    const lastTarget = targets[targets.length - 1]
    mainWindow.webContents.send('assessment-clicked', {
      answers: result.answers,
      x: lastTarget.x,
      y: lastTarget.y
    })
  } catch (error) {
    mainWindow.webContents.send('assessment-error', extractErrorMessage(error))
  } finally {
    mainWindow.webContents.send('assessment-loading-end')
  }
}

ipcMain.handle('assessment:analyze', () => analyzeAssessmentScreenshot())
