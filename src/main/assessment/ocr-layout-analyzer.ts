import type { AssessmentRegion, Box, OcrLayout, OptionCandidate } from '../../shared/assessment'
import type { OcrResult } from '../../shared/ocr'
import { GROUPING } from './grouping-config'

export const NEXT_TEXT = /^(?:下一步|下一题|继续|next|continue)[\s>›»→]*$/i
export const NAV_TEXT =
  /^[<‹←\s]*(?:交卷|提交(?:答案|本题|子卷|试卷|答卷)?|退出(?:答题|考试)?|返回(?:顶部|首页)?|答题卡[√✓]?|顶部|夜间|单题|上一题|上一页)$/

export function optionLabel(text: string): string | undefined {
  return text
    .trim()
    .match(/^(?:[（(]([A-Z])[）)]|([A-Z])(?:[）)、．]|\.(?=\s|[\u3400-\u9fff]))|([A-Z])$)/)
    ?.slice(1)
    .find(Boolean)
}

export function stripOptionLabel(text: string): string {
  return text
    .trim()
    .replace(/^(?:[（(][A-Z][）)]|[A-Z](?:[）)、．]|\.(?=\s|[\u3400-\u9fff])))\s*/, '')
}

export function validBox(box: Box, width: number, height: number): boolean {
  return (
    Object.values(box).every(Number.isFinite) &&
    box.left >= 0 &&
    box.top >= 0 &&
    box.right > box.left &&
    box.bottom > box.top &&
    box.right <= width &&
    box.bottom <= height
  )
}

export function isContinuation(a: AssessmentRegion, b: AssessmentRegion): boolean {
  const h = Math.max(a.box.bottom - a.box.top, b.box.bottom - b.box.top)
  const gap = b.box.top - a.box.bottom
  const overlap = Math.max(0, Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left))
  const width = Math.min(a.box.right - a.box.left, b.box.right - b.box.left)
  return (
    !optionLabel(b.text) &&
    gap >= -h * GROUPING.verticalOverlap &&
    gap <= h * GROUPING.continuationGap &&
    Math.abs(a.box.left - b.box.left) <= h * GROUPING.continuationIndent &&
    overlap / width >= GROUPING.horizontalOverlap
  )
}

export class OcrLayoutAnalyzer {
  analyze(ocr: OcrResult, size: { width: number; height: number }): OcrLayout {
    if (ocr.imageSize.width !== size.width || ocr.imageSize.height !== size.height) {
      throw new Error('OCR 图片尺寸与当前截图不一致')
    }
    const regions: AssessmentRegion[] = ocr.regions.map((region, index) => {
      if (!validBox(region.box, size.width, size.height)) throw new Error('OCR 返回了无效文字框')
      return {
        id: `r${String(index + 1).padStart(3, '0')}`,
        text: region.text,
        score: region.score,
        box: region.box
      }
    })
    const sorted = [...regions].sort((a, b) => a.box.top - b.box.top || a.box.left - b.box.left)
    const body = sorted.filter(
      (r) => !NEXT_TEXT.test(r.text.trim()) && !NAV_TEXT.test(r.text.trim())
    )
    if (!body.length) throw new Error('OCR 过滤后没有可用题目文字，请调整边缘过滤或截图范围')
    const starts = body.filter((r) =>
      /^(?:第\s*[\d一二三四五六七八九十]+\s*题|\d+[.、．](?!\d)\s*\S)/.test(r.text.trim())
    )
    // Numbered stems delimit independent question blocks. Without one, ask the model
    // to confirm the single visible block rather than inventing question boundaries.
    const anchors = starts.length ? starts : [body[0]]
    const blocks = anchors.map((anchor, index) => {
      const h = anchor.box.bottom - anchor.box.top
      const bottom = anchors[index + 1]?.box.top ?? size.height
      const rows = body.filter(
        (r) =>
          r.box.top >= anchor.box.top &&
          r.box.top < bottom &&
          (!starts.length ||
            (r.box.left >= anchor.box.left - 2 * h && r.box.left <= anchor.box.left + 4 * h))
      )
      return { id: `q${String(index + 1).padStart(3, '0')}`, regionIds: rows.map((r) => r.id) }
    })
    const candidates: OptionCandidate[] = []
    for (const block of blocks) {
      const blockRows = sorted.filter((r) => block.regionIds.includes(r.id))
      const heights = blockRows.map((r) => r.box.bottom - r.box.top).sort((a, b) => a - b)
      const typicalHeight = heights[Math.floor(heights.length / 2)] ?? 1
      // A tiny radio/icon misread as "3" must not split two SQL continuation lines.
      // Keep it in raw debug regions, but never treat it as an option/body candidate.
      const rows = blockRows.filter(
        (r) =>
          !(/^[\d○◯□●✓√]$/.test(r.text.trim()) && r.box.bottom - r.box.top < typicalHeight * 0.65)
      )
      block.regionIds = rows.map((r) => r.id)
      const consumed = new Set<string>()
      const lines: Array<{ body: AssessmentRegion; members: AssessmentRegion[]; label?: string }> =
        []
      // Pair a detached label before sorting lines: its box can start a few pixels
      // below the body, so processing top-to-bottom first would lose the pairing.
      for (const label of rows.filter((r) => /^[A-Z]$/.test(r.text.trim()))) {
        const height = label.box.bottom - label.box.top
        const neighbors = rows.filter(
          (r) =>
            !consumed.has(r.id) &&
            !optionLabel(r.text) &&
            r.box.left >= label.box.right &&
            r.box.left - label.box.right <= 3 * height &&
            Math.abs((r.box.top + r.box.bottom - label.box.top - label.box.bottom) / 2) <=
              height * GROUPING.rowCenterTolerance
        )
        if (neighbors.length !== 1) continue
        const body = neighbors[0]
        consumed.add(label.id)
        consumed.add(body.id)
        lines.push({ body, members: [label, body], label: label.text.trim() })
      }
      for (const row of rows)
        if (!consumed.has(row.id)) {
          lines.push({ body: row, members: [row], label: optionLabel(row.text) })
        }
      lines.sort((a, b) => a.body.box.top - b.body.box.top || a.body.box.left - b.body.box.left)
      let previous: AssessmentRegion | undefined
      let group: OptionCandidate | undefined
      for (const line of lines) {
        if (!group || !previous || line.label || !isContinuation(previous, line.body)) {
          group = {
            id: `g${String(candidates.length + 1).padStart(3, '0')}`,
            questionBlockId: block.id,
            regionIds: [],
            joinedText: '',
            labelHint: line.label
          }
          candidates.push(group)
        }
        group.regionIds.push(...line.members.map((r) => r.id))
        group.joinedText +=
          (group.joinedText ? '\n' : '') + line.members.map((r) => r.text).join(' ')
        previous = line.body
      }
    }
    return { regions, blocks, candidates, filter: ocr.filter, elapsedMs: ocr.elapsedMs }
  }
}
