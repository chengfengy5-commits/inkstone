import { createHash } from 'node:crypto'

let fetchPolyfilled = false
const fixedLengthBodies = new WeakMap<ReadableStream<Uint8Array>, bigint>()

class NodeFixedLengthStream {
  readonly readable: ReadableStream<Uint8Array>
  readonly writable: WritableStream<Uint8Array>

  constructor(expectedBytes: bigint) {
    const stream = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(chunk)
      },
    })
    this.readable = stream.readable
    this.writable = stream.writable
    fixedLengthBodies.set(this.readable, expectedBytes)
  }
}

class NodeDigestStream extends WritableStream<Uint8Array> {
  readonly digest: Promise<ArrayBuffer>

  constructor(algorithm: string) {
    if (algorithm.toUpperCase().replace('-', '') !== 'SHA256') {
      throw new TypeError(`Unsupported digest algorithm: ${algorithm}`)
    }
    const hash = createHash('sha256')
    let resolveDigest!: (value: ArrayBuffer) => void
    let rejectDigest!: (reason: unknown) => void
    const digest = new Promise<ArrayBuffer>((resolve, reject) => {
      resolveDigest = resolve
      rejectDigest = reject
    })
    super({
      write(chunk) {
        hash.update(chunk)
      },
      close() {
        resolveDigest(Uint8Array.from(hash.digest()).buffer)
      },
      abort(reason) {
        rejectDigest(reason)
      },
    })
    this.digest = digest
  }
}

export function installNodeWebPolyfills(): void {
  if (!('FixedLengthStream' in globalThis)) {
    Object.defineProperty(globalThis, 'FixedLengthStream', { value: NodeFixedLengthStream })
  }
  if (!('DigestStream' in crypto)) {
    Object.defineProperty(crypto, 'DigestStream', { value: NodeDigestStream })
  }
  if (!fetchPolyfilled) {
    const nodeFetch = globalThis.fetch.bind(globalThis)
    globalThis.fetch = (input, init) => {
      if (init?.body instanceof ReadableStream && !('duplex' in init)) {
        const headers = new Headers(init.headers)
        const expectedBytes = fixedLengthBodies.get(init.body as ReadableStream<Uint8Array>)
        if (expectedBytes !== undefined && !headers.has('Content-Length')) {
          headers.set('Content-Length', expectedBytes.toString())
        }
        return nodeFetch(input, { ...init, headers, duplex: 'half' } as unknown as RequestInit)
      }
      return nodeFetch(input, init)
    }
    fetchPolyfilled = true
  }
}
