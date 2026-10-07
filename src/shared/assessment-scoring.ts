export const ASSESSMENT_SCORE_MIN = 0
export const ASSESSMENT_SCORE_MAX = 10000

export interface AssessmentOptionScore {
  text: string
  score: number
  source: 'history' | 'current'
}

export interface AssessmentScoringResult {
  options: Record<string, AssessmentOptionScore>
  most: string
  least: string
}
