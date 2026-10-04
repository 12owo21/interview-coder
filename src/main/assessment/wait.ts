export function checkAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('做题任务已停止')
}

export function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error('做题任务已停止'))
    const cancel = (): void => {
      clearTimeout(timer)
      reject(new Error('做题任务已停止'))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', cancel)
      resolve()
    }, ms)
    signal.addEventListener('abort', cancel, { once: true })
  })
}
