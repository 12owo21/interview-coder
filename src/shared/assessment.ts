import type { OcrResult } from './ocr'
import type { AssessmentScoringResult } from './assessment-scoring'

export type Point = { x: number; y: number }
export type Box = { left: number; top: number; right: number; bottom: number }
export type AssessmentStrategy = 'fixed' | 'ocr' | 'model'
export type AssessmentPhase =
  | 'idle'
  | 'capturing'
  | 'recognizing'
  | 'analyzing'
  | 'validating'
  | 'locating'
  | 'clicking'
  | 'waiting'
  | 'refreshing'
  | 'stopping'
  | 'error'

export interface AssessmentRegion {
  id: string
  text: string
  score: number
  box: Box
}

export interface OcrLayout {
  regions: AssessmentRegion[]
  filter?: OcrResult['filter']
  elapsedMs: number
}

export interface ClickStep {
  kind: 'answer' | 'next'
  answer?: string
  source: AssessmentStrategy
  regionId?: string
  imagePoint?: Point
  screenPoint: Point
}

export interface AssessmentResult {
  scoring?: AssessmentScoringResult
  raw: string
  question: string
  optionTexts: Record<string, string>
  answer: string
  answers: string[]
  confirmedSelectedAnswers?: string[]
  notices?: string[]
  options: Record<string, Point>
  next: { required: boolean; point: Point } | null
  imageSize: { width: number; height: number }
  fullImageSize: { width: number; height: number }
  physicalScreenSize: { width: number; height: number }
  captureOffset: Point
  captureId: string
  strategy: AssessmentStrategy
  execution: 'preview' | 'planned' | 'executed' | 'partial'
  executedSteps: number
  plan: ClickStep[]
  timings: { ocrMs: number; aiMs: number; clickMs: number; totalMs: number }
}

export interface AssessmentDebug {
  captureId: string
  imageSize: { width: number; height: number }
  image?: string
  layout: OcrLayout
  optionRegions?: Record<string, string[]>
  questionRegionIds?: string[]
  nextRegionId?: string
  points?: Array<{ label: string; point: Point }>
}

export interface AssessmentSnapshot {
  revision: number
  runId?: string
  busy: boolean
  looping: boolean
  phase: AssessmentPhase
  raw: string
  error: string | null
  notice: string
  result: AssessmentResult | null
  debug: AssessmentDebug | null
}

export const ASSESSMENT_PHASE_LABELS: Record<AssessmentPhase, string> = {
  idle: '待命',
  capturing: '截图中',
  recognizing: 'OCR 识别中',
  analyzing: 'AI 分析中',
  validating: '校验答案',
  locating: '解析点击位置',
  clicking: '执行点击',
  waiting: '等待下一题',
  refreshing: '等待重新截屏识别',
  stopping: '正在停止，等待当前操作结束',
  error: '已停止：需要处理'
}
