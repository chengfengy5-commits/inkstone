import { describe, expect, it } from 'vitest'
import { loadVpsConfig } from './config'

const build = {
  INKSTONE_VERSION: '0.8.0-test',
  INKSTONE_REVISION: 'abcdef1',
}

describe('loadVpsConfig', () => {
  it('loads safe production values', () => {
    const config = loadVpsConfig({
      ...build,
      INKSTONE_HOST: '0.0.0.0',
      INKSTONE_PORT: '7712',
      INKSTONE_PUBLIC_URL: 'https://inkstone.example.com',
      INKSTONE_DATA_DIR: '/srv/inkstone/data',
      INKSTONE_ASSETS_DIR: '/app/dist/client',
      INKSTONE_VAULT_KEY_PATH: '/srv/inkstone/secrets/vault.key',
      INKSTONE_MAINTENANCE_INTERVAL_MS: '60000',
    })
    expect(config).toMatchObject({
      port: 7712,
      publicUrl: 'https://inkstone.example.com',
      version: '0.8.0-test',
      revision: 'abcdef1',
    })
  })

  it('rejects insecure public URLs and invalid numeric values', () => {
    expect(() => loadVpsConfig({ ...build, INKSTONE_PUBLIC_URL: 'http://inkstone.example.com' }))
      .toThrow('HTTPS')
    expect(() => loadVpsConfig({ ...build, INKSTONE_PORT: 'not-a-port' })).toThrow('INKSTONE_PORT')
    expect(() => loadVpsConfig({ ...build, INKSTONE_MAINTENANCE_INTERVAL_MS: '1' }))
      .toThrow('INKSTONE_MAINTENANCE_INTERVAL_MS')
    expect(() => loadVpsConfig({ ...build, INKSTONE_HOST: '999.999.999.999' }))
      .toThrow('INKSTONE_HOST')
    expect(() => loadVpsConfig({ ...build, INKSTONE_DATA_DIR: './data' }))
      .toThrow('INKSTONE_DATA_DIR')
  })

  it('accepts a bare IPv6 bind address', () => {
    expect(loadVpsConfig({ ...build, INKSTONE_HOST: '::1' }).host).toBe('::1')
  })

  it('does not include secret environment values in validation errors', () => {
    const secret = 'do-not-print-this-secret'
    expect(() => loadVpsConfig({ ...build, INKSTONE_PUBLIC_URL: secret })).toThrow('INKSTONE_PUBLIC_URL')
    try {
      loadVpsConfig({ ...build, INKSTONE_PUBLIC_URL: secret })
    } catch (error) {
      expect(String(error)).not.toContain(secret)
    }
  })
})
