// The notification compatibility gate (npm run test:notifications:compat): builds the real UI
// image (ui/Dockerfile, ui/nginx.conf) and the test-only fixture, serves both from one container
// (fixture under /__compat/), runs Playwright, then removes the container. Needs Docker only.
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const UI = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURE = resolve(UI, 'node_modules/.cache/notifications-compat')
const IMAGE = 'neonradar-ui-notifications-compat'
const CONTAINER = `${IMAGE}-${process.pid}`

/** @param {string} command @param {string[]} args @param {import('node:child_process').SpawnSyncOptions} [options] */
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: UI,
    stdio: 'inherit',
    encoding: 'utf-8',
    ...options,
  })
  if (result.status !== 0)
    throw new Error(`${command} ${args[0]} failed (${result.status ?? result.signal})`)
  return result
}

/** @param {string} url */
async function waitFor(url) {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      // nginx is still starting
    }
    await new Promise((done) => setTimeout(done, 500))
  }
  throw new Error(`${url} did not answer`)
}

/** @param {string} script @param {string[]} args @param {import('node:child_process').SpawnSyncOptions} [options] */
const node = (script, args, options) =>
  run(process.execPath, [resolve(UI, script), ...args], options)
const fixtureBuild = 'build e2e/notifications-fixture --config vite.config.ts --base /__compat/'
node('node_modules/vite/bin/vite.js', [
  ...fixtureBuild.split(' '),
  '--outDir',
  FIXTURE,
  '--emptyOutDir',
])
run('docker', ['build', '--file', 'ui/Dockerfile', '--tag', IMAGE, '.'], { cwd: resolve(UI, '..') })
try {
  const serve = `run --detach --name ${CONTAINER} --add-host api:127.0.0.1 --publish 127.0.0.1::8080`
  const mount = `${FIXTURE}:/usr/share/nginx/html/__compat:ro`
  run('docker', [...serve.split(' '), '--volume', mount, IMAGE])
  const port = String(
    run('docker', ['port', CONTAINER, '8080/tcp'], { stdio: 'pipe' }).stdout,
  ).trim()
  const baseUrl = `http://127.0.0.1:${port.split(':').pop()}`
  await waitFor(baseUrl)
  node('node_modules/@playwright/test/cli.js', ['test', 'e2e/notifications-compat', 'e2e/shell'], {
    env: { ...process.env, E2E_BASE_URL: baseUrl, NR_NOTIFICATIONS_COMPAT: '1' },
  })
} finally {
  spawnSync('docker', ['rm', '--force', CONTAINER], { stdio: 'ignore' })
}
