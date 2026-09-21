export class LocalExecutionContext {
  private readonly pending = new Set<Promise<unknown>>()

  waitUntil(promise: Promise<unknown>): void {
    this.pending.add(promise)
    promise.finally(() => this.pending.delete(promise)).catch(() => undefined)
  }

  passThroughOnException(): void {
  }

  async drain(): Promise<void> {
    const outcomes = await Promise.allSettled([...this.pending])
    const failures = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected')
    if (failures.length) throw new AggregateError(failures.map((failure) => failure.reason))
  }

  asExecutionContext(): ExecutionContext {
    return this as unknown as ExecutionContext
  }
}
