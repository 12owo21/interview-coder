import type { ParsedAssessment } from './types'
import type { PageIdentity } from './retry-session'
import { AssessmentUncertainError, type AssessmentRecovery } from './recovery'
import { normalizeScoreText } from './score-memory-service'

/** Moving a selected card must not turn the remaining cards into a new question. */
export function validateScoreRecovery(
  parsed: ParsedAssessment,
  recovery: AssessmentRecovery | undefined,
  identity: PageIdentity
): void {
  if (!recovery) return
  if (identity.progress && recovery.progress && identity.progress !== recovery.progress) return
  const previous = Object.values(recovery.options).map(normalizeScoreText).sort()
  const current = Object.values(parsed.options)
    .map((o) => normalizeScoreText(o.text))
    .sort()
  const remaining = [...previous]
  const subset = current.every((text) => {
    const index = remaining.indexOf(text)
    if (index < 0) return false
    remaining.splice(index, 1)
    return true
  })
  if (subset && current.length < previous.length)
    throw new AssessmentUncertainError(
      '请包含已移动到最符合／最不符合容器中的选项，不能只返回剩余卡片'
    )
  if (subset && parsed.selectedAnswers?.length && new Set(current).size !== current.length)
    throw new AssessmentUncertainError('重复选项文字无法唯一对应已选位置，请重新确认')
}
