import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalAssetFetcher } from './assets'
import { LocalExecutionContext } from './execution-context'

const directories: string[] = []

function assets(): LocalAssetFetcher {
  const root = mkdtempSync(join(tmpdir(), 'inkstone-assets-'))
  directories.push(root)
  mkdirSync(join(root, 'assets'))
  writeFileSync(join(root, 'index.html'), '<title>Inkstone</title>')
  writeFileSync(join(root, 'assets', 'app-123.js'), 'console.log("ready")')
  return new LocalAssetFetcher(root)
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('LocalAssetFetcher', () => {
  it('serves static assets with content type and immutable caching', async () => {
    const response = await assets().fetch('http://localhost/assets/app-123.js')
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('text/javascript')
    expect(response.headers.get('Cache-Control')).toContain('immutable')
    expect(await response.text()).toContain('console.log')
  })

  it('falls back to the SPA index and does not cache it immutably', async () => {
    const response = await assets().fetch('http://localhost/notes/example')
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-cache')
    expect(await response.text()).toContain('<title>Inkstone</title>')
  })

  it('rejects path traversal instead of falling back', async () => {
    const response = await assets().fetch('http://localhost/%2e%2e%2Fsecret')
    expect(response.status).toBe(404)
  })
})

describe('LocalExecutionContext', () => {
  it('waits for deferred work', async () => {
    const context = new LocalExecutionContext()
    let finished = false
    context.waitUntil(Promise.resolve().then(() => { finished = true }))
    await context.drain()
    expect(finished).toBe(true)
  })

  it('reports deferred failures', async () => {
    const context = new LocalExecutionContext()
    context.waitUntil(Promise.reject(new Error('background failed')))
    await expect(context.drain()).rejects.toThrow()
  })
})
