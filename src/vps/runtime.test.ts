import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { VpsConfig } from './config'
import { encryptSecret } from '../worker/lib/crypto'
import { loadOrCreateVaultKey } from './credential-vault'
import { installNodeWebPolyfills } from './node-web-polyfills'
import { createVpsRuntime } from './runtime'

installNodeWebPolyfills()

const directories: string[] = []

function fixture(): { root: string; config: VpsConfig } {
  const root = mkdtempSync(join(tmpdir(), 'inkstone-runtime-'))
  const assetsDir = join(root, 'assets')
  const dataDir = join(root, 'data')
  directories.push(root)
  mkdirSync(assetsDir, { recursive: true })
  writeFileSync(join(assetsDir, 'index.html'), '<!doctype html><title>Inkstone test</title>')
  return {
    root,
    config: {
      host: '127.0.0.1',
      port: 7712,
      publicUrl: 'http://127.0.0.1:7712',
      dataDir,
      assetsDir,
      vaultKeyPath: join(dataDir, 'secrets', 'vault.key'),
      maintenanceIntervalMs: 60_000,
      version: '0.8.0-test',
      revision: 'runtime-test',
    },
  }
}

function api(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers)
  headers.set('X-Inkstone-Client', '1')
  if (init.body) headers.set('Content-Type', 'application/json')
  return new Request(`http://127.0.0.1:7712${path}`, { ...init, headers })
}

function sessionCookie(response: Response): string {
  const raw = response.headers.get('set-cookie') ?? ''
  return raw.split(';', 1)[0] ?? ''
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('VPS runtime integration', () => {
  it('uses the configured HTTPS origin behind a loopback reverse proxy', async () => {
    const { config } = fixture()
    config.publicUrl = 'https://inkstone.example.com'
    const runtime = await createVpsRuntime(config)
    const registration = await runtime.fetch(api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username: 'owner', password: 'supersecret99', locale: 'en-US' }),
    }))

    expect(registration.status).toBe(201)
    expect(registration.headers.get('set-cookie')).toContain('Secure')
    expect(registration.headers.get('strict-transport-security')).toBe('max-age=31536000')
    await runtime.close()
  })

  it('reports capabilities and preserves an immediately searchable note across restart', async () => {
    const { config } = fixture()
    const first = await createVpsRuntime(config)
    const registration = await first.fetch(api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username: 'owner', password: 'supersecret99', locale: 'en-US' }),
    }))
    expect(registration.status).toBe(201)
    const cookie = sessionCookie(registration)
    expect(cookie).toContain('inkstone_session=')

    const created = await first.fetch(api('/api/notes', {
      method: 'POST',
      headers: { Cookie: cookie },
      body: JSON.stringify({ content: '# Durable note\n\nruntime-search-marker #vps' }),
    }))
    expect(created.status).toBe(201)
    const search = await first.fetch(api('/api/search?q=runtime-search-marker', {
      headers: { Cookie: cookie },
    }))
    expect(search.status).toBe(200)
    const searchResult = await search.json() as { mode: string; results: unknown[] }
    expect(searchResult.mode).toBe('fts')
    expect(searchResult.results).toHaveLength(1)

    const health = await first.fetch(api('/api/health', { headers: { Cookie: cookie } }))
    expect(await health.json()).toMatchObject({
      ok: true,
      runtime: 'vps',
      attachmentStorage: 'local',
      realtime: false,
      semanticSearch: false,
      credentialVault: true,
      mcp: true,
      version: '0.8.0-test',
      revision: 'runtime-test',
    })
    await first.close()

    const restarted = await createVpsRuntime(config)
    const login = await restarted.fetch(api('/api/auth/login', {
      method: 'POST',
      headers: { 'X-Real-IP': '127.0.0.1' },
      body: JSON.stringify({ username: 'owner', password: 'supersecret99' }),
    }))
    expect(login.status).toBe(200)
    const restartedCookie = sessionCookie(login)
    const persisted = await restarted.fetch(api('/api/search?q=runtime-search-marker', {
      headers: { Cookie: restartedCookie },
    }))
    const persistedResult = await persisted.json() as { results: unknown[] }
    expect(persistedResult.results).toHaveLength(1)
    await restarted.close()
  })

  it('returns dependency-aware readiness failure without leaking paths', async () => {
    const { config } = fixture()
    const runtime = await createVpsRuntime(config)
    expect((await runtime.readiness()).status).toBe(200)

    const attachments = join(config.dataDir, 'attachments')
    rmSync(attachments, { recursive: true, force: true })
    writeFileSync(attachments, 'blocked')
    const failed = await runtime.readiness()
    expect(failed.status).toBe(503)
    const body = await failed.json() as { ok: boolean; error: string }
    expect(body.ok).toBe(false)
    expect(body.error).not.toContain(config.dataDir)

    rmSync(attachments, { force: true })
    mkdirSync(attachments, { recursive: true })
    rmSync(join(config.assetsDir, 'index.html'))
    expect((await runtime.readiness()).status).toBe(503)
    writeFileSync(join(config.assetsDir, 'index.html'), '<!doctype html><title>Restored</title>')
    expect((await runtime.readiness()).status).toBe(200)
    await runtime.close()
  })

  it('fails closed when stored credentials lose their matching vault key', async () => {
    const { root, config } = fixture()
    const first = await createVpsRuntime(config)
    const targetId = '01m1r8923zajxnw9y0dhs6sy8j'
    const secret = await encryptSecret(first.env, targetId, { password: 'backup-password' })
    const now = Date.now()
    await first.env.DB.prepare(
      `INSERT INTO backup_targets
         (id, user_id, type, name, enabled, config, secret, created_at, updated_at)
       VALUES (?1, ?2, 'webdav', 'runtime-test', 1, '{}', ?3, ?4, ?4)`,
    ).bind(targetId, '01m1r8923zajxnw9y0dhs6sy8k', secret, now).run()
    await first.close()

    const originalKey = readFileSync(config.vaultKeyPath, 'utf8')
    unlinkSync(config.vaultKeyPath)
    await expect(createVpsRuntime(config)).rejects.toThrow('credential_vault_key_missing')
    expect(existsSync(config.vaultKeyPath)).toBe(false)

    const replacement = await loadOrCreateVaultKey(join(root, 'replacement.key'))
    expect(replacement).not.toBe(originalKey.trim())
    writeFileSync(config.vaultKeyPath, `${replacement}\n`, { mode: 0o600 })
    await expect(createVpsRuntime(config)).rejects.toThrow('credential_vault_key_mismatch')
  })
})
