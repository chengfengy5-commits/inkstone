import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EN_US_MESSAGES } from '@shared/locales/en-US'
import { ZH_CN_MESSAGES } from '@shared/locales/zh-CN'

const deploymentNeutralKeys = [
  'app.meta_description',
  'seed.welcome_note',
  'settings.mcp_ai_search_desc',
  'settings.mcp_ai_search_unavailable_desc',
] as const

describe('deployment-neutral user-facing wording', () => {
  it.each([
    ['en-US', EN_US_MESSAGES],
    ['zh-CN', ZH_CN_MESSAGES],
  ])('does not advertise a Cloudflare runtime in %s', (_locale, messages) => {
    for (const key of deploymentNeutralKeys) {
      expect(messages[key]).not.toMatch(/cloudflare|workers ai|wrangler/i)
    }
  })

  it('keeps the static HTML metadata deployment-neutral before the client starts', () => {
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')
    expect(html).not.toMatch(/cloudflare|workers ai|wrangler/i)
  })
})
