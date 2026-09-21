import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { LocalD1Database } from './d1'

const directories: string[] = []

function database(): LocalD1Database {
  const directory = mkdtempSync(join(tmpdir(), 'inkstone-d1-'))
  directories.push(directory)
  return new LocalD1Database(join(directory, 'inkstone.sqlite'))
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('LocalD1Database', () => {
  it('implements prepare, bind, run, first, all, raw, and exec', async () => {
    const db = database()
    await db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)')
    const inserted = await db.prepare('INSERT INTO items (name) VALUES (?1)').bind('first').run()
    expect(inserted.meta.changes).toBe(1)
    expect(inserted.meta.last_row_id).toBe(1)
    expect(await db.prepare('SELECT name FROM items WHERE id = ?1').bind(1).first('name')).toBe('first')
    expect((await db.prepare('SELECT id, name FROM items').all()).results).toEqual([{ id: 1, name: 'first' }])
    expect(await db.prepare('SELECT id, name FROM items').raw({ columnNames: true })).toEqual([
      ['id', 'name'],
      [1, 'first'],
    ])
    await db.close()
  })

  it('returns rows from writes with RETURNING', async () => {
    const db = database()
    await db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)')
    const result = await db.prepare('INSERT INTO items (id, name) VALUES (?1, ?2) RETURNING id, name')
      .bind(7, 'returned')
      .run<{ id: number; name: string }>()
    expect(result.results).toEqual([{ id: 7, name: 'returned' }])
    await db.close()
  })

  it('commits successful batches atomically', async () => {
    const db = database()
    await db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)')
    const results = await db.batch([
      db.prepare('INSERT INTO items (id, name) VALUES (?1, ?2)').bind(1, 'one'),
      db.prepare('INSERT INTO items (id, name) VALUES (?1, ?2)').bind(2, 'two'),
    ])
    expect(results.map((entry) => entry.meta.changes)).toEqual([1, 1])
    expect((await db.prepare('SELECT COUNT(*) AS total FROM items').first<{ total: number }>())?.total).toBe(2)
    await db.close()
  })

  it('rolls back every statement when a batch fails', async () => {
    const db = database()
    await db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE)')
    await expect(db.batch([
      db.prepare('INSERT INTO items (id, name) VALUES (?1, ?2)').bind(1, 'same'),
      db.prepare('INSERT INTO items (id, name) VALUES (?1, ?2)').bind(2, 'same'),
    ])).rejects.toThrow()
    expect((await db.prepare('SELECT COUNT(*) AS total FROM items').first<{ total: number }>())?.total).toBe(0)
    await db.close()
  })

  it('serializes concurrent operations', async () => {
    const db = database()
    await db.exec('CREATE TABLE counters (value INTEGER NOT NULL)')
    await db.prepare('INSERT INTO counters (value) VALUES (0)').run()
    await Promise.all(Array.from({ length: 50 }, () =>
      db.prepare('UPDATE counters SET value = value + 1').run()))
    expect((await db.prepare('SELECT value FROM counters').first<{ value: number }>())?.value).toBe(50)
    await db.close()
  })

  it('round trips blobs as ArrayBuffer values', async () => {
    const db = database()
    await db.exec('CREATE TABLE blobs (value BLOB NOT NULL)')
    await db.prepare('INSERT INTO blobs (value) VALUES (?1)').bind(new Uint8Array([1, 2, 3])).run()
    const row = await db.prepare('SELECT value FROM blobs').first<{ value: ArrayBuffer }>()
    expect([...new Uint8Array(row!.value)]).toEqual([1, 2, 3])
    await db.close()
  })

  it('enables WAL and FTS5 and rejects work after close', async () => {
    const db = database()
    expect(await db.prepare('PRAGMA journal_mode').first('journal_mode')).toBe('wal')
    await db.exec("CREATE VIRTUAL TABLE docs USING fts5(content, tokenize='unicode61')")
    await db.prepare('INSERT INTO docs (content) VALUES (?1)').bind('durable markdown notebook').run()
    expect((await db.prepare('SELECT content FROM docs WHERE docs MATCH ?1').bind('markdown').all()).results)
      .toEqual([{ content: 'durable markdown notebook' }])
    await db.close()
    expect(() => db.prepare('SELECT 1')).toThrow('d1_database_closed')
  })
})
