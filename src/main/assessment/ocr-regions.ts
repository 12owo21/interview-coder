import type { Box, OcrLayout } from '../../shared/assessment'
import type { OcrResult } from '../../shared/ocr'
import { filterAssessmentOcrRegions } from './ocr-filter'

export function stripOptionLabel(text: string): string {
  return text
    .trim()
    .replace(/^(?:[（(][A-Z][）)]|[A-Z](?:[）)、．]|\.(?=\s|[\u3400-\u9fff])))\s*/, '')
}

export function validBox(box: Box, width: number, height: number): boolean {
  return (
    [box.left, box.top, box.right, box.bottom].every(Number.isFinite) &&
    box.left >= 0 &&
    box.top >= 0 &&
    box.right > box.left &&
    box.bottom > box.top &&
    box.right <= width &&
    box.bottom <= height
  )
}

/** Prepare references only; question boundaries and option grouping belong to the model. */
export class AssessmentOcrPreparer {
  prepare(ocr: OcrResult, size: { width: number; height: number }): OcrLayout {
    if (ocr.imageSize.width !== size.width || ocr.imageSize.height !== size.height)
      throw new Error('OCR 图片尺寸与当前截图不一致')
    const regions = ocr.regions.map((region, index) => {
      if (!validBox(region.box, size.width, size.height)) throw new Error('OCR 返回了无效文字框')
      return {
        id: `r${String(index + 1).padStart(3, '0')}`,
        text: region.text,
        score: region.score,
        box: { ...region.box }
      }
    })
    const filtered = filterAssessmentOcrRegions(regions)
    if (!filtered.length) throw new Error('OCR 没有可用文字，请检查截图范围与边缘过滤设置')
    return { regions: filtered, filter: ocr.filter, elapsedMs: ocr.elapsedMs }
  }
}
