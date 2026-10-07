import { ModelResultValidationError } from '../model-result-retry'
import type { ClickStep, OcrLayout, Point } from '../../shared/assessment'
import type { ScreenshotCapture } from '../take-screenshot'
import type { AssessmentConfig, ParsedAssessment } from './types'
import { imageToScreen, validateScreenPoint } from './coordinate-mapper'

export class AssessmentTargetResolver {
  resolve(
    config: AssessmentConfig,
    answer: ParsedAssessment,
    capture: ScreenshotCapture,
    layout?: OcrLayout
  ): ClickStep[] {
    const resolve = (kind: 'answer' | 'next', key?: string): ClickStep => {
      const item = key ? answer.options[key] : answer.next
      if (config.strategy === 'fixed') {
        const point = key ? config.fixedPositions[key] : config.nextPosition
        if (!point) throw new Error(`请先配置${key ? `选项 ${key}` : '下一步'}的固定坐标`)
        return { kind, answer: key, source: 'fixed', screenPoint: validateScreenPoint(point) }
      }
      let point: Point | undefined = item.point
      let regionId: string | undefined
      if (config.strategy === 'ocr') {
        const region = layout?.regions.find((r) => r.id === item.clickRegionId)
        if (!region || !item.regionIds?.includes(region.id))
          throw new ModelResultValidationError(
            `无法定位${key ?? '下一步'}，点击框必须属于本次引用的 OCR 文字框`
          )
        regionId = region.id
        point = {
          x: (region.box.left + region.box.right) / 2,
          y: (region.box.top + region.box.bottom) / 2
        }
      }
      if (!point) throw new ModelResultValidationError('缺少点击位置')
      return {
        kind,
        answer: key,
        source: config.strategy,
        regionId,
        imagePoint: point,
        screenPoint: imageToScreen(point, capture)
      }
    }
    // Resolve every target before sending even the first mouse event.
    const steps = answer.answers.map((key) => resolve('answer', key))
    if (answer.next.required) steps.push(resolve('next'))
    return steps
  }
}
