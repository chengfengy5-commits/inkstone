export interface MaintenanceScheduler {
  start(): void
  stop(): Promise<void>
  trigger(): Promise<boolean>
}

interface TimerApi {
  setInterval(callback: () => void, milliseconds: number): ReturnType<typeof setInterval>
  clearInterval(handle: ReturnType<typeof setInterval>): void
}

export function createMaintenanceScheduler(
  operation: (signal: AbortSignal) => Promise<void>,
  intervalMs: number,
  onError: (error: unknown) => void,
  timers: TimerApi = { setInterval, clearInterval },
): MaintenanceScheduler {
  let handle: ReturnType<typeof setInterval> | null = null
  let active: Promise<void> | null = null
  let controller: AbortController | null = null
  let stopped = false

  const trigger = async (): Promise<boolean> => {
    if (active || stopped) return false
    const operationController = new AbortController()
    controller = operationController
    const operationRun = (async () => {
      try {
        await operation(operationController.signal)
      } catch (error) {
        onError(error)
      }
    })()
    active = operationRun
    try {
      await operationRun
    } finally {
      if (active === operationRun) active = null
      if (controller === operationController) controller = null
    }
    return true
  }

  return {
    start() {
      if (handle || stopped) return
      handle = timers.setInterval(() => { void trigger() }, intervalMs)
    },
    async stop() {
      stopped = true
      if (handle) timers.clearInterval(handle)
      handle = null
      controller?.abort(new Error('maintenance_scheduler_stopped'))
      await active
    },
    trigger,
  }
}
