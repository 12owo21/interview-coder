import type { ClickStep, Point } from '../../shared/assessment'
import { checkAborted, wait } from './wait'
import type { MouseMoveOptions } from '../mouse/movement'

export class AssessmentClickExecutor {
  constructor(
    private readonly click: (point: Point, options?: MouseMoveOptions) => Promise<void>,
    private readonly delay = wait,
    private readonly move?: (point: Point, options?: MouseMoveOptions) => Promise<void>
  ) {}

  async execute(
    steps: ClickStep[],
    signal: AbortSignal,
    beforeStep: (index: number) => Promise<void>,
    onExecuted: (count: number) => void,
    smooth = false
  ): Promise<void> {
    for (let i = 0; i < steps.length; i++) {
      checkAborted(signal)
      if (i) await this.delay(500, signal)
      await beforeStep(i)
      checkAborted(signal)
      await this.click(steps[i].screenPoint, { smooth, signal })
      // Record an OS operation even if cancellation arrived while it was running.
      onExecuted(i + 1)
      checkAborted(signal)
    }
  }

  async park(point: Point, signal: AbortSignal, smooth: boolean): Promise<void> {
    checkAborted(signal)
    if (!this.move) throw new Error('鼠标移动接口未配置')
    await this.move(point, { smooth, signal })
    checkAborted(signal)
  }
}
