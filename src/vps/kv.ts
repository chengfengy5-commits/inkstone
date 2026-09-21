import { LocalD1Database } from './d1'

type KvValueType = 'arrayBuffer' | 'json' | 'stream' | 'text'
type KvWriteValue = ArrayBuffer | ArrayBufferView | ReadableStream | string

interface KvPutOptions {
  expiration?: number
  expirationTtl?: number
  metadata?: unknown
}

interface KvListOptions {
  prefix?: string
  limit?: number
  cursor?: string
}

interface KvRow {
  key: string
  value: ArrayBuffer
  metadata: string | null
  expires_at: number | null
}

export class LocalKvNamespace {
  private readonly ready: Promise<void>

  constructor(
    private readonly database: LocalD1Database,
    private readonly now: () => number = Date.now,
  ) {
    this.ready = this.initialize()
  }

  async get(key: string, typeOrOptions?: KvValueType | { type?: KvValueType }): Promise<unknown> {
    const row = await this.load(key)
    if (!row) return null
    return decodeValue(row.value, resolveType(typeOrOptions))
  }

  async getWithMetadata<Metadata = unknown>(
    key: string,
    typeOrOptions?: KvValueType | { type?: KvValueType },
  ): Promise<{ value: unknown; metadata: Metadata | null; cacheStatus: null }> {
    const row = await this.load(key)
    if (!row) return { value: null, metadata: null, cacheStatus: null }
    return {
      value: decodeValue(row.value, resolveType(typeOrOptions)),
      metadata: parseMetadata(row.metadata) as Metadata | null,
      cacheStatus: null,
    }
  }

  async put(key: string, value: KvWriteValue, options: KvPutOptions = {}): Promise<void> {
    await this.ready
    validateKey(key)
    const expiration = resolveExpiration(options, this.now())
    const bytes = await encodeValue(value)
    await this.database.prepare(
      `INSERT INTO local_kv (key, value, metadata, expires_at)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         metadata = excluded.metadata,
         expires_at = excluded.expires_at`,
    ).bind(key, bytes, options.metadata === undefined ? null : JSON.stringify(options.metadata), expiration).run()
  }

  async delete(key: string): Promise<void> {
    await this.ready
    validateKey(key)
    await this.database.prepare('DELETE FROM local_kv WHERE key = ?1').bind(key).run()
  }

  async list<Metadata = unknown>(options: KvListOptions = {}): Promise<{
    keys: Array<{ name: string; expiration?: number; metadata?: Metadata }>
    list_complete: boolean
    cursor?: string
    cacheStatus: null
  }> {
    await this.ready
    const limit = Math.min(1000, Math.max(1, Math.trunc(options.limit ?? 1000)))
    const prefix = options.prefix ?? ''
    const after = decodeCursor(options.cursor)
    const now = Math.floor(this.now() / 1000)
    await this.deleteExpired(now)
    const rows = (await this.database.prepare(
      `SELECT key, metadata, expires_at
         FROM local_kv
        WHERE substr(key, 1, length(?1)) = ?1
          AND key > ?2
          AND (expires_at IS NULL OR expires_at > ?3)
        ORDER BY key
        LIMIT ?4`,
    ).bind(prefix, after, now, limit + 1).all<Pick<KvRow, 'key' | 'metadata' | 'expires_at'>>()).results
    const page = rows.slice(0, limit)
    const complete = rows.length <= limit
    return {
      keys: page.map((row) => ({
        name: row.key,
        ...(row.expires_at === null ? {} : { expiration: row.expires_at }),
        ...(row.metadata === null ? {} : { metadata: parseMetadata(row.metadata) as Metadata }),
      })),
      list_complete: complete,
      ...(complete || !page.length ? {} : { cursor: encodeCursor(page.at(-1)!.key) }),
      cacheStatus: null,
    }
  }

  asKvNamespace(): KVNamespace {
    return this as unknown as KVNamespace
  }

  private async initialize(): Promise<void> {
    await this.database.exec(
      `CREATE TABLE IF NOT EXISTS local_kv (
         key TEXT PRIMARY KEY,
         value BLOB NOT NULL,
         metadata TEXT,
         expires_at INTEGER
       );
       CREATE INDEX IF NOT EXISTS idx_local_kv_expiration ON local_kv(expires_at);`,
    )
  }

  private async load(key: string): Promise<KvRow | null> {
    await this.ready
    validateKey(key)
    const now = Math.floor(this.now() / 1000)
    const row = await this.database.prepare(
      `SELECT key, value, metadata, expires_at
         FROM local_kv
        WHERE key = ?1 AND (expires_at IS NULL OR expires_at > ?2)`,
    ).bind(key, now).first<KvRow>()
    if (row) return row
    await this.database.prepare('DELETE FROM local_kv WHERE key = ?1 AND expires_at <= ?2').bind(key, now).run()
    return null
  }

  private async deleteExpired(now: number): Promise<void> {
    await this.database.prepare('DELETE FROM local_kv WHERE expires_at IS NOT NULL AND expires_at <= ?1')
      .bind(now)
      .run()
  }
}

function resolveExpiration(options: KvPutOptions, now: number): number | null {
  if (options.expiration !== undefined && options.expirationTtl !== undefined) {
    throw new Error('kv_expiration_conflict')
  }
  if (options.expiration !== undefined) {
    if (!Number.isSafeInteger(options.expiration) || options.expiration <= Math.floor(now / 1000)) {
      throw new Error('kv_invalid_expiration')
    }
    return options.expiration
  }
  if (options.expirationTtl !== undefined) {
    if (!Number.isFinite(options.expirationTtl) || options.expirationTtl <= 0) {
      throw new Error('kv_invalid_expiration_ttl')
    }
    return Math.floor(now / 1000 + options.expirationTtl)
  }
  return null
}

function validateKey(key: string): void {
  if (!key || new TextEncoder().encode(key).byteLength > 512) throw new Error('kv_invalid_key')
}

async function encodeValue(value: KvWriteValue): Promise<Uint8Array> {
  if (typeof value === 'string') return new TextEncoder().encode(value)
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  return new Uint8Array(await new Response(value).arrayBuffer())
}

function resolveType(value?: KvValueType | { type?: KvValueType }): KvValueType {
  return typeof value === 'string' ? value : value?.type ?? 'text'
}

function decodeValue(value: ArrayBuffer, type: KvValueType): unknown {
  if (type === 'arrayBuffer') return value
  if (type === 'stream') return new Blob([value]).stream()
  const text = new TextDecoder().decode(value)
  return type === 'json' ? JSON.parse(text) : text
}

function parseMetadata(value: string | null): unknown {
  return value === null ? null : JSON.parse(value)
}

function encodeCursor(key: string): string {
  return Buffer.from(key, 'utf8').toString('base64url')
}

function decodeCursor(cursor?: string): string {
  if (!cursor) return ''
  try {
    return Buffer.from(cursor, 'base64url').toString('utf8')
  } catch {
    throw new Error('kv_invalid_cursor')
  }
}
