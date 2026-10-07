import { ModelResultValidationError } from '../model-result-retry'
import {
  ASSESSMENT_SCORE_MIN,
  ASSESSMENT_SCORE_MAX,
  type AssessmentScoringResult
} from '../../shared/assessment-scoring'
import { normalizeScoreText, type ScoreSnapshot } from './score-memory-service'

export interface ScoreDecision {
  answers: string[]
  additions: Map<string, number>
  scoring: AssessmentScoringResult
  notices: string[]
}

/** Pure scoring decisions; no state mutation, model requests, or mouse input. */
export class AssessmentScoreDecision {
  decide(
    options: Record<string, { text: string }>,
    newScores: Record<string, number>,
    snapshot: ScoreSnapshot
  ): ScoreDecision {
    const letters = Object.keys(options).sort()
    if (letters.length < 2 || letters.length > 26)
      throw new ModelResultValidationError('最符合／最不符合模式需要至少两个、最多 26 个选项')
    for (const [letter, score] of Object.entries(newScores)) {
      if (!Object.hasOwn(options, letter))
        throw new ModelResultValidationError(`评分引用了不存在的选项 ${letter}`)
      if (!Number.isInteger(score) || score < ASSESSMENT_SCORE_MIN || score > ASSESSMENT_SCORE_MAX)
        throw new ModelResultValidationError(`选项 ${letter} 的评分必须是 0～10000 的整数`)
    }
    const additions = new Map<string, number>()
    const notices: string[] = []
    // Gather all new scores first so identical descriptions share a single entry.
    for (const letter of letters) {
      const text = normalizeScoreText(options[letter].text)
      if (!text) throw new ModelResultValidationError(`选项 ${letter} 没有有效文字`)
      const score = newScores[letter]
      if (snapshot.scores.has(text)) {
        if (score !== undefined && score !== snapshot.scores.get(text))
          notices.push(`选项 ${letter} 已采用历史评分，忽略本轮重复评分`)
      } else if (score !== undefined) {
        if (additions.has(text) && additions.get(text) !== score)
          throw new ModelResultValidationError('相同选项文字的新评分不一致')
        additions.set(text, score)
      }
    }
    const combined = new Map([...snapshot.scores, ...additions])
    const order = new Map(Array.from(combined.keys(), (key, index) => [key, index]))
    const rows = letters.map((answer) => {
      const text = normalizeScoreText(options[answer].text)
      const score = combined.get(text)
      if (score === undefined)
        throw new ModelResultValidationError(`新选项 ${answer} 缺少评分，请让模型为全部新选项评分`)
      return {
        answer,
        text,
        score,
        order: order.get(text)!,
        source: snapshot.scores.has(text) ? ('history' as const) : ('current' as const)
      }
    })
    const ranked = [...rows].sort(
      (a, b) => b.score - a.score || a.order - b.order || a.answer.localeCompare(b.answer)
    )
    const most = ranked[0].answer
    const least = ranked.at(-1)!.answer
    return {
      answers: [most, least],
      additions,
      notices,
      scoring: {
        most,
        least,
        options: Object.fromEntries(
          rows.map(({ answer, text, score, source }) => [answer, { text, score, source }])
        )
      }
    }
  }
}
