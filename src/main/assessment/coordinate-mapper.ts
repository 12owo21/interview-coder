import { ModelResultValidationError } from '../model-result-retry'
import type { Point } from '../../shared/assessment'
import type { ScreenshotCapture } from '../take-screenshot'

export function validateScreenPoint(point: Point): Point {
  if (
    !point ||
    !Number.isInteger(point.x) ||
    !Number.isInteger(point.y) ||
    point.x < 0 ||
    point.y < 0
  ) {
    throw new Error('点击位置无效：当前仅支持非负整数屏幕坐标')
  }
  return point
}

export function imageToScreen(point: Point, capture: ScreenshotCapture): Point {
  if (
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    point.x < 0 ||
    point.y < 0 ||
    point.x >= capture.imageWidth ||
    point.y >= capture.imageHeight
  )
    throw new ModelResultValidationError('点击位置超出截图范围')
  if (
    ![capture.fullWidth, capture.fullHeight, capture.physicalWidth, capture.physicalHeight].every(
      (n) => Number.isFinite(n) && n > 0
    )
  ) {
    throw new Error('截图坐标元数据无效')
  }
  return validateScreenPoint({
    x: Math.round(
      ((point.x + capture.offsetX) * capture.physicalWidth) / capture.fullWidth + capture.originX
    ),
    y: Math.round(
      ((point.y + capture.offsetY) * capture.physicalHeight) / capture.fullHeight + capture.originY
    )
  })
}
