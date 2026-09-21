import { createServer } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { installNodeWebPolyfills } from './node-web-polyfills'

const servers: ReturnType<typeof createServer>[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })))
})

describe('installNodeWebPolyfills', () => {
  it('allows Node fetch to upload a ReadableStream without a caller-specific duplex option', async () => {
    let received = ''
    let contentLength = ''
    const server = createServer((request, response) => {
      contentLength = request.headers['content-length'] ?? ''
      request.setEncoding('utf8')
      request.on('data', (chunk) => { received += chunk })
      request.on('end', () => {
        response.writeHead(200)
        response.end('ok')
      })
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected an internet socket')

    installNodeWebPolyfills()
    const fixed = new FixedLengthStream(BigInt('streamed-backup'.length))
    const pump = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('streamed-backup'))
        controller.close()
      },
    }).pipeTo(fixed.writable)
    const response = await fetch(`http://127.0.0.1:${address.port}`, {
      method: 'PUT',
      body: fixed.readable,
    })
    await pump

    expect(response.status).toBe(200)
    expect(received).toBe('streamed-backup')
    expect(contentLength).toBe(String('streamed-backup'.length))
  })
})
