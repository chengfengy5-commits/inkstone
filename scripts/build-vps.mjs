import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const version = process.env.INKSTONE_VERSION?.trim() || pkg.version
let revision = process.env.INKSTONE_REVISION?.trim()
if (!revision) {
  try {
    revision = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    revision = 'unknown'
  }
}

await build({
  entryPoints: ['src/vps/server.ts'],
  outfile: 'dist/vps/server.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: false,
  banner: {
    js: "import { createRequire as __inkstoneCreateRequire } from 'node:module'; const require = __inkstoneCreateRequire(import.meta.url);",
  },
  alias: {
    '@shared': './src/shared',
    'cloudflare:workers': './src/vps/cloudflare-workers-shim.ts',
  },
  define: {
    __INKSTONE_VERSION__: JSON.stringify(version),
    __INKSTONE_REVISION__: JSON.stringify(revision),
  },
})
