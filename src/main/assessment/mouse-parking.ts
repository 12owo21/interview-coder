import { isMouseParkingRegion, type MouseParkingRegion } from '../../shared/mouse-parking'
import type { Point } from '../../shared/assessment'
import type { ScreenshotCapture } from '../take-screenshot'

/** Choose a region uniformly, then an inset point. Coordinates are already physical pixels. */
export function randomParkingPoint(
  regions: MouseParkingRegion[] | null | undefined,
  capture: ScreenshotCapture,
  random: () => number = Math.random
): Point {
  if (!Array.isArray(regions) || !regions.length)
    throw new Error('请先在设置 → 做题模式中输入并保存鼠标停放区域')
  if (
    ![capture.physicalWidth, capture.physicalHeight].every(
      (n) => Number.isSafeInteger(n) && n > 0
    ) ||
    ![capture.originX, capture.originY].every((n) => Number.isSafeInteger(n) && n >= 0)
  )
    throw new Error('当前鼠标停放仅支持非负坐标屏幕，请检查屏幕布局')
  for (const [index, region] of regions.entries()) {
    if (!isMouseParkingRegion(region))
      throw new Error(`鼠标停放区域 ${index + 1} 无效：请输入非负整数，右下角必须在左上角的右下方`)
    if (
      region.left < capture.originX ||
      region.top < capture.originY ||
      region.right >= capture.originX + capture.physicalWidth ||
      region.bottom >= capture.originY + capture.physicalHeight
    )
      throw new Error(`鼠标停放区域 ${index + 1} 超出本轮答题屏幕，请检查坐标或截图屏幕`)
  }
  const region = regions[Math.floor(random() * regions.length)]
  const sample = (first: number, last: number): number => {
    const padding = Math.min(8, Math.floor((last - first) / 4))
    return first + padding + Math.floor(random() * (last - first - 2 * padding + 1))
  }
  return {
    x: sample(region.left, region.right),
    y: sample(region.top, region.bottom)
  }
}
