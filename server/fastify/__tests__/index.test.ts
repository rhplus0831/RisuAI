import Fastify from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  API_SHUTDOWN_FORCE_EXIT_MS,
  createAppShutdown,
  installShutdownHandlers,
  signalExitCode,
  type ShutdownSignal,
  type ShutdownTimer,
} from '../src/index.js'

type ShutdownTestApp = Parameters<typeof createAppShutdown>[0]

class FakeSignalProcess {
  private readonly listeners = new Map<ShutdownSignal, Set<() => void>>()

  once(signal: ShutdownSignal, listener: () => void): this {
    const signalListeners = this.listeners.get(signal) ?? new Set<() => void>()
    signalListeners.add(listener)
    this.listeners.set(signal, signalListeners)
    return this
  }

  off(signal: ShutdownSignal, listener: () => void): this {
    this.listeners.get(signal)?.delete(listener)
    return this
  }

  emit(signal: ShutdownSignal): void {
    const signalListeners = [...(this.listeners.get(signal) ?? [])]
    this.listeners.set(signal, new Set())
    for (const listener of signalListeners) {
      listener()
    }
  }
}

interface TimerRecord extends ShutdownTimer {
  callback: () => void
  ms: number
  unref: () => void
  cleared: boolean
}

function createTimerHarness(): {
  timers: TimerRecord[]
  setTimeout: (callback: () => void, ms: number) => ShutdownTimer
  clearTimeout: (timer: ShutdownTimer) => void
} {
  const timers: TimerRecord[] = []
  return {
    timers,
    setTimeout: vi.fn((callback: () => void, ms: number): ShutdownTimer => {
      const timer: TimerRecord = {
        callback,
        ms,
        unref: vi.fn(),
        cleared: false,
      }
      timers.push(timer)
      return timer
    }),
    clearTimeout: vi.fn((timer: ShutdownTimer): void => {
      ;(timer as TimerRecord).cleared = true
    }),
  }
}

function createLog(): ShutdownTestApp['log'] {
  const log = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
    level: 'silent',
  } as unknown as ShutdownTestApp['log']
  log.child = vi.fn(() => log)
  return log
}

async function expectSignalClosesApp(signal: ShutdownSignal): Promise<void> {
  const app = Fastify({ logger: false })
  const signalProcess = new FakeSignalProcess()
  const timerHarness = createTimerHarness()
  const closeSpy = vi.spyOn(app, 'close')
  const onCloseEvents: string[] = []
  app.addHook('onClose', async () => {
    onCloseEvents.push(`${signal}:onClose`)
  })

  const handlers = installShutdownHandlers(app, {
    process: signalProcess,
    setTimeout: timerHarness.setTimeout,
    clearTimeout: timerHarness.clearTimeout,
  })

  signalProcess.emit(signal)

  const pendingShutdown = handlers.getShutdownPromise()
  expect(pendingShutdown).not.toBeNull()
  await pendingShutdown
  handlers.dispose()

  expect(closeSpy).toHaveBeenCalledTimes(1)
  expect(onCloseEvents).toEqual([`${signal}:onClose`])
  expect(timerHarness.timers).toHaveLength(1)
  expect(timerHarness.timers[0].ms).toBe(API_SHUTDOWN_FORCE_EXIT_MS)
  expect(timerHarness.timers[0].unref).toHaveBeenCalledTimes(1)
  expect(timerHarness.clearTimeout).toHaveBeenCalledWith(timerHarness.timers[0])
  expect(timerHarness.timers[0].cleared).toBe(true)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Fastify API entrypoint lifecycle', () => {
  it.each(['SIGTERM', 'SIGINT'] as const)('%s reaches Fastify app.close and onClose', async (signal) => {
    await expectSignalClosesApp(signal)
  })

  it('duplicate shutdown signals reuse one app.close call', async () => {
    const app = Fastify({ logger: false })
    const signalProcess = new FakeSignalProcess()
    const timerHarness = createTimerHarness()
    const closeSpy = vi.spyOn(app, 'close')
    const onCloseEvents: string[] = []
    let releaseClose!: () => void
    const closeStarted = new Promise<void>((resolveStarted) => {
      app.addHook('onClose', async () => {
        onCloseEvents.push('onClose')
        resolveStarted()
        await new Promise<void>((resolveClose) => {
          releaseClose = resolveClose
        })
      })
    })

    const handlers = installShutdownHandlers(app, {
      process: signalProcess,
      setTimeout: timerHarness.setTimeout,
      clearTimeout: timerHarness.clearTimeout,
    })

    signalProcess.emit('SIGTERM')
    await closeStarted
    signalProcess.emit('SIGINT')

    expect(closeSpy).toHaveBeenCalledTimes(1)
    expect(onCloseEvents).toEqual(['onClose'])

    releaseClose()
    const pendingShutdown = handlers.getShutdownPromise()
    expect(pendingShutdown).not.toBeNull()
    await pendingShutdown
    handlers.dispose()

    expect(closeSpy).toHaveBeenCalledTimes(1)
    expect(timerHarness.timers).toHaveLength(1)
    expect(timerHarness.clearTimeout).toHaveBeenCalledWith(timerHarness.timers[0])
  })

  it('hung shutdown backstop is unrefd and exits with signal-style code', () => {
    const timerHarness = createTimerHarness()
    const exit = vi.fn()
    const app = {
      close: vi.fn(() => new Promise<void>(() => {})),
      log: createLog(),
    } as ShutdownTestApp
    const shutdown = createAppShutdown(app, {
      exitOnShutdown: true,
      setTimeout: timerHarness.setTimeout,
      clearTimeout: timerHarness.clearTimeout,
      exit,
    })

    void shutdown('SIGTERM')

    expect(app.close).toHaveBeenCalledTimes(1)
    expect(timerHarness.timers).toHaveLength(1)
    expect(timerHarness.timers[0].ms).toBe(API_SHUTDOWN_FORCE_EXIT_MS)
    expect(API_SHUTDOWN_FORCE_EXIT_MS).toBeLessThan(5_000)
    expect(timerHarness.timers[0].unref).toHaveBeenCalledTimes(1)

    timerHarness.timers[0].callback()

    expect(exit).toHaveBeenCalledWith(signalExitCode('SIGTERM'))
    expect(timerHarness.clearTimeout).not.toHaveBeenCalled()
  })
})
