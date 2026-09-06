import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { parseAgentDataSandboxMode, prepareAgentDataSandbox } from '../server/fastify/src/agentDataSandbox.js'
import { resolveAgentDevHost } from './agent-dev-host.js'

const repoRoot = process.cwd()
const frontendPort = parsePort(process.env.RISU_AGENT_DEV_PORT, 6418, 'RISU_AGENT_DEV_PORT')
const apiPort = parsePort(process.env.RISU_AGENT_API_PORT, 6419, 'RISU_AGENT_API_PORT')
const traceMode = process.env.RISU_API_TRACE_MODE?.trim().toLowerCase()
// Human mode binds specifically to Tailscale so it is not exposed through a
// public or LAN interface. Agent mode bypasses auth and remains loopback-only.
const hostResolution = resolveAgentDevHost(process.env.RISU_AGENT_DEV_HOST, traceMode)
const host = hostResolution.host
const defaultAuthBypass = traceMode === 'human' ? 'FALSE' : 'TRUE'
// Agent mode runs against a disposable clone of the human data dir so
// agent-driven sessions can mutate state freely. An explicit RISU_API_DATA_DIR
// is honored as-is (no cloning); human mode keeps the server default (data/).
const sandboxDataDir =
  traceMode === 'human' || process.env.RISU_API_DATA_DIR ? undefined : path.join(repoRoot, 'data-agent')
const shutdownGraceMs = 5_000

type ManagedProcess = {
  name: string
  child: ChildProcess
}

const children: ManagedProcess[] = []
let shuttingDown = false

function parsePort(raw: string | undefined, fallback: number, name: string): number {
  if (!raw) return fallback
  const port = Number(raw)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid ${name}: ${raw}`)
  }
  return port
}

function log(message: string): void {
  console.log(`[dev:agent] ${message}`)
}

function urlHost(hostname: string): string {
  return hostname.includes(':') ? `[${hostname}]` : hostname
}

function spawnManaged(name: string, command: string, args: string[], env: NodeJS.ProcessEnv): void {
  const child = spawn(command, args, {
    cwd: repoRoot,
    env,
    stdio: 'inherit',
  })

  const managed = { name, child }
  children.push(managed)

  child.once('exit', (code, signal) => {
    const index = children.indexOf(managed)
    if (index >= 0) children.splice(index, 1)

    if (shuttingDown) return

    const reason = signal ? `signal ${signal}` : `exit code ${code ?? 'unknown'}`
    log(`${name} stopped (${reason}); shutting down the agent dev server`)
    void shutdown(code && code > 0 ? code : 1)
  })
}

async function stopChild({ child }: ManagedProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return
  }

  await new Promise<void>((resolveStop) => {
    const forceKill = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL')
      }
    }, shutdownGraceMs)

    child.once('exit', () => {
      clearTimeout(forceKill)
      resolveStop()
    })

    child.kill('SIGTERM')
  })
}

async function shutdown(exitCode: number): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true

  await Promise.all(children.splice(0).map((child) => stopChild(child)))
  process.exit(exitCode)
}

if (traceMode === 'human' && hostResolution.source === 'loopback') {
  log('Tailscale IPv4 address unavailable; keeping dev:human on loopback')
}
log(`frontend: http://${urlHost(host)}:${frontendPort}`)
log(`api: http://${urlHost(host)}:${apiPort} (proxied through /api on ${frontendPort})`)

if (sandboxDataDir) {
  // Prepared here (not in the server) so tsx-watch restarts of the API child
  // reuse the same sandbox for the whole dev session.
  const sandboxMode = parseAgentDataSandboxMode(process.env.RISU_AGENT_DATA_MODE)
  const summary = await prepareAgentDataSandbox({
    sourceDataDir: path.join(repoRoot, 'data'),
    sandboxDataDir,
    mode: sandboxMode,
  })
  log(`data sandbox (${sandboxMode}): ${summary}`)
}

spawnManaged('api', 'pnpm', ['exec', 'tsx', 'watch', 'server/fastify/src/index.ts'], {
  ...process.env,
  ...(sandboxDataDir ? { RISU_API_DATA_DIR: sandboxDataDir } : {}),
  RISU_API_HOST: host,
  RISU_API_PORT: String(apiPort),
  RISU_API_STATIC_ROOT: process.env.RISU_API_STATIC_ROOT ?? 'none',
  RISU_AGENT_DEV_AUTH_BYPASS: process.env.RISU_AGENT_DEV_AUTH_BYPASS ?? defaultAuthBypass,
})

spawnManaged('vite', 'pnpm', ['exec', 'vite', '--host', host, '--port', String(frontendPort), '--strictPort'], {
  ...process.env,
  RISU_API_PROXY_TARGET: `http://${urlHost(host)}:${apiPort}`,
  VITE_RISU_AGENT_DEV_IGNORE_REALM_TERMS: process.env.VITE_RISU_AGENT_DEV_IGNORE_REALM_TERMS ?? 'TRUE',
})

process.once('SIGINT', () => void shutdown(0))
process.once('SIGTERM', () => void shutdown(0))
