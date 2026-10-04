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
        const candidates = layout!.regions
          .filter((r) => item.regionIds?.includes(r.id) && !/^[A-Z]$/.test(r.text.trim()))
          .sort((a, b) => a.box.top - b.box.top || a.box.left - b.box.left)
        const region = candidates[0]
        if (!region || region.score < 0.8)
          throw new Error(`无法可靠定位${key ?? '下一步'}，文字框置信度不足`)
        regionId = region.id
        point = {
          x: (region.box.left + region.box.right) / 2,
          y: (region.box.top + region.box.bottom) / 2
        }
      }
      if (!point) throw new Error('缺少点击位置')
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
