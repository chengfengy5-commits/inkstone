import { Buffer } from 'node:buffer'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { VpsConfig } from './config'
import { installNodeWebPolyfills } from './node-web-polyfills'
import { createVpsRuntime, type VpsRuntime } from './runtime'

installNodeWebPolyfills()

const roots: string[] = []

function config(): VpsConfig {
  const root = mkdtempSync(join(tmpdir(), 'inkstone-oauth-'))
  const assetsDir = join(root, 'assets')
  const dataDir = join(root, 'data')
  roots.push(root)
  mkdirSync(assetsDir, { recursive: true })
  writeFileSync(join(assetsDir, 'index.html'), '<!doctype html><title>OAuth test</title>')
  return {
    host: '127.0.0.1',
    port: 7712,
    publicUrl: 'http://127.0.0.1:7712',
    dataDir,
    assetsDir,
    vaultKeyPath: join(dataDir, 'secrets', 'vault.key'),
    maintenanceIntervalMs: 60_000,
    version: '0.8.0-test',
    revision: 'oauth-test',
  }
}

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`http://127.0.0.1:7712${path}`, init)
}

function cookie(response: Response, name: string): string {
  const values = response.headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? '']
  const found = values.find((value) => value.startsWith(`${name}=`)) ?? ''
  return found.split(';', 1)[0] ?? ''
}

async function form(runtime: VpsRuntime, path: string, values: Record<string, string>, headers: HeadersInit = {}) {
  return runtime.fetch(request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(values).toString(),
  }))
}

async function mcpRequest(runtime: VpsRuntime, token: string, body: unknown): Promise<Response> {
  return runtime.fetch(request('/mcp', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Host: '127.0.0.1:7712',
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify(body),
  }))
}

