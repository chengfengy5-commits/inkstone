import { serve } from '@hono/node-server'
import { loadVpsConfig } from './config'
import { installNodeWebPolyfills } from './node-web-polyfills'
import { createVpsRuntime } from './runtime'

async function main(): Promise<void> {
  installNodeWebPolyfills()
  const config = loadVpsConfig()
  const runtime = await createVpsRuntime(config)
  runtime.scheduler.start()
  const server = serve({
    hostname: config.host,
    port: config.port,
    fetch: (request) => runtime.fetch(request),
  })
  console.log(`[inkstone] VPS runtime ${config.version} (${config.revision}) listening on ${config.host}:${config.port}`)

  let closing = false
  const close = (signal: string) => {
    if (closing) return
    closing = true
    console.log(`[inkstone] Received ${signal}; shutting down`)
    server.close((error) => {
      void runtime.close().then(
        () => process.exit(error ? 1 : 0),
        () => process.exit(1),
      )
    })
  }
  process.on('SIGINT', () => close('SIGINT'))
  process.on('SIGTERM', () => close('SIGTERM'))
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : 'unknown_error'
  console.error('[inkstone] Startup failed:', message.replace(/[\r\n\t]/g, ' ').slice(0, 300))
  process.exit(1)
})
