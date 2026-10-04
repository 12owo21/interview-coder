import { randomUUID } from 'node:crypto'
import type { AssessmentSnapshot } from '../../shared/assessment'
import type { AssessmentConfig } from './types'
import type { AssessmentRunner } from './runner'
import { checkAborted, wait } from './wait'

export class AssessmentController {
  private abort: AbortController | null = null
  private state: AssessmentSnapshot = {
    revision: 0,
    busy: false,
    looping: false,
    phase: 'idle',
    raw: '',
    error: null,
    notice: '',
    result: null,
    debug: null
  }

  constructor(
    private readonly runner: Pick<AssessmentRunner, 'run'>,
    private readonly config: () => AssessmentConfig,
    private readonly publish: (state: AssessmentSnapshot) => void,
    private readonly delay = wait
  ) {}

  getSnapshot(): AssessmentSnapshot {
    return structuredClone(this.state)
  }

  private update(patch: Partial<AssessmentSnapshot>): void {
    this.state = { ...this.state, ...patch, revision: this.state.revision + 1 }
    this.publish(this.getSnapshot())
  }

  stop(notice = '做题任务已停止'): void {
    if (!this.abort) return
    this.abort.abort()
    this.update({ looping: false, phase: 'stopping', notice })
  }

  async toggleLoop(): Promise<boolean> {
    if (this.abort) {
      this.stop()
      return false
    }
    return this.start(true)
  }

  runOnce(): Promise<boolean> {
    return this.start(false)
  }

  private async start(looping: boolean): Promise<boolean> {
    if (this.abort) throw new Error('做题任务正在运行或停止中，请稍后再试')
    const controller = new AbortController()
    this.abort = controller
    let completed = false
    let previousPage: string | undefined
    this.update({ busy: true, looping, error: null, notice: '', phase: 'capturing' })
    try {
      do {
        checkAborted(controller.signal)
        const id = randomUUID()
        const config = structuredClone(this.config())
        this.update({ runId: id, result: null, debug: null, raw: '' })
        const outcome = await this.runner.run(
          {
            id,
            config,
            signal: controller.signal,
            phase: (phase) => {
              if (!controller.signal.aborted) this.update({ phase })
            }
          },
          (patch) => {
            if (this.state.runId === id) this.update(patch)
          },
          previousPage
        )
        checkAborted(controller.signal)
        completed = true
        previousPage = outcome.pageKey
        if (!looping || outcome.preview) break
        this.update({ phase: 'waiting' })
        await this.delay(3000, controller.signal)
      } while (!controller.signal.aborted)
    } catch (error) {
      if (!controller.signal.aborted)
        this.update({
          error: error instanceof Error ? error.message : String(error),
          phase: 'error'
        })
      completed = false
    } finally {
      this.abort = null
      this.update({ busy: false, looping: false, phase: this.state.error ? 'error' : 'idle' })
    }
    return completed
  }

  async runManual(action: () => Promise<void>): Promise<void> {
    if (this.abort) throw new Error('请先停止自动做题，再手动点击')
    this.abort = new AbortController()
    this.update({ busy: true, phase: 'clicking', error: null })
    try {
      await action()
    } finally {
      this.abort = null
      this.update({ busy: false, phase: 'idle' })
    }
  }
}
