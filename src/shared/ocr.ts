export type LocalOcrState =
  | 'starting'
  | 'standby'
  | 'loading'
  | 'recognizing'
  | 'ready'
  | 'sleeping'
  | 'error'
  | 'stopped'

export interface LocalOcrStatus {
  state: LocalOcrState
  modelLoaded: boolean
  pid?: number
  memoryMiB?: number
  error?: string
  idleReleaseMs: number
}

export interface OcrResult {
  requestId: string
  imageSize: { width: number; height: number }
  coordinateSpace: 'input-image'
  regions: Array<{
    text: string
    score: number
    points: [number, number][]
    box: { left: number; top: number; right: number; bottom: number }
  }>
  elapsedMs: number
  filter?: {
    margins: OcrFilterMargins
    originalCount: number
    removedCount: number
    emptyArea: boolean
  }
}

export interface OcrFilterMargins {
  top: number
  bottom: number
  left: number
  right: number
}

export const DEFAULT_OCR_FILTER_MARGINS: Readonly<OcrFilterMargins> = {
  top: 100,
  bottom: 100,
  left: 100,
  right: 100
}

/** Invalid or missing persisted fields fall back independently; zero disables an edge. */
export function normalizeOcrFilterMargins(value: unknown): OcrFilterMargins {
  const source = value && typeof value === 'object' ? value : {}
  const result = { ...DEFAULT_OCR_FILTER_MARGINS }
  for (const edge of ['top', 'bottom', 'left', 'right'] as const) {
    const pixels = source[edge as keyof typeof source]
    if (typeof pixels === 'number' && Number.isSafeInteger(pixels) && pixels >= 0) {
      result[edge] = pixels
    }
  }
  return result
}

/** Filter by box center without cropping images or shifting retained coordinates. */
export function filterOcrResult(result: OcrResult, value: unknown): OcrResult {
  const margins = normalizeOcrFilterMargins(value)
  const right = result.imageSize.width - margins.right
  const bottom = result.imageSize.height - margins.bottom
  const emptyArea = margins.left >= right || margins.top >= bottom
  const regions = emptyArea
    ? []
    : result.regions.filter(({ box }) => {
        const x = (box.left + box.right) / 2
        const y = (box.top + box.bottom) / 2
        return x >= margins.left && x < right && y >= margins.top && y < bottom
      })
  return {
    ...result,
    regions,
    filter: {
      margins,
      originalCount: result.regions.length,
      removedCount: result.regions.length - regions.length,
      emptyArea
    }
  }
}

export type OcrWorkerRequest = { id: string; png: Uint8Array }
export type OcrWorkerReply =
  | { type: 'online' }
  | { type: 'loading'; id: string }
  | { type: 'recognizing'; id: string }
  | { type: 'result'; id: string; result: OcrResult; memoryMiB: number }
  | { type: 'error'; id: string; error: string }
