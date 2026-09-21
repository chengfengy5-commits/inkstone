import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Env } from '../worker/env'
import { initializeDatabase } from '../worker/db/schema'
import { handleRequest, runScheduledMaintenance } from '../worker/index'
import { decryptSecret, decryptTotpSecret, encryptSecret } from '../worker/lib/crypto'
import { LocalAssetFetcher } from './assets'
import type { VpsConfig } from './config'
import { loadOrCreateVaultKey, LocalCredentialVaultNamespace } from './credential-vault'
import { LocalD1Database } from './d1'
import { LocalExecutionContext } from './execution-context'
import { LocalKvNamespace } from './kv'
import { LocalObjectStore } from './object-store'
import { createMaintenanceScheduler, type MaintenanceScheduler } from './scheduler'

const PROBE_CREDENTIAL_ID = '00000000000000000000000000'

export interface VpsRuntime {
  env: Env
  scheduler: MaintenanceScheduler
  fetch(request: Request): Promise<Response>
  readiness(): Promise<Response>
  close(): Promise<void>
}

export async function createVpsRuntime(config: VpsConfig): Promise<VpsRuntime> {
  await mkdir(config.dataDir, { recursive: true, mode: 0o700 })
  const database = new LocalD1Database(resolve(config.dataDir, 'inkstone.sqlite'))
  const oauthDatabase = new LocalD1Database(resolve(config.dataDir, 'oauth.sqlite'))
  const oauth = new LocalKvNamespace(oauthDatabase)
  const files = new LocalObjectStore(resolve(config.dataDir, 'attachments'))
  const env: Env = {
    DB: database.asD1Database(),
    ASSETS: new LocalAssetFetcher(config.assetsDir).asFetcher(),
    FILES: files.asR2Bucket(),
    OAUTH_KV: oauth.asKvNamespace(),
    APP_NAME: 'Inkstone',
    PUBLIC_URL: config.publicUrl,
    RUNTIME_NAME: 'vps',
    ATTACHMENT_STORAGE_NAME: 'local',
    APP_VERSION: config.version,
    SOURCE_REVISION: config.revision,
  }
  let scheduler: MaintenanceScheduler | null = null
  try {
    await initializeDatabase(env)
    const hasStoredCredentials = await storedCredentialCiphertextExists(env.DB)
    const vaultKey = await loadOrCreateVaultKey(config.vaultKeyPath, !hasStoredCredentials)
    const vault = new LocalCredentialVaultNamespace(vaultKey)
    env.CREDENTIAL_VAULT = vault.asDurableObjectNamespace()
    await verifyDependencies(env, oauth, files)

    scheduler = createMaintenanceScheduler(
      (signal) => runScheduledMaintenance(env, signal),
      config.maintenanceIntervalMs,
      (error) => console.error('[inkstone] Scheduled maintenance failed:', safeError(error)),
    )
    const activeScheduler = scheduler
    const runtime: VpsRuntime = {
      env,
      scheduler: activeScheduler,
      async fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === '/healthz') {
          return Response.json({ ok: true, runtime: 'vps', version: config.version, revision: config.revision })
        }
        if (url.pathname === '/readyz') return runtime.readiness()
        const context = new LocalExecutionContext()
        const response = await handleRequest(
          externalRequest(request, config.publicUrl),
          env,
          context.asExecutionContext(),
        )
        await context.drain()
        return response
      },
      async readiness() {
        try {
          await verifyDependencies(env, oauth, files)
          return Response.json({
            ok: true,
            runtime: 'vps',
            database: 'ready',
            oauth: 'ready',
            attachments: 'ready',
            credentialVault: 'ready',
            version: config.version,
            revision: config.revision,
          })
        } catch (error) {
          console.error('[inkstone] Readiness probe failed:', safeError(error))
          return Response.json({ ok: false, runtime: 'vps', error: 'dependency_probe_failed' }, { status: 503 })
        }
      },
      async close() {
        await activeScheduler.stop()
        await oauthDatabase.close()
        await database.close()
      },
    }
    return runtime
  } catch (error) {
    await scheduler?.stop().catch(() => {})
    await oauthDatabase.close().catch(() => {})
    await database.close().catch(() => {})
    throw error
  }
}

function externalRequest(request: Request, publicUrl: string): Request {
  const incoming = new URL(request.url)
  const target = new URL(publicUrl)
  target.pathname = incoming.pathname
  target.search = incoming.search
  if (target.href === incoming.href) return request
  return new Request(target, request)
}

async function verifyDependencies(
  env: Env,
  oauth: LocalKvNamespace,
  files: LocalObjectStore,
): Promise<void> {
  const probeId = randomUUID()
  const probeKey = `.health/readiness-${probeId}`
  await env.DB.prepare(
    `INSERT INTO login_attempts (key, fails, last_fail_at, locked_until)
     VALUES (?1, 0, ?2, NULL)`,
  ).bind(`readiness:${probeId}`, Date.now()).run()
  await env.DB.prepare(`DELETE FROM login_attempts WHERE key = ?1`)
    .bind(`readiness:${probeId}`)
    .run()
  await oauth.put(probeKey, 'ready', { expirationTtl: 60 })
  if (await oauth.get(probeKey) !== 'ready') throw new Error('oauth_store_probe_failed')
  await oauth.delete(probeKey)
  await files.put(probeKey, 'ready', { customMetadata: { kind: 'health' } })
  const stored = await files.get(probeKey)
  if (!stored || await stored.text() !== 'ready') throw new Error('attachment_store_probe_failed')
  await files.delete(probeKey)
  const asset = await env.ASSETS.fetch(new Request('https://assets.local/index.html'))
  await asset.body?.cancel().catch(() => {})
  if (!asset.ok) throw new Error('static_assets_probe_failed')
  const probe = await encryptSecret(env, PROBE_CREDENTIAL_ID, { password: 'probe' })
  const decryptedProbe = await decryptSecret<{ password: string }>(env, PROBE_CREDENTIAL_ID, probe)
  if (decryptedProbe?.password !== 'probe') throw new Error('credential_vault_probe_failed')
  await verifyStoredCredentials(env)
}

async function storedCredentialCiphertextExists(db: D1Database): Promise<boolean> {
  const row = await db.prepare(
    `SELECT CASE WHEN
       EXISTS(SELECT 1 FROM backup_targets WHERE secret IS NOT NULL AND secret <> '') OR
       EXISTS(SELECT 1 FROM totp_credentials WHERE secret_ciphertext <> '')
     THEN 1 ELSE 0 END AS present`,
  ).first<{ present: number }>()
  return row?.present === 1
}

async function verifyStoredCredentials(env: Env): Promise<void> {
  const backup = await env.DB.prepare(
    `SELECT id, secret FROM backup_targets
     WHERE secret IS NOT NULL AND secret <> '' LIMIT 1`,
  ).first<{ id: string; secret: string }>()
  if (backup && !await decryptSecret(env, backup.id, backup.secret)) {
    throw new Error('credential_vault_key_mismatch')
  }
  const totp = await env.DB.prepare(
    `SELECT user_id, secret_ciphertext FROM totp_credentials
     WHERE secret_ciphertext <> '' LIMIT 1`,
  ).first<{ user_id: string; secret_ciphertext: string }>()
  if (totp && !await decryptTotpSecret(env, totp.user_id, totp.secret_ciphertext)) {
    throw new Error('credential_vault_key_mismatch')
  }
}

function safeError(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown_error'
  return error.message.replace(/[\r\n\t]/g, ' ').slice(0, 300)
}