function mcpInitialize(runtime: VpsRuntime, token: string): Promise<Response> {
  return mcpRequest(runtime, token, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'vps-oauth-test', version: '1' },
    },
  })
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('VPS OAuth persistence', () => {
  it('rate limits registrations by the trusted reverse-proxy address', async () => {
    const runtime = await createVpsRuntime(config())
    const statuses: number[] = []
    for (let attempt = 0; attempt < 21; attempt += 1) {
      const response = await runtime.fetch(request('/oauth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Real-IP': '192.0.2.10',
          'CF-Connecting-IP': `198.51.100.${attempt + 1}`,
        },
        body: JSON.stringify({
          client_name: `VPS rate-limit test ${attempt}`,
          redirect_uris: ['http://127.0.0.1/callback'],
          token_endpoint_auth_method: 'none',
          grant_types: ['authorization_code'],
          response_types: ['code'],
        }),
      }))
      statuses.push(response.status)
    }

    expect(statuses.slice(0, 20)).toEqual(Array(20).fill(201))
    expect(statuses[20]).toBe(429)
    await runtime.close()
  })

  it('registers, issues, refreshes, and revokes MCP tokens across restart', async () => {
    const runtimeConfig = config()
    const first = await createVpsRuntime(runtimeConfig)
    const registeredOwner = await first.fetch(request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Inkstone-Client': '1' },
      body: JSON.stringify({ username: 'owner', password: 'supersecret99', locale: 'en-US' }),
    }))
    expect(registeredOwner.status).toBe(201)
    const session = cookie(registeredOwner, 'inkstone_session')

    const registration = await first.fetch(request('/oauth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Real-IP': '127.0.0.1' },
      body: JSON.stringify({
        client_name: 'VPS OAuth test',
        redirect_uris: ['http://127.0.0.1/callback'],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      }),
    }))
    expect(registration.status).toBe(201)
    const client = await registration.json() as { client_id: string }
    expect(client.client_id).toBeTruthy()

    const verifier = 'vps-oauth-verifier-0123456789abcdefghijklmnopqrstuvwxyz'
    const challengeBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
    const challenge = Buffer.from(challengeBytes).toString('base64url')
    const authorization = new URL('/authorize', runtimeConfig.publicUrl)
    authorization.search = new URLSearchParams({
      response_type: 'code',
      client_id: client.client_id,
      redirect_uri: 'http://127.0.0.1/callback',
      scope: 'notes:read notes:write offline_access',
      state: 'state-vps-test',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      resource: `${runtimeConfig.publicUrl}/mcp`,
    }).toString()
    const consent = await first.fetch(new Request(authorization, { headers: { Cookie: session } }))
    expect(consent.status).toBe(200)
    const html = await consent.text()
    const csrf = /name="csrf" value="([^"]+)"/.exec(html)?.[1]
    expect(csrf).toBeTruthy()
    const csrfCookie = cookie(consent, 'inkstone_mcp_csrf')

    const approved = await form(first, `${authorization.pathname}${authorization.search}`, {
      csrf: csrf!,
      decision: 'approve',
      scope: 'notes:write',
    }, {
      Cookie: `${session}; ${csrfCookie}`,
      Origin: runtimeConfig.publicUrl,
    })
    expect(approved.status).toBe(302)
    const callback = new URL(approved.headers.get('location')!)
    expect(callback.searchParams.get('state')).toBe('state-vps-test')
    const code = callback.searchParams.get('code')
    expect(code).toBeTruthy()

    const issued = await form(first, '/oauth/token', {
      grant_type: 'authorization_code',
      client_id: client.client_id,
      redirect_uri: 'http://127.0.0.1/callback',
      code: code!,
      code_verifier: verifier,
      resource: `${runtimeConfig.publicUrl}/mcp`,
    })
    expect(issued.status).toBe(200)
    const tokens = await issued.json() as { access_token: string; refresh_token: string }
    const initialized = await mcpInitialize(first, tokens.access_token)
    expect(initialized.status, await initialized.clone().text()).toBe(200)
    const noteId = '01j00000000000000000000000'
    const created = await mcpRequest(first, tokens.access_token, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'create_note',
        arguments: {
          operation_id: 'oauth-test-create-1',
          note_id: noteId,
          title: 'OAuth MCP note',
          content: 'oauth-mcp-marker',
        },
      },
    })
    expect(created.status, await created.clone().text()).toBe(200)
    expect(await created.text()).toContain('OAuth MCP note')

    const apiKeyResponse = await first.fetch(request('/api/mcp/keys', {
      method: 'POST',
      headers: {
        Cookie: session,
        'Content-Type': 'application/json',
        'X-Inkstone-Client': '1',
      },
      body: JSON.stringify({ name: 'VPS restart key' }),
    }))
    expect(apiKeyResponse.status, await apiKeyResponse.clone().text()).toBe(201)
    const apiKey = await apiKeyResponse.json() as { token: string }

    expect((await first.fetch(request('/api/mcp', {
      method: 'PUT',
      headers: {
        Cookie: session,
        'Content-Type': 'application/json',
        'X-Inkstone-Client': '1',
      },
      body: JSON.stringify({ writeEnabled: false }),
    }))).status).toBe(200)
    const readOnlyKeyResponse = await first.fetch(request('/api/mcp/keys', {
      method: 'POST',
      headers: {
        Cookie: session,
        'Content-Type': 'application/json',
        'X-Inkstone-Client': '1',
      },
      body: JSON.stringify({ name: 'Read-only key' }),
    }))
    expect(readOnlyKeyResponse.status).toBe(201)
    const readOnlyKey = await readOnlyKeyResponse.json() as { token: string }
    expect((await first.fetch(request('/api/mcp', {
      method: 'PUT',
      headers: {
        Cookie: session,
        'Content-Type': 'application/json',
        'X-Inkstone-Client': '1',
      },
      body: JSON.stringify({ writeEnabled: true }),
    }))).status).toBe(200)
    await first.close()

    const restarted = await createVpsRuntime(runtimeConfig)
    expect((await mcpInitialize(restarted, tokens.access_token)).status).toBe(200)
    expect((await mcpInitialize(restarted, apiKey.token)).status).toBe(200)
    const updated = await mcpRequest(restarted, apiKey.token, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'edit_note',
        arguments: {
          operation_id: 'api-key-edit-1',
          note_id: noteId,
          expected_rev: 1,
          operation: 'append',
          text: '\napi-key-update-marker',
        },
      },
    })
    expect(updated.status, await updated.clone().text()).toBe(200)
    expect(await updated.text()).toContain('"rev":2')

    const denied = await mcpRequest(restarted, readOnlyKey.token, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'edit_note',
        arguments: {
          operation_id: 'read-only-edit-1',
          note_id: noteId,
          expected_rev: 2,
          operation: 'append',
          text: '\nshould-not-be-written',
        },
      },
    })
    expect(denied.status).toBe(200)
    const deniedBody = await denied.text()
    expect(deniedBody).toContain('"isError":true')
    expect(deniedBody).toContain('notes:write')

    const searched = await mcpRequest(restarted, tokens.access_token, {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'search', arguments: { query: 'api-key-update-marker', mode: 'lexical' } },
    })
    expect(searched.status, await searched.clone().text()).toBe(200)
    expect(await searched.text()).toContain('OAuth MCP note')
    const refreshed = await form(restarted, '/oauth/token', {
      grant_type: 'refresh_token',
      client_id: client.client_id,
      refresh_token: tokens.refresh_token,
      resource: `${runtimeConfig.publicUrl}/mcp`,
    })
    expect(refreshed.status).toBe(200)
    const replacement = await refreshed.json() as { access_token: string }

    const revoked = await form(restarted, '/oauth/token', {
      token: replacement.access_token,
      client_id: client.client_id,
    })
    expect(revoked.status).toBe(200)
    expect((await mcpInitialize(restarted, replacement.access_token)).status).toBe(401)
    expect((await mcpInitialize(restarted, 'invalid-token')).status).toBe(401)
    await restarted.close()
  })
})
