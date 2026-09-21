import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Env } from '../worker/env'
import {
  decryptSecret,
  decryptTotpSecret,
  encryptSecret,
  encryptTotpSecret,
} from '../worker/lib/crypto'
import { loadOrCreateVaultKey, LocalCredentialVaultNamespace } from './credential-vault'

const directories: string[] = []
const credentialId = '01m1r8923zajxnw9y0dhs6sy8j'

function directory(): string {
  const value = mkdtempSync(join(tmpdir(), 'inkstone-vault-'))
  directories.push(value)
  return value
}

function env(key: string): Env {
  return {
    CREDENTIAL_VAULT: new LocalCredentialVaultNamespace(key).asDurableObjectNamespace(),
  } as Env
}

afterEach(() => {
  for (const value of directories.splice(0)) rmSync(value, { recursive: true, force: true })
})

describe('local credential vault', () => {
  it('creates a protected key and reuses it across restarts', async () => {
    const path = join(directory(), 'secrets', 'vault.key')
    const firstKey = await loadOrCreateVaultKey(path)
    expect(statSync(path).mode & 0o077).toBe(0)
    expect(readFileSync(path, 'utf8')).not.toContain('password')
    const ciphertext = await encryptSecret(env(firstKey), credentialId, { password: 'secret-value' })
    const secondKey = await loadOrCreateVaultKey(path)
    expect(secondKey).toBe(firstKey)
    expect(await decryptSecret(env(secondKey), credentialId, ciphertext)).toEqual({ password: 'secret-value' })
  })

  it('fails closed for an invalid or overly permissive key file', async () => {
    const path = join(directory(), 'vault.key')
    await loadOrCreateVaultKey(path)
    chmodSync(path, 0o644)
    await expect(loadOrCreateVaultKey(path)).rejects.toThrow('credential_vault_key_permissions')
  })

  it('cannot decrypt credentials with a different key', async () => {
    const firstKey = await loadOrCreateVaultKey(join(directory(), 'first.key'))
    const secondKey = await loadOrCreateVaultKey(join(directory(), 'second.key'))
    const ciphertext = await encryptSecret(env(firstKey), credentialId, { password: 'secret-value' })
    expect(await decryptSecret(env(secondKey), credentialId, ciphertext)).toBeNull()
  })

  it('encrypts and decrypts TOTP secrets without plaintext output', async () => {
    const key = await loadOrCreateVaultKey(join(directory(), 'vault.key'))
    const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'
    const ciphertext = await encryptTotpSecret(env(key), credentialId, secret)
    expect(ciphertext).not.toContain(secret)
    expect(await decryptTotpSecret(env(key), credentialId, ciphertext)).toBe(secret)
  })
})
