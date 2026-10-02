import { ipcMain } from 'electron'
import type { ModelMessage } from 'ai'
import { takeScreenshotWithMetadata } from './take-screenshot'
import { getAssessmentProfile } from './settings'
import { getAssessmentStream } from './ai'
import { consumeStream, extractErrorMessage } from './stream'

type AssessmentOption = { x: number; y: number }
type ModelOption =
  | AssessmentOption
  | { left: number; top: number; right: number; bottom: number }
export type AssessmentResult = {
  raw: string
  answer: 'A' | 'B' | 'C' | 'D'
  options: Record<'A' | 'B' | 'C' | 'D', AssessmentOption>
  imageSize: { width: number; height: number }
  fullImageSize: { width: number; height: number }
  physicalScreenSize: { width: number; height: number }
  captureOffset: { x: number; y: number }
}

type ParsedAssessment = Omit<
  AssessmentResult,
  'imageSize' | 'fullImageSize' | 'physicalScreenSize' | 'captureOffset'
>

function parseResult(raw: string): ParsedAssessment {
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('模型没有返回 JSON')
  const value = JSON.parse(match[0]) as Partial<AssessmentResult>
  if (!value.answer || !['A', 'B', 'C', 'D'].includes(value.answer)) {
    throw new Error('模型返回的答案不是 A/B/C/D')
  }
  const options = value.options as Record<'A' | 'B' | 'C' | 'D', ModelOption> | undefined
  if (!options) throw new Error('模型没有返回四个选项的坐标')
  for (const letter of ['A', 'B', 'C', 'D'] as const) {
    const point = options?.[letter]
    if (!point) {
      throw new Error(`模型没有返回选项 ${letter} 的有效坐标`)
    }
  }
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
      if (!Number.isInteger(point.x) || !Number.isInteger(point.y)) {
        throw new Error(`模型返回的选项 ${letter} 坐标无效`)
      }
      return [letter, point]
    })
  ) as Record<'A' | 'B' | 'C' | 'D', AssessmentOption>
  return {
    raw,
    answer: value.answer as AssessmentResult['answer'],
    options: normalizedOptions
  }
}

export async function analyzeAssessmentScreenshot(): Promise<void> {
  const mainWindow = global.mainWindow
  if (!mainWindow || mainWindow.isDestroyed()) return
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
        { type: 'text', text: '分析这道题，返回答案和四个选项的可点击坐标。' },
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
    const outcome = await consumeStream(
      (signal) => getAssessmentStream(messages, signal),
      controller,
      () => {}
    )
    if (outcome.status === 'failed') throw outcome.error
    if (outcome.status === 'aborted') return
    const parsed = parseResult(outcome.text)
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
  } catch (error) {
    mainWindow.webContents.send('assessment-error', extractErrorMessage(error))
  } finally {
    mainWindow.webContents.send('assessment-loading-end')
  }
}

ipcMain.handle('assessment:analyze', () => analyzeAssessmentScreenshot())
