import type { ClickStep, Point } from '../../shared/assessment'
import { checkAborted, wait } from './wait'

export class AssessmentClickExecutor {
  constructor(
    private readonly click: (point: Point) => Promise<void>,
    private readonly delay = wait
  ) {}

  async execute(
    steps: ClickStep[],
    signal: AbortSignal,
    beforeStep: (index: number) => Promise<void>,
    onExecuted: (count: number) => void
  ): Promise<void> {
    for (let i = 0; i < steps.length; i++) {
      checkAborted(signal)
      if (i) await this.delay(500, signal)
      await beforeStep(i)
      checkAborted(signal)
      await this.click(steps[i].screenPoint)
      // Record an OS operation even if cancellation arrived while it was running.
      onExecuted(i + 1)
      checkAborted(signal)
    }
  }
}
