import { Buffer } from 'node:buffer'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VpsConfig } from './config'
import { installNodeWebPolyfills } from './node-web-polyfills'
import { createVpsRuntime, type VpsRuntime } from './runtime'

installNodeWebPolyfills()

const roots: string[] = []

function fixture(): VpsConfig {
  const root = mkdtempSync(join(tmpdir(), 'inkstone-backup-runtime-'))
  const assetsDir = join(root, 'assets')
  const dataDir = join(root, 'data')
  roots.push(root)
  mkdirSync(assetsDir, { recursive: true })
  writeFileSync(join(assetsDir, 'index.html'), '<!doctype html><title>Backup test</title>')
  return {
    host: '127.0.0.1',
    port: 7712,
    publicUrl: 'http://127.0.0.1:7712',
    dataDir,
    assetsDir,
    vaultKeyPath: join(dataDir, 'secrets', 'vault.key'),
    maintenanceIntervalMs: 60_000,
    version: '0.8.0-test',
    revision: 'backup-test',
  }
}

async function api(
  runtime: VpsRuntime,
  path: string,
  method: string,
  body?: unknown,
  cookie?: string,
): Promise<Response> {
  const headers = new Headers({ 'X-Inkstone-Client': '1' })
  if (body !== undefined) headers.set('Content-Type', 'application/json')
  if (cookie) headers.set('Cookie', cookie)
  return runtime.fetch(new Request(`http://127.0.0.1:7712${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }))
}

function sessionCookie(response: Response): string {
  return (response.headers.get('set-cookie') ?? '').split(';', 1)[0] ?? ''
}

function installWebdavEndpoint(password: string) {
  const objects = new Map<string, Uint8Array>()
  const calls: Array<{ method: string; path: string; authorized: boolean }> = []
  const expectedAuth = `Basic ${Buffer.from(`owner:${password}`).toString('base64')}`

  vi.stubGlobal('fetch', async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    const method = (init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined))
    const authorized = headers.get('Authorization') === expectedAuth
    calls.push({ method, path: url.pathname, authorized })
    if (!authorized) return new Response(null, { status: 401 })

    if (method === 'PROPFIND') return new Response(null, { status: 207 })
    if (method === 'MKCOL') return new Response(null, { status: 201 })
    if (method === 'HEAD') {
      const stored = objects.get(url.pathname)
      return stored
        ? new Response(null, { status: 200, headers: { 'Content-Length': String(stored.byteLength) } })
        : new Response(null, { status: 404 })
    }
    if (method === 'PUT') {
      const bytes = new Uint8Array(await new Response(init.body).arrayBuffer())
      objects.set(url.pathname, bytes)
      return new Response(null, { status: 201 })
    }
    if (method === 'GET') {
      const stored = objects.get(url.pathname)
      return stored ? new Response(stored as unknown as BodyInit) : new Response(null, { status: 404 })
    }
    if (method === 'DELETE') {
      objects.delete(url.pathname)
      return new Response(null, { status: 204 })
    }
    return new Response(null, { status: 405 })
  })

  return { calls, objects }
}

afterEach(() => {
  vi.unstubAllGlobals()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('VPS backup integration', () => {
  it('keeps WebDAV credentials encrypted and performs a backup after restart', async () => {
    const config = fixture()
    const password = 'webdav-secret-77'
    const endpoint = installWebdavEndpoint(password)
    const first = await createVpsRuntime(config)

    const registration = await api(first, '/api/auth/register', 'POST', {
      username: 'owner',
      password: 'supersecret99',
      locale: 'en-US',
    })
    expect(registration.status).toBe(201)
    const cookie = sessionCookie(registration)

    expect((await api(first, '/api/notes', 'POST', {
      content: '# WebDAV backup proof\n\nbackup-runtime-marker',
    }, cookie)).status).toBe(201)

    const created = await api(first, '/api/backup/targets', 'POST', {
      type: 'webdav',
      name: 'Disposable WebDAV',
      enabled: true,
      config: {
        url: 'https://dav.inkstone.example.net/storage',
        username: 'owner',
        prefix: 'inkstone',
        mode: 'archive',
      },
      secret: { password },
    }, cookie)
    expect(created.status, await created.clone().text()).toBe(201)
    const target = await created.json() as { id: string; hasSecret: boolean }
    expect(target.hasSecret).toBe(true)
    expect(JSON.stringify(target)).not.toContain(password)
    await first.close()

    expect(Buffer.from(readFileSync(join(config.dataDir, 'inkstone.sqlite'))).toString('latin1').includes(password)).toBe(false)

    const restarted = await createVpsRuntime(config)
    const login = await api(restarted, '/api/auth/login', 'POST', {
      username: 'owner',
      password: 'supersecret99',
    })
    expect(login.status).toBe(200)
    const restartedCookie = sessionCookie(login)

    const connection = await api(
      restarted,
      `/api/backup/targets/${target.id}/test`,
      'POST',
      {},
      restartedCookie,
    )
    expect(connection.status, await connection.clone().text()).toBe(200)
    expect(await connection.json()).toMatchObject({ ok: true })

    const run = await api(restarted, '/api/backup/run', 'POST', {
      targetIds: [target.id],
    }, restartedCookie)
    expect(run.status, await run.clone().text()).toBe(200)
    expect(await run.json()).toMatchObject({
      status: 'success',
      results: [{ targetId: target.id, ok: true, files: 1 }],
    })

    const archive = [...endpoint.objects.entries()].find(([path]) => path.endsWith('.zip'))
    expect(archive?.[0]).toMatch(/^\/storage\/inkstone\/backups\/inkstone-backup-/)
    expect(Array.from(archive?.[1].slice(0, 2) ?? [])).toEqual([0x50, 0x4b])
    expect(Buffer.from(archive?.[1] ?? []).includes(Buffer.from('backup-runtime-marker'))).toBe(true)
    expect(endpoint.calls.length).toBeGreaterThan(5)
    expect(endpoint.calls.every((call) => call.authorized)).toBe(true)
    await restarted.close()
  })
})
