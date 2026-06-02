import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, statSync, unlinkSync, watch } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'

const repoRoot = process.cwd()
const entrypoint = 'server/fastify/src/index.ts'
const flagPath = resolve(repoRoot, process.env.RISU_API_RESTART_FLAG ?? '.risu-api-restart')
const flagBasename = basename(flagPath)
const restartDebounceMs = 150
const shutdownGraceMs = 5_000

let child: ChildProcess | undefined
let childStopping = false
let shuttingDown = false
let restartTimer: NodeJS.Timeout | undefined

function log(message: string): void {
  console.log(`[api:dev:flag] ${message}`)
}

function readFlagStamp(): string {
  try {
    const stat = statSync(flagPath)
    return `${stat.mtimeMs}:${stat.size}`
  } catch {
    return ''
  }
}

function ensureFlagParent(): void {
  mkdirSync(dirname(flagPath), { recursive: true })
}

function removeFlagFile(): void {
  try {
    unlinkSync(flagPath)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err
    }
  }
}

function prepareFlagPath(): void {
  ensureFlagParent()
  removeFlagFile()
}

function startServer(): void {
  childStopping = false
  child = spawn('tsx', [entrypoint], {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
  })

  child.once('exit', (code, signal) => {
    child = undefined
    if (shuttingDown || childStopping) {
      return
    }
    const reason = signal ? `signal ${signal}` : `exit code ${code ?? 'unknown'}`
    log(`server stopped unexpectedly (${reason})`)
  })
}

async function stopServer(): Promise<void> {
  const running = child
  if (!running || running.exitCode !== null || running.signalCode !== null) {
    return
  }

  childStopping = true

  await new Promise<void>((resolveStop) => {
    const forceKill = setTimeout(() => {
      if (running.exitCode === null && running.signalCode === null) {
        running.kill('SIGKILL')
      }
    }, shutdownGraceMs)

    running.once('exit', () => {
      clearTimeout(forceKill)
      resolveStop()
    })

    running.kill('SIGTERM')
  })
}

async function restartServer(reason: string): Promise<void> {
  if (shuttingDown) {
    return
  }
  log(`restarting server (${reason})`)
  await stopServer()
  startServer()
  removeFlagFile()
}

function scheduleRestart(reason: string): void {
  if (restartTimer) {
    clearTimeout(restartTimer)
  }

  restartTimer = setTimeout(() => {
    restartTimer = undefined
    const nextStamp = readFlagStamp()
    if (!nextStamp) {
      return
    }
    void restartServer(reason)
  }, restartDebounceMs)
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) {
    return
  }
  shuttingDown = true
  if (restartTimer) {
    clearTimeout(restartTimer)
  }
  watcher.close()
  log(`received ${signal}; stopping server`)
  await stopServer()
  process.exit(0)
}

prepareFlagPath()
log(`starting API; create or touch ${flagPath} to restart; it will be deleted after restart`)
startServer()

const watcher = watch(dirname(flagPath), (eventType, filename) => {
  if (filename?.toString() !== flagBasename) {
    return
  }

  if (eventType === 'change' || eventType === 'rename') {
    scheduleRestart(`${eventType} on ${flagPath}`)
  }
})

process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))
void watcher
