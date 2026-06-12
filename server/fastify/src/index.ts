import { constants as osConstants } from 'node:os'
import { pathToFileURL } from 'node:url'
import type { FastifyInstance } from 'fastify'
import { buildApp } from './app.js'

export const API_SHUTDOWN_FORCE_EXIT_MS = 4_000

const shutdownSignals = ['SIGTERM', 'SIGINT'] as const

export type ShutdownSignal = (typeof shutdownSignals)[number]

export type ShutdownTimer = {
  unref?: () => void
}

type ShutdownSetTimeout = (callback: () => void, ms: number) => ShutdownTimer
type ShutdownClearTimeout = (timer: ShutdownTimer) => void
type ShutdownProcess = {
  once(signal: ShutdownSignal, listener: () => void): unknown
  off(signal: ShutdownSignal, listener: () => void): unknown
}
type ShutdownApp = {
  close: () => Promise<void> | void
  log: FastifyInstance['log']
}

interface AppShutdownOptions {
  exitOnShutdown?: boolean
  forceExitMs?: number
  setTimeout?: ShutdownSetTimeout
  clearTimeout?: ShutdownClearTimeout
  exit?: (code: number) => void
}

interface InstallShutdownHandlerOptions extends AppShutdownOptions {
  process?: ShutdownProcess
}

export interface InstalledShutdownHandlers {
  shutdown: (signal: ShutdownSignal) => Promise<void>
  getShutdownPromise: () => Promise<void> | null
  dispose: () => void
}

export function signalExitCode(signal: ShutdownSignal): number {
  return 128 + osConstants.signals[signal]
}

export function createAppShutdown(
  app: ShutdownApp,
  opts: AppShutdownOptions = {},
): (signal: ShutdownSignal) => Promise<void> {
  const exitOnShutdown = opts.exitOnShutdown ?? false
  const forceExitMs = opts.forceExitMs ?? API_SHUTDOWN_FORCE_EXIT_MS
  const setTimeoutFn: ShutdownSetTimeout = opts.setTimeout ?? ((callback, ms) => setTimeout(callback, ms))
  const clearTimeoutFn: ShutdownClearTimeout =
    opts.clearTimeout ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>))
  const exit = opts.exit ?? process.exit

  let shutdownPromise: Promise<void> | null = null

  return (signal: ShutdownSignal) => {
    if (shutdownPromise) {
      app.log.info({ signal }, 'shutdown already in progress')
      return shutdownPromise
    }

    shutdownPromise = (async () => {
      app.log.info({ signal }, 'received shutdown signal; closing Fastify app')
      const exitCode = signalExitCode(signal)
      const forceExitTimer = setTimeoutFn(() => {
        app.log.error({ signal, timeoutMs: forceExitMs }, 'Fastify shutdown timed out; forcing process exit')
        if (exitOnShutdown) {
          exit(exitCode)
        }
      }, forceExitMs)
      forceExitTimer.unref?.()

      try {
        await app.close()
      } catch (err) {
        clearTimeoutFn(forceExitTimer)
        app.log.error({ err, signal }, 'Fastify shutdown failed')
        if (exitOnShutdown) {
          exit(1)
          return
        }
        throw err
      }

      clearTimeoutFn(forceExitTimer)

      if (exitOnShutdown) {
        exit(exitCode)
      }
    })()

    return shutdownPromise
  }
}

export function installShutdownHandlers(
  app: ShutdownApp,
  opts: InstallShutdownHandlerOptions = {},
): InstalledShutdownHandlers {
  const signalProcess = opts.process ?? process
  const shutdown = createAppShutdown(app, opts)
  let pendingShutdown: Promise<void> | null = null

  const runShutdown = (signal: ShutdownSignal): void => {
    pendingShutdown = shutdown(signal)
    void pendingShutdown.catch((err) => {
      app.log.error({ err, signal }, 'shutdown signal handler failed')
    })
  }

  const onSigterm = (): void => runShutdown('SIGTERM')
  const onSigint = (): void => runShutdown('SIGINT')

  signalProcess.once('SIGTERM', onSigterm)
  signalProcess.once('SIGINT', onSigint)

  return {
    shutdown,
    getShutdownPromise: () => pendingShutdown,
    dispose: () => {
      signalProcess.off('SIGTERM', onSigterm)
      signalProcess.off('SIGINT', onSigint)
    },
  }
}

export async function main(): Promise<void> {
  const { app, config } = await buildApp()
  installShutdownHandlers(app, { exitOnShutdown: true })

  try {
    await app.listen({ host: config.host, port: config.port })
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

function isEntrypoint(): boolean {
  const argvEntrypoint = process.argv[1]
  return Boolean(argvEntrypoint && import.meta.url === pathToFileURL(argvEntrypoint).href)
}

if (isEntrypoint()) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
