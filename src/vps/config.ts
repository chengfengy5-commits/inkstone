import { isIP } from 'node:net'
import { isAbsolute, resolve } from 'node:path'

export interface VpsConfig {
  host: string
  port: number
  publicUrl: string
  dataDir: string
  assetsDir: string
  vaultKeyPath: string
  maintenanceIntervalMs: number
  version: string
  revision: string
}

export function loadVpsConfig(
  source: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): VpsConfig {
  const host = source.INKSTONE_HOST?.trim() || '0.0.0.0'
  if (host.toLowerCase() !== 'localhost' && isIP(host) === 0) {
    throw new Error('INKSTONE_HOST must be an IP address or localhost')
  }
  const port = integer(source.INKSTONE_PORT ?? '7712', 'INKSTONE_PORT', 1, 65535)
  const dataDir = absolutePath(source.INKSTONE_DATA_DIR ?? '/data', 'INKSTONE_DATA_DIR', cwd)
  const assetsDir = absolutePath(source.INKSTONE_ASSETS_DIR ?? resolve(cwd, 'dist/client'), 'INKSTONE_ASSETS_DIR', cwd)
  const vaultKeyPath = absolutePath(
    source.INKSTONE_VAULT_KEY_PATH ?? resolve(dataDir, 'secrets/vault.key'),
    'INKSTONE_VAULT_KEY_PATH',
    cwd,
  )
  const maintenanceIntervalMs = integer(
    source.INKSTONE_MAINTENANCE_INTERVAL_MS ?? '900000',
    'INKSTONE_MAINTENANCE_INTERVAL_MS',
    60_000,
    86_400_000,
  )
  const publicUrl = normalizePublicUrl(source.INKSTONE_PUBLIC_URL ?? `http://127.0.0.1:${port}`)
  const version = safeBuildValue(source.INKSTONE_VERSION ?? __INKSTONE_VERSION__, 'INKSTONE_VERSION')
  const revision = safeBuildValue(source.INKSTONE_REVISION ?? __INKSTONE_REVISION__, 'INKSTONE_REVISION')
  return {
    host,
    port,
    publicUrl,
    dataDir,
    assetsDir,
    vaultKeyPath,
    maintenanceIntervalMs,
    version,
    revision,
  }
}

function integer(value: string, name: string, minimum: number, maximum: number): number {
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be an integer`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`)
  }
  return parsed
}

function absolutePath(value: string, name: string, cwd: string): string {
  const path = value.trim()
  if (!path) throw new Error(`${name} is required`)
  if (!isAbsolute(path)) throw new Error(`${name} must be an absolute path`)
  const resolved = resolve(cwd, path)
  return resolved
}

function normalizePublicUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('INKSTONE_PUBLIC_URL must be a valid URL')
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('INKSTONE_PUBLIC_URL must contain only scheme, host, and optional port')
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error('INKSTONE_PUBLIC_URL must use HTTPS except for loopback development')
  }
  return url.origin
}

function safeBuildValue(value: string, name: string): string {
  const normalized = value.trim()
  if (!normalized || normalized.length > 128 || !/^[A-Za-z0-9._+-]+$/.test(normalized)) {
    throw new Error(`${name} is invalid`)
  }
  return normalized
}

declare const __INKSTONE_VERSION__: string
declare const __INKSTONE_REVISION__: string
