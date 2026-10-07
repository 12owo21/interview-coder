import {
  AssessmentMemoryService,
  type AssessmentMemoryInput,
  type AssessmentMemoryRecord
} from './assessment/memory-service'
import { AssessmentScoreMemoryService } from './assessment/score-memory-service'

export type { AssessmentMemoryInput, AssessmentMemoryRecord }
export type AnswerLetter = string
export const assessmentMemory = new AssessmentMemoryService()
export const assessmentScoreMemory = new AssessmentScoreMemoryService()

export function setAssessmentMemoryEnabled(enabled: boolean): void {
  assessmentMemory.configure(enabled)
}
export function getAssessmentMemoryContext(): string {
  return assessmentMemory.snapshot().context
}
export function addAssessmentMemory(input: AssessmentMemoryInput): AssessmentMemoryRecord | null {
  return assessmentMemory.commit(input)
}
