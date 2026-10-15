import type { Point } from '../../shared/assessment'

export interface MouseFrame extends Point {
  /** Milliseconds from the beginning of the movement. */
  atMs: number
}

/** Pure path planning; algorithms do not inject OS input. */
export interface MouseMovementAlgorithm {
  createPath(start: Point, target: Point): MouseFrame[]
}

export interface MouseMoveOptions {
  smooth?: boolean
  signal?: AbortSignal
}
