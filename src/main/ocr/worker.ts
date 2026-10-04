import type { OcrWorkerReply, OcrWorkerRequest } from '../../shared/ocr'
import { inspectOcrPng } from './image'

const parent = process.parentPort
if (!parent) throw new Error('OCR must run inside an Electron utility process')
const modelDirectory = process.argv[2]
let loaded = false
let busy = false
const send = (message: OcrWorkerReply): void => parent.postMessage(message)

parent.on('message', async ({ data }: { data: OcrWorkerRequest }) => {
  if (busy) {
    send({ type: 'error', id: data.id, error: 'OCR 正在识别，请稍后重试' })
    return
  }
  busy = true
  try {
    inspectOcrPng(data.png)
    const { loadEngine, recognizePng } = await import('./engine')
    if (!loaded) {
      send({ type: 'loading', id: data.id })
      await loadEngine(modelDirectory)
      loaded = true
    }
    send({ type: 'recognizing', id: data.id })
    const result = await recognizePng(data.id, data.png)
    send({
      type: 'result',
      id: data.id,
      result,
      memoryMiB: Math.round(process.memoryUsage().rss / 1024 / 1024)
    })
  } catch (error) {
    send({
      type: 'error',
      id: data.id,
      error: error instanceof Error ? error.message : String(error)
    })
  } finally {
    busy = false
  }
})
send({ type: 'online' })
