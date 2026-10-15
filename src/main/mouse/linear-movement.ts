import type { Point } from '../../shared/assessment'
import type { MouseFrame, MouseMovementAlgorithm } from './movement'

/** A straight path with acceleration and deceleration, ending at the exact target. */
export class LinearMouseMovement implements MouseMovementAlgorithm {
  createPath(start: Point, target: Point): MouseFrame[] {
    const distance = Math.hypot(target.x - start.x, target.y - start.y)
    if (!distance) return [{ ...target, atMs: 0 }]
    const duration = Math.round(Math.min(600, Math.max(180, distance * 0.5)))
    const steps = Math.ceil(duration / 16)
    return Array.from({ length: steps }, (_, index) => {
      const t = (index + 1) / steps
      const progress = t * t * (3 - 2 * t)
      return {
        x: Math.round(start.x + (target.x - start.x) * progress),
        y: Math.round(start.y + (target.y - start.y) * progress),
        atMs: Math.round(t * duration)
      }
    })
  }
}
