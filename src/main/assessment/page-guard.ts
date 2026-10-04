import { nativeImage } from 'electron'
import type { Box } from '../../shared/assessment'
import type { ScreenshotCapture } from '../take-screenshot'
import type { CaptureFunction, GuardSession } from './types'
import type { CaptureRegion } from '../../shared/capture-region'
import { checkAborted } from './wait'

export function changedPixelRatio(before: Uint8Array, after: Uint8Array): number {
  if (before.length !== after.length || !before.length) return 1
  let changed = 0
  for (let i = 0; i < before.length; i += 4) {
    const a = (before[i] + before[i + 1] + before[i + 2]) / 3
    const b = (after[i] + after[i + 1] + after[i + 2]) / 3
    if (Math.abs(a - b) > 20) changed++
  }
  return changed / (before.length / 4)
}

export class AssessmentPageGuard {
  constructor(private readonly capture: CaptureFunction) {}

  prepare(
    original: ScreenshotCapture,
    captureRegion: CaptureRegion | null,
    anchors: Box[]
  ): GuardSession {
    const originalImage = nativeImage.createFromBuffer(Buffer.from(original.data, 'base64'))
    return {
      check: async (remaining, signal) => {
        checkAborted(signal)
        if (Date.now() - original.capturedAt > 60000)
          throw new Error('截图已超过 60 秒，请重新开始做题')
        const current = await this.capture({ captureScreen: original.displayId, captureRegion })
        checkAborted(signal)
        if (!current) throw new Error('无法复查当前页面，已停止点击')
        const fields = [
          'displayId',
          'imageWidth',
          'imageHeight',
          'fullWidth',
          'fullHeight',
          'physicalWidth',
          'physicalHeight',
          'originX',
          'originY',
          'offsetX',
          'offsetY'
        ] as const
        if (fields.some((field) => original[field] !== current[field]))
          throw new Error('截图目标或屏幕尺寸发生变化，请重新开始')
        const currentImage = nativeImage.createFromBuffer(Buffer.from(current.data, 'base64'))
        for (const box of [...anchors, ...remaining]) {
          const rect = {
            x: Math.max(0, Math.floor(box.left)),
            y: Math.max(0, Math.floor(box.top)),
            width:
              Math.min(original.imageWidth, Math.ceil(box.right)) -
              Math.max(0, Math.floor(box.left)),
            height:
              Math.min(original.imageHeight, Math.ceil(box.bottom)) -
              Math.max(0, Math.floor(box.top))
          }
          if (rect.width <= 0 || rect.height <= 0) throw new Error('页面检查范围无效')
          const width = Math.min(640, rect.width)
          const before = originalImage.crop(rect).resize({ width }).toBitmap()
          const after = currentImage.crop(rect).resize({ width }).toBitmap()
          if (changedPixelRatio(before, after) > 0.02)
            throw new Error('题目或待点击区域发生变化，已停止旧坐标点击')
        }
      }
    }
  }
}
