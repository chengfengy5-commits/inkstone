import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, relative, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
}

export class LocalAssetFetcher {
  private readonly root: string

  constructor(root: string) {
    this.root = resolve(root)
  }

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request = input instanceof Request ? input : new Request(input, init)
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } })
    }
    let pathname: string
    try {
      pathname = decodeURIComponent(new URL(request.url).pathname)
    } catch {
      return new Response('Bad Request', { status: 400 })
    }
    const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
    const selected = await this.selectFile(requested)
    if (!selected) return new Response('Not Found', { status: 404 })
    const details = await stat(selected)
    const headers = new Headers({
      'Content-Type': CONTENT_TYPES[extname(selected).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': String(details.size),
      'Cache-Control': requested.startsWith('assets/') && selected.endsWith(requested)
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
    })
    if (request.method === 'HEAD') return new Response(null, { status: 200, headers })
    const body = Readable.toWeb(createReadStream(selected)) as ReadableStream
    return new Response(body, { status: 200, headers })
  }

  asFetcher(): Fetcher {
    return this as unknown as Fetcher
  }

  private async selectFile(requested: string): Promise<string | null> {
    const direct = this.safePath(requested)
    if (!direct) return null
    try {
      if ((await stat(direct)).isFile()) return direct
    } catch (error) {
      if (!isMissing(error)) throw error
    }
    const fallback = this.safePath('index.html')
    if (!fallback) return null
    try {
      return (await stat(fallback)).isFile() ? fallback : null
    } catch (error) {
      if (isMissing(error)) return null
      throw error
    }
  }

  private safePath(path: string): string | null {
    if (!path || path.includes('\0') || path.includes('\\')) return null
    const target = resolve(this.root, ...path.split('/'))
    const child = relative(this.root, target)
    if (!child || child === '..' || child.startsWith(`..${sep}`)) return null
    return target
  }
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}
