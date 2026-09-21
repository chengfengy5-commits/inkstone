import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'

interface StoredMetadata {
  uploaded: string
  etag: string
  httpMetadata: R2HTTPMetadata
  customMetadata: Record<string, string>
}

export class LocalObjectStore {
  private readonly objectsRoot: string
  private readonly metadataRoot: string

  constructor(root: string) {
    this.objectsRoot = resolve(root, 'objects')
    this.metadataRoot = resolve(root, 'metadata')
  }

  async put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | Blob | string | null,
    options: R2PutOptions = {},
  ): Promise<R2Object> {
    if (value === null) throw new Error('object_store_null_value')
    const objectPath = this.pathFor(this.objectsRoot, key)
    const metadataPath = this.pathFor(this.metadataRoot, `${key}.json`)
    const bytes = await readBytes(value)
    const metadata: StoredMetadata = {
      uploaded: new Date().toISOString(),
      etag: createHash('sha256').update(bytes).digest('hex'),
      httpMetadata: normalizeHttpMetadata(options.httpMetadata),
      customMetadata: options.customMetadata ?? {},
    }
    await mkdir(dirname(objectPath), { recursive: true })
    await mkdir(dirname(metadataPath), { recursive: true })
    const suffix = `.tmp-${process.pid}-${randomUUID()}`
    const objectTemp = objectPath + suffix
    const metadataTemp = metadataPath + suffix
    try {
      await writeFile(objectTemp, bytes, { flag: 'wx' })
      await writeFile(metadataTemp, JSON.stringify(metadata), { flag: 'wx', mode: 0o600 })
      await rename(objectTemp, objectPath)
      await rename(metadataTemp, metadataPath)
    } catch (error) {
      await Promise.allSettled([rm(objectTemp, { force: true }), rm(metadataTemp, { force: true })])
      throw error
    }
    return this.toObject(key, bytes.byteLength, metadata) as R2Object
  }

  async get(key: string): Promise<R2ObjectBody | null> {
    const objectPath = this.pathFor(this.objectsRoot, key)
    const metadataPath = this.pathFor(this.metadataRoot, `${key}.json`)
    try {
      const [details, metadata] = await Promise.all([
        stat(objectPath),
        readFile(metadataPath, 'utf8').then(parseMetadata),
      ])
      const object = this.toObject(key, details.size, metadata)
      return {
        ...object,
        body: Readable.toWeb(createReadStream(objectPath)) as ReadableStream,
        bodyUsed: false,
        arrayBuffer: async () => toArrayBuffer(await readFile(objectPath)),
        bytes: async () => new Uint8Array(await readFile(objectPath)),
        blob: async () => new Blob([await readFile(objectPath)], {
          type: metadata.httpMetadata.contentType,
        }),
        json: async <T>() => JSON.parse(await readFile(objectPath, 'utf8')) as T,
        text: async () => readFile(objectPath, 'utf8'),
      } as unknown as R2ObjectBody
    } catch (error) {
      if (isMissing(error)) return null
      throw error
    }
  }

  async head(key: string): Promise<R2Object | null> {
    const objectPath = this.pathFor(this.objectsRoot, key)
    const metadataPath = this.pathFor(this.metadataRoot, `${key}.json`)
    try {
      const [details, metadata] = await Promise.all([
        stat(objectPath),
        readFile(metadataPath, 'utf8').then(parseMetadata),
      ])
      return this.toObject(key, details.size, metadata)
    } catch (error) {
      if (isMissing(error)) return null
      throw error
    }
  }

  async delete(keys: string | string[]): Promise<void> {
    const targets = Array.isArray(keys) ? keys : [keys]
    await Promise.all(targets.flatMap((key) => [
      rm(this.pathFor(this.objectsRoot, key), { force: true }),
      rm(this.pathFor(this.metadataRoot, `${key}.json`), { force: true }),
    ]))
  }

  asR2Bucket(): R2Bucket {
    return this as unknown as R2Bucket
  }

  private pathFor(root: string, key: string): string {
    if (!key || key.includes('\0') || key.includes('\\')) throw new Error('object_store_invalid_key')
    const target = resolve(root, ...key.split('/'))
    const child = relative(root, target)
    if (!child || child === '..' || child.startsWith(`..${sep}`)) throw new Error('object_store_invalid_key')
    return target
  }

  private toObject(key: string, size: number, metadata: StoredMetadata): R2Object {
    return {
      key,
      version: metadata.etag,
      size,
      etag: metadata.etag,
      httpEtag: `"${metadata.etag}"`,
      uploaded: new Date(metadata.uploaded),
      httpMetadata: metadata.httpMetadata,
      customMetadata: metadata.customMetadata,
      range: undefined,
      checksums: {} as R2Checksums,
      storageClass: 'Standard',
      writeHttpMetadata(headers: Headers) {
        if (metadata.httpMetadata.contentType) headers.set('Content-Type', metadata.httpMetadata.contentType)
        if (metadata.httpMetadata.cacheControl) headers.set('Cache-Control', metadata.httpMetadata.cacheControl)
        if (metadata.httpMetadata.contentDisposition) {
          headers.set('Content-Disposition', metadata.httpMetadata.contentDisposition)
        }
      },
    }
  }
}

async function readBytes(value: ReadableStream | ArrayBuffer | ArrayBufferView | Blob | string): Promise<Uint8Array> {
  if (typeof value === 'string') return new TextEncoder().encode(value)
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer())
  return new Uint8Array(await new Response(value).arrayBuffer())
}

function normalizeHttpMetadata(value?: R2HTTPMetadata | Headers): R2HTTPMetadata {
  if (!value) return {}
  if (!(value instanceof Headers)) return value
  return {
    contentType: value.get('Content-Type') ?? undefined,
    contentLanguage: value.get('Content-Language') ?? undefined,
    contentDisposition: value.get('Content-Disposition') ?? undefined,
    contentEncoding: value.get('Content-Encoding') ?? undefined,
    cacheControl: value.get('Cache-Control') ?? undefined,
    cacheExpiry: value.get('Expires') ? new Date(value.get('Expires')!) : undefined,
  }
}

function parseMetadata(value: string): StoredMetadata {
  const parsed = JSON.parse(value) as StoredMetadata
  if (!parsed || typeof parsed.etag !== 'string' || typeof parsed.uploaded !== 'string') {
    throw new Error('object_store_metadata_corrupt')
  }
  return parsed
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  return Uint8Array.from(value).buffer
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}
