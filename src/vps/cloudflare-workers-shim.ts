export class WorkerEntrypoint<Env = unknown, Props = unknown> {
  protected readonly ctx: ExecutionContext & { props: Props }
  protected readonly env: Env

  constructor(ctx: ExecutionContext, env: Env) {
    this.ctx = ctx as ExecutionContext & { props: Props }
    this.env = env
  }
}
