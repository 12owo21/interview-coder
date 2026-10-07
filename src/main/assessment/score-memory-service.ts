import { randomUUID } from 'node:crypto'
import { ASSESSMENT_SCORE_MIN, ASSESSMENT_SCORE_MAX } from '../../shared/assessment-scoring'
import { stripOptionLabel } from './ocr-regions'

export function normalizeScoreText(text: string): string {
  return stripOptionLabel(text.normalize('NFKC')).replace(/\s+/g, ' ').trim()
}

export interface ScoreSnapshot {
  sessionId: string | null
  revision: number
  scores: ReadonlyMap<string, number>
  context: string
}

/** Session-scoped, append-only preferences; these are not successful answer records. */
export class AssessmentScoreMemoryService {
  private enabled = false
  private personality = ''
  private sessionId: string | null = null
  private revision = 0
  private scores = new Map<string, number>()

  configure(enabled: boolean, personality: string): boolean {
    const modeChanged = this.enabled !== enabled
    if (!modeChanged && (!enabled || this.personality === personality)) return false
    this.enabled = enabled
    this.personality = personality
    this.reset()
    return modeChanged
  }

  reset(): void {
    this.revision++
    this.sessionId = this.enabled ? randomUUID() : null
    this.scores.clear()
  }

  snapshot(): ScoreSnapshot {
    return {
      sessionId: this.sessionId,
      revision: this.revision,
      scores: new Map(this.scores),
      context: Array.from(this.scores, (entry) => JSON.stringify(entry)).join('\n')
    }
  }

  commit(additions: ReadonlyMap<string, number>, snapshot: ScoreSnapshot): void {
    if (
      !this.enabled ||
      snapshot.sessionId !== this.sessionId ||
      snapshot.revision !== this.revision
    )
      throw new Error('评分会话已改变，请重新开始做题')
    // Validate the entire batch before modifying any entry.
    for (const [text, score] of additions) {
      if (
        !text ||
        normalizeScoreText(text) !== text ||
        !Number.isInteger(score) ||
        score < ASSESSMENT_SCORE_MIN ||
        score > ASSESSMENT_SCORE_MAX
      )
        throw new Error('评分记录无效')
      if (this.scores.has(text) && this.scores.get(text) !== score)
        throw new Error('评分记录发生冲突，请重新分析')
    }
    for (const [text, score] of additions) {
      if (!this.scores.has(text)) this.scores.set(text, score)
    }
    this.revision++
  }
}
