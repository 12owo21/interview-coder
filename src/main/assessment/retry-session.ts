import type { OcrLayout } from '../../shared/assessment'
import type { ParsedAssessment } from './types'
import type { AssessmentRecovery } from './recovery'
import { stripQuestionNumber } from './memory-service'

export const MAX_ASSESSMENT_RETRIES = 3

function normalize(value: string): string {
  // Ignore cosmetic punctuation, but preserve decimal points and mathematical operators.
  return value
    .normalize('NFKC')
    .replace(/[\s，,。；;：:！？!?、…]/g, '')
    .replace(/\.{2,}/g, '')
}

function questionNumber(value: string): string | undefined {
  return value
    .normalize('NFKC')
    .match(/^(?:第\s*(\d+)\s*题|(\d+)[.、](?!\d))/)
    ?.slice(1)
    .find(Boolean)
}

export interface PageIdentity {
  content: string
  progress?: string
}

export function assessmentPageIdentity(parsed: ParsedAssessment, layout?: OcrLayout): PageIdentity {
  const rows = layout?.regions.filter((r) => parsed.questionRegionIds?.includes(r.id)) ?? []
  const body = rows.filter(
    (r) => !/^第\s*\d+\s*题\s*(?:单选题?|多选题?|判断题?|排序题?)?\s*$/.test(r.text.trim())
  )
  const question = body.length ? body.map((r) => r.text).join('') : parsed.question
  const numbers = new Set(rows.map((r) => questionNumber(r.text.trim())).filter(Boolean))
  if (!numbers.size) {
    for (const r of layout?.regions ?? []) {
      if (
        /^第\s*\d+\s*题(?:\s*[/／]\s*共\s*\d+\s*题|\s*(?:单选题?|多选题?|判断题?))/.test(
          r.text.trim()
        )
      ) {
        const number = questionNumber(r.text.trim())
        if (number) numbers.add(number)
      }
    }
  }
  return {
    content: JSON.stringify([
      normalize(stripQuestionNumber(question)),
      Object.values(parsed.options)
        .map((o) => normalize(o.text))
        .sort()
    ]),
    progress: numbers.size === 1 ? [...numbers][0] : questionNumber(parsed.question.trim())
  }
}

/** One budget for a visible question, shared by stalled navigation and changed-image recovery. */
export class AssessmentRetrySession {
  private identity?: PageIdentity
  private started = false
  private observed = false
  retryCount = 0
  memoryCommitted = false
  recovery?: AssessmentRecovery

  beginAttempt(): void {
    this.observed = false
  }

  observe(identity?: PageIdentity): boolean {
    if (this.observed) return this.retryCount > 0
    this.observed = true
    const changed =
      identity &&
      this.identity &&
      (identity.content !== this.identity.content ||
        (identity.progress !== undefined &&
          this.identity.progress !== undefined &&
          identity.progress !== this.identity.progress))
    if (!this.started || changed) {
      this.started = true
      this.retryCount = 0
      this.memoryCommitted = false
      this.recovery = undefined
      this.identity = identity
      return false
    }
    if (this.retryCount >= MAX_ASSESSMENT_RETRIES)
      throw new Error('已补充分析 3 次，页面仍为同一题或无法确认已进入新题，已停止，请检查页面')
    this.retryCount++
    if (identity)
      this.identity = { ...identity, progress: identity.progress ?? this.identity?.progress }
    return true
  }
}
