import assert from 'node:assert/strict'
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import test from 'node:test'

const execFileAsync = promisify(execFile)
const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const installScript = join(scriptDirectory, 'install-learning-library-collector.sh')

test('applies an idempotent timer cutover and restores the previous timer states', async () => {
  const root = await mkdtemp(join(tmpdir(), 'inkstone-learning-cutover-'))
  const systemdDirectory = join(root, 'systemd')
  const runtimeDirectory = join(root, 'runtime')
  const timerStateDirectory = join(root, 'timer-state')
  const stateFile = join(runtimeDirectory, 'cutover-state')
  const fakeSystemctl = join(root, 'systemctl')
  const environment = {
    ...process.env,
    ALLOW_NON_ROOT_FOR_TESTS: '1',
    SYSTEMD_DIRECTORY: systemdDirectory,
    CUTOVER_STATE_FILE: stateFile,
    SYSTEMCTL_BIN: fakeSystemctl,
    SYSTEMCTL_STATE_DIRECTORY: timerStateDirectory,
  }

  try {
    await mkdir(systemdDirectory, { recursive: true })
    await mkdir(runtimeDirectory, { recursive: true })
    await mkdir(timerStateDirectory, { recursive: true })
    await writeFile(join(runtimeDirectory, 'historical-state-marker'), 'keep me')
    await writeFile(join(systemdDirectory, 'inkstone-tech-digest.service'), 'previous service\n')
    await writeFile(join(systemdDirectory, 'inkstone-tech-digest.timer'), 'previous timer\n')
    await writeTimerState(timerStateDirectory, 'inkstone-tech-digest.timer', 'disabled')
    await writeTimerState(timerStateDirectory, 'inkstone-github-trending.timer', 'enabled')
    await writeTimerState(timerStateDirectory, 'inkstone-ai-frontier.timer', 'enabled')
    await writeFile(fakeSystemctl, fakeSystemctlSource())
    await chmod(fakeSystemctl, 0o755)

    await execFileAsync(installScript, ['apply'], { env: environment })
    assert.equal(await readTimerState(timerStateDirectory, 'inkstone-tech-digest.timer'), 'enabled')
    assert.equal(await readTimerState(timerStateDirectory, 'inkstone-github-trending.timer'), 'disabled')
    assert.equal(await readTimerState(timerStateDirectory, 'inkstone-ai-frontier.timer'), 'disabled')
    assert.match(await readFile(join(systemdDirectory, 'inkstone-tech-digest.service'), 'utf8'), /learning-library-collector\.mjs/)
    assert.equal(await readFile(join(runtimeDirectory, 'historical-state-marker'), 'utf8'), 'keep me')

    const firstState = await readFile(stateFile, 'utf8')
    await execFileAsync(installScript, ['apply'], { env: environment })
    assert.equal(await readFile(stateFile, 'utf8'), firstState)

    await execFileAsync(installScript, ['rollback'], { env: environment })
    assert.equal(await readTimerState(timerStateDirectory, 'inkstone-tech-digest.timer'), 'disabled')
    assert.equal(await readTimerState(timerStateDirectory, 'inkstone-github-trending.timer'), 'enabled')
    assert.equal(await readTimerState(timerStateDirectory, 'inkstone-ai-frontier.timer'), 'enabled')
    assert.equal(await readFile(join(systemdDirectory, 'inkstone-tech-digest.service'), 'utf8'), 'previous service\n')
    assert.equal(await readFile(join(systemdDirectory, 'inkstone-tech-digest.timer'), 'utf8'), 'previous timer\n')
    assert.equal(await readFile(join(runtimeDirectory, 'historical-state-marker'), 'utf8'), 'keep me')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

async function writeTimerState(directory, unit, state) {
  await writeFile(join(directory, unit), `${state}\n`)
}

async function readTimerState(directory, unit) {
  return (await readFile(join(directory, unit), 'utf8')).trim()
}

function fakeSystemctlSource() {
  return `#!/bin/sh
set -eu
command="$1"
shift
case "$command" in
  daemon-reload)
    exit 0
    ;;
  is-enabled)
    unit="$1"
    if [ -f "$SYSTEMCTL_STATE_DIRECTORY/$unit" ]; then
      cat "$SYSTEMCTL_STATE_DIRECTORY/$unit"
      exit 0
    fi
    echo not-found
    exit 1
    ;;
  enable|disable)
    if [ "\${1:-}" = "--now" ]; then shift; fi
    unit="$1"
    if [ "$command" = "enable" ]; then state=enabled; else state=disabled; fi
    printf '%s\\n' "$state" > "$SYSTEMCTL_STATE_DIRECTORY/$unit"
    ;;
  mask)
    if [ "\${1:-}" = "--now" ]; then shift; fi
    printf 'masked\\n' > "$SYSTEMCTL_STATE_DIRECTORY/$1"
    ;;
  *)
    echo "unexpected systemctl command: $command" >&2
    exit 2
    ;;
esac
`
}
