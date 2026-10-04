import { join } from 'node:path'
import type { PaddleOcrService } from 'ppu-paddle-ocr'
import type { OcrResult } from '../../shared/ocr'
import { inspectOcrPng } from './image'

let engine: PaddleOcrService | undefined

export async function loadEngine(modelDirectory: string): Promise<void> {
  if (engine) return
  // Import only on the first request: native libraries and OpenCV are not needed at startup.
  const { PaddleOcrService } = await import('ppu-paddle-ocr')
  const candidate = new PaddleOcrService({
    model: {
      detection: join(modelDirectory, 'det.onnx'),
      recognition: join(modelDirectory, 'rec.onnx'),
      charactersDictionary: join(modelDirectory, 'keys.txt')
    },
    session: {
      executionProviders: ['cpu'],
      executionMode: 'sequential',
      intraOpNumThreads: 2,
      interOpNumThreads: 1,
      enableCpuMemArena: false,
      enableMemPattern: false,
      graphOptimizationLevel: 'all'
    },
    detection: { maxSideLength: 1280 },
    recognition: {
      charactersDictionary: [],
      strategy: 'per-box',
      recBatchSize: 1,
      maxCropSourceSideLength: 2560,
      minimumConfidence: 0.5
    },
    processing: { engine: 'opencv' },
    debugging: { debug: false, verbose: false }
  })
  try {
    await candidate.initialize()
    engine = candidate
  } catch (error) {
    await candidate.destroy().catch(() => undefined)
    throw error
  }
}

export async function recognizePng(id: string, png: Uint8Array): Promise<OcrResult> {
  if (!engine) throw new Error('OCR 模型尚未加载')
  const started = performance.now()
  const imageSize = inspectOcrPng(png)
  // A standalone ArrayBuffer is required by the OCR library, including after IPC cloning.
  const data = new Uint8Array(png).buffer
  const output = await engine.recognize(data, { flatten: true, noCache: true })
  if (!('results' in output)) throw new Error('OCR 返回格式错误')
  const regions: OcrResult['regions'] = []
  for (const item of output.results) {
    const { x, y, width, height } = item.box
    if (![x, y, width, height, item.confidence].every(Number.isFinite)) continue
    const left = Math.max(0, Math.min(imageSize.width, x))
    const top = Math.max(0, Math.min(imageSize.height, y))
    const right = Math.max(0, Math.min(imageSize.width, x + width))
    const bottom = Math.max(0, Math.min(imageSize.height, y + height))
    if (right <= left || bottom <= top || !item.text.trim()) continue
    regions.push({
      text: item.text,
      score: item.confidence,
      points: [
        [left, top],
        [right, top],
        [right, bottom],
        [left, bottom]
      ],
      box: { left, top, right, bottom }
    })
  }
  return {
    requestId: id,
    imageSize,
    coordinateSpace: 'input-image',
    regions,
    elapsedMs: Math.round(performance.now() - started)
  }
}
