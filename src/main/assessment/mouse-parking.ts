import type { CaptureRegion } from '../../shared/capture-region'
import type { Point } from '../../shared/assessment'
import type { ScreenshotCapture } from '../take-screenshot'

/** Resolve against this round's full screen, never against the cropped image. */
export function randomParkingPoint(
  region: CaptureRegion | null | undefined,
  capture: ScreenshotCapture,
  random: () => number = Math.random
): Point {
  if (!region) throw new Error('请先在设置 → 做题模式中框选鼠标停放区域')
  if (region.displayId !== capture.displayId) {
    throw new Error('鼠标停放区域必须与本轮答题屏幕相同，请重新框选或修改截图屏幕')
  }
  const { x, y, width, height } = region
  if (
    ![x, y, width, height].every(Number.isFinite) ||
    x < 0 ||
    y < 0 ||
    width <= 0 ||
    height <= 0 ||
    x + width > 1 + 1e-9 ||
    y + height > 1 + 1e-9
  )
    throw new Error('鼠标停放区域无效，请重新框选')
  if (
    ![capture.physicalWidth, capture.physicalHeight].every(
      (n) => Number.isSafeInteger(n) && n > 0
    ) ||
    ![capture.originX, capture.originY].every((n) => Number.isSafeInteger(n) && n >= 0)
  )
    throw new Error('当前鼠标停放仅支持非负坐标屏幕，请检查屏幕布局')
  const sample = (fraction: number, size: number, total: number): number => {
    const first = Math.ceil(fraction * total)
    const last = Math.min(total - 1, Math.ceil((fraction + size) * total) - 1)
    if (last < first) throw new Error('鼠标停放区域过小，请重新框选')
    const padding = Math.min(8, Math.floor((last - first) / 4))
    return first + padding + Math.floor(random() * (last - first - 2 * padding + 1))
  }
  return {
    x: capture.originX + sample(x, width, capture.physicalWidth),
    y: capture.originY + sample(y, height, capture.physicalHeight)
  }
}
