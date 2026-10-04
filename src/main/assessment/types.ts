import type { ApiProfile } from '../../shared/api-profile'
import type { CaptureRegion } from '../../shared/capture-region'
import type { OcrFilterMargins } from '../../shared/ocr'
import type { AssessmentPhase, AssessmentStrategy, Box, Point } from '../../shared/assessment'
import type { ScreenshotCapture } from '../take-screenshot'
import type { AssessmentRecovery } from './recovery'

export interface AssessmentConfig {
  profile: ApiProfile
  strategy: AssessmentStrategy
  preview: boolean
  showDebug: boolean
  margins: OcrFilterMargins
  fixedPositions: Record<string, Point | null>
  nextPosition: Point | null
  memoryEnabled: boolean
  personality: string
  captureScreen: string
  captureRegion: CaptureRegion | null
}

export interface ParsedAssessment {
  question: string
  answers: string[]
  selectedAnswers?: string[]
  notices?: string[]
  options: Record<
    string,
    { text: string; point?: Point; regionIds?: string[]; clickRegionId?: string }
  >
  questionRegionIds?: string[]
  next: { required: boolean; point?: Point; regionIds?: string[]; clickRegionId?: string }
}

export interface RunContext {
  id: string
  config: AssessmentConfig
  signal: AbortSignal
  phase: (phase: AssessmentPhase) => void
  recovery?: AssessmentRecovery
  verificationOnly?: boolean
}

export interface GuardSession {
  check: (remaining: Box[], signal: AbortSignal) => Promise<void>
}

export type CaptureFunction = (target?: {
  captureScreen: string
  captureRegion: CaptureRegion | null
}) => Promise<ScreenshotCapture | undefined>
