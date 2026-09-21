import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalD1Database } from './d1'
import { LocalKvNamespace } from './kv'

const directories: string[] = []

function path(): string {
  const directory = mkdtempSync(join(tmpdir(), 'inkstone-kv-'))
  directories.push(directory)
  return join(directory, 'oauth.sqlite')
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('LocalKvNamespace', () => {
  it('round trips supported value types and metadata', async () => {
    const db = new LocalD1Database(path())
    const kv = new LocalKvNamespace(db)
    await kv.put('text', 'hello', { metadata: { kind: 'greeting' } })
    await kv.put('json', JSON.stringify({ ready: true }))
    await kv.put('bytes', new Uint8Array([4, 5, 6]))
    expect(await kv.get('text')).toBe('hello')
    expect(await kv.get('json', 'json')).toEqual({ ready: true })
    expect([...new Uint8Array(await kv.get('bytes', 'arrayBuffer') as ArrayBuffer)]).toEqual([4, 5, 6])
    const stored = await kv.getWithMetadata<{ kind: string }>('text')
    expect(stored).toMatchObject({ value: 'hello', metadata: { kind: 'greeting' } })
    await db.close()
  })

  it('expires keys and removes them from list results', async () => {
    let now = 1_000_000
    const db = new LocalD1Database(path())
    const kv = new LocalKvNamespace(db, () => now)
    await kv.put('temporary', 'value', { expirationTtl: 2 })
    expect(await kv.get('temporary')).toBe('value')
    now += 2_000
    expect(await kv.get('temporary')).toBeNull()
    expect((await kv.list()).keys).toEqual([])
    await db.close()
  })

  it('lists keys by prefix with stable cursors', async () => {
    const db = new LocalD1Database(path())
    const kv = new LocalKvNamespace(db)
    for (const key of ['oauth:a', 'oauth:b', 'oauth:c', 'other']) await kv.put(key, key)
    const first = await kv.list({ prefix: 'oauth:', limit: 2 })
    expect(first.keys.map((entry) => entry.name)).toEqual(['oauth:a', 'oauth:b'])
    expect(first.list_complete).toBe(false)
    const second = await kv.list({ prefix: 'oauth:', limit: 2, cursor: first.cursor })
    expect(second.keys.map((entry) => entry.name)).toEqual(['oauth:c'])
    expect(second.list_complete).toBe(true)
    await db.close()
  })

  it('persists values across database restarts', async () => {
    const databasePath = path()
    const firstDb = new LocalD1Database(databasePath)
    const first = new LocalKvNamespace(firstDb)
    await first.put('oauth-token', 'persisted')
    await firstDb.close()
    const secondDb = new LocalD1Database(databasePath)
    const second = new LocalKvNamespace(secondDb)
    expect(await second.get('oauth-token')).toBe('persisted')
    await second.delete('oauth-token')
    expect(await second.get('oauth-token')).toBeNull()
    await secondDb.close()
  })
})
