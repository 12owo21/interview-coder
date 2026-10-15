import type { Point } from '../shared/assessment'
import type { MouseMoveOptions } from './mouse/movement'
import { WindowsMouseInput } from './mouse/windows-input'

export type ScreenPoint = Point
const mouse = new WindowsMouseInput()

export function clickScreenPoint(point: ScreenPoint, options?: MouseMoveOptions): Promise<void> {
  return mouse.execute(point, true, options)
}

/** Movement only. It never presses a mouse button. */
export function moveScreenPoint(point: ScreenPoint, options?: MouseMoveOptions): Promise<void> {
  return mouse.execute(point, false, options)
}
