import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMaintenanceScheduler } from './scheduler'

afterEach(() => vi.useRealTimers())

describe('maintenance scheduler', () => {
  it('runs on the interval and prevents overlap', async () => {
    vi.useFakeTimers()
    let release!: () => void
    const operation = vi.fn(() => new Promise<void>((resolve) => { release = resolve }))
    const scheduler = createMaintenanceScheduler(operation, 1000, vi.fn())
    scheduler.start()
    await vi.advanceTimersByTimeAsync(1000)
    expect(operation).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(3000)
    expect(operation).toHaveBeenCalledTimes(1)
    release()
    await vi.runAllTicks()
    await vi.advanceTimersByTimeAsync(1000)
    expect(operation).toHaveBeenCalledTimes(2)
    release()
    await vi.runAllTicks()
    await scheduler.stop()
  })

  it('reports failures and retries on the next trigger', async () => {
    const failure = vi.fn()
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error('first failed'))
      .mockResolvedValueOnce(undefined)
    const scheduler = createMaintenanceScheduler(operation, 1000, failure)
    expect(await scheduler.trigger()).toBe(true)
    expect(failure).toHaveBeenCalledTimes(1)
    expect(await scheduler.trigger()).toBe(true)
    expect(operation).toHaveBeenCalledTimes(2)
  })

  it('does not run after shutdown', async () => {
    const operation = vi.fn().mockResolvedValue(undefined)
    const scheduler = createMaintenanceScheduler(operation, 1000, vi.fn())
    await scheduler.stop()
    expect(await scheduler.trigger()).toBe(false)
    expect(operation).not.toHaveBeenCalled()
  })

  it('waits for an in-flight maintenance operation before stopping', async () => {
    let release!: () => void
    const operation = vi.fn(() => new Promise<void>((resolve) => { release = resolve }))
    const scheduler = createMaintenanceScheduler(operation, 1000, vi.fn())
    const trigger = scheduler.trigger()
    let stopped = false
    const stop = scheduler.stop().then(() => { stopped = true })

    await Promise.resolve()
    expect(stopped).toBe(false)
    release()
    await Promise.all([trigger, stop])
    expect(stopped).toBe(true)
  })

  it('aborts an in-flight operation during shutdown', async () => {
    let operationSignal: AbortSignal | undefined
    const operation = vi.fn((signal: AbortSignal) => new Promise<void>((resolve) => {
      operationSignal = signal
      signal.addEventListener('abort', () => resolve(), { once: true })
    }))
    const scheduler = createMaintenanceScheduler(operation, 1000, vi.fn())
    const trigger = scheduler.trigger()

    await scheduler.stop()
    await trigger
    expect(operationSignal?.aborted).toBe(true)
  })
})
