import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalObjectStore } from './object-store'

const directories: string[] = []

function store(): { root: string; value: LocalObjectStore } {
  const root = mkdtempSync(join(tmpdir(), 'inkstone-objects-'))
  directories.push(root)
  return { root, value: new LocalObjectStore(root) }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('LocalObjectStore', () => {
  it('streams bytes and preserves metadata across restarts', async () => {
    const { root, value } = store()
    await value.put('users/u1/file.txt', 'hello', {
      httpMetadata: { contentType: 'text/plain', cacheControl: 'private, no-store' },
      customMetadata: { userId: 'u1', objectId: 'f1' },
    })
    const restarted = new LocalObjectStore(root)
    const object = await restarted.get('users/u1/file.txt')
    expect(object?.size).toBe(5)
    expect(object?.httpMetadata?.contentType).toBe('text/plain')
    expect(object?.customMetadata).toEqual({ userId: 'u1', objectId: 'f1' })
    expect(await object?.text()).toBe('hello')
    expect(await new Response(object?.body).text()).toBe('hello')
  })

  it('rejects traversal and backslash keys', async () => {
    const { value } = store()
    await expect(value.put('../outside', 'bad')).rejects.toThrow('object_store_invalid_key')
    await expect(value.put('safe/../../outside', 'bad')).rejects.toThrow('object_store_invalid_key')
    await expect(value.put('safe\\outside', 'bad')).rejects.toThrow('object_store_invalid_key')
  })

  it('uses atomic temp files and removes objects in batches', async () => {
    const { root, value } = store()
    await value.put('a/one', new Uint8Array([1]))
    await value.put('a/two', new Uint8Array([2]))
    expect(readdirSync(join(root, 'objects', 'a')).every((name) => !name.includes('.tmp-'))).toBe(true)
    await value.delete(['a/one', 'a/two'])
    expect(await value.get('a/one')).toBeNull()
    expect(await value.get('a/two')).toBeNull()
  })
})
