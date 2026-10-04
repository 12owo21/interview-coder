import type { ParsedAssessment } from './types'
import type { ClickStep } from '../../shared/assessment'

/** Transient execution context, independent from personality memory. Never contains old coordinates. */
export interface AssessmentRecovery {
  question: string
  options: Record<string, string>
  intendedAnswers: string[]
  executedAnswers: string[]
}

export class AssessmentPageChangedError extends Error {
  recovery?: AssessmentRecovery

  constructor(message = '题目或待点击区域发生变化') {
    super(message)
    this.name = 'AssessmentPageChangedError'
  }
}

export class AssessmentUncertainError extends AssessmentPageChangedError {
  constructor(reason: string) {
    super(`AI 无法确认：${reason}`)
  }
}

/** Only current-image selections confirmed by the model may be skipped. */
export function remainingAnswerSteps(
  plan: ClickStep[],
  parsed: ParsedAssessment,
  recovery?: AssessmentRecovery
): ClickStep[] {
  if (!recovery) return plan
  if (!parsed.selectedAnswers) throw new AssessmentUncertainError('缺少当前已选答案，本次不点击')
  if (parsed.selectedAnswers.some((key, index) => parsed.answers[index] !== key))
    throw new AssessmentUncertainError('当前已选答案与计划顺序不一致，本次不点击')
  const selected = new Set(parsed.selectedAnswers)
  return plan.filter((step) => step.kind !== 'answer' || !selected.has(step.answer!))
}
