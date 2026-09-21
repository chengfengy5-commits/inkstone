import { randomBytes } from 'node:crypto'
import { Buffer as NodeBuffer } from 'node:buffer'
import { chmod, mkdir, open, readFile, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { CredentialVault } from '../worker/durable/credential-vault'

const MASTER_KEY_NAME = 'backup-master-key-v1'
const MASTER_KEY_BYTES = 32

export async function loadOrCreateVaultKey(path: string, createIfMissing = true): Promise<string> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  try {
    const details = await stat(path)
    if ((details.mode & 0o077) !== 0) throw new Error('credential_vault_key_permissions')
    return validateKey((await readFile(path, 'utf8')).trim())
  } catch (error) {
    if (!isMissing(error)) throw error
    if (!createIfMissing) throw new Error('credential_vault_key_missing')
  }

  const encoded = NodeBuffer.from(randomBytes(MASTER_KEY_BYTES)).toString('base64url')
  const handle = await open(path, 'wx', 0o600)
  try {
    await handle.writeFile(encoded + '\n', 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  await chmod(path, 0o600)
  return encoded
}

export class LocalCredentialVaultNamespace {
  private readonly vault: CredentialVault

  constructor(encodedMasterKey: string) {
    const key = validateKey(encodedMasterKey)
    const storage = {
      get: async <T>(name: string) => name === MASTER_KEY_NAME ? key as T : undefined,
      put: async () => {
        throw new Error('credential_vault_key_is_immutable')
      },
    }
    const state = {
      storage,
      blockConcurrencyWhile: async <T>(callback: () => Promise<T>) => callback(),
      getWebSockets: () => [],
      acceptWebSocket: () => undefined,
    } as unknown as DurableObjectState
    this.vault = new CredentialVault(state)
  }

  idFromName(name: string): DurableObjectId {
    if (!name) throw new Error('credential_vault_invalid_name')
    return name as unknown as DurableObjectId
  }

  get(_id: DurableObjectId): DurableObjectStub {
    return {
      fetch: (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init)
        return this.vault.fetch(request)
      },
    } as DurableObjectStub
  }

  asDurableObjectNamespace(): DurableObjectNamespace {
    return this as unknown as DurableObjectNamespace
  }
}

function validateKey(value: string): string {
  let bytes: NodeBuffer
  try {
    bytes = NodeBuffer.from(value, 'base64url')
  } catch {
    throw new Error('credential_vault_key_invalid')
  }
  if (bytes.byteLength !== MASTER_KEY_BYTES || !/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new Error('credential_vault_key_invalid')
  }
  return value
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}
