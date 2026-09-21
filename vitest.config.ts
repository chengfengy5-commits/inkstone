import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const resolve = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve('./src/client'),
      '@shared': resolve('./src/shared'),
      'cloudflare:workers': resolve('./src/vps/cloudflare-workers-shim.ts'),
    },
  },
  test: {
    server: {
      deps: {
        inline: ['@cloudflare/workers-oauth-provider'],
      },
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
          exclude: [
            'src/vps/**/*.test.ts',
            'src/worker/lib/request.test.ts',
            'src/client/demo/backend.test.ts',
            'src/worker/lib/obsidian-import.test.ts',
          ],
        },
      },
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: [
            'src/vps/**/*.test.ts',
            'src/worker/lib/request.test.ts',
            'src/client/demo/backend.test.ts',
            'src/worker/lib/obsidian-import.test.ts',
          ],
        },
      },
    ],
  },
})
