import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

export interface QualityLane {
  id: string
  label: string
  args: string[]
  env?: Record<string, string>
  after?: string[]
  isolated?: boolean
  priority?: number
}

export interface QualityLaneResult {
  id: string
  exitCode: number
  elapsedMs: number
}

interface CliOptions {
  dryRun: boolean
  jobs: number
}

type LaneRunner = (lane: QualityLane) => Promise<QualityLaneResult>

const defaultJobs = 2

export const qualityLanes: readonly QualityLane[] = [
  {
    id: 'frontend-routing',
    label: 'frontend test routing',
    args: ['check:frontend-test-inventory'],
    priority: 0,
  },
  {
    id: 'server-check',
    label: 'server and browser-smoke typecheck',
    args: ['check:server'],
    priority: 0,
  },
  {
    id: 'frontend-tests',
    label: 'frontend tests',
    args: ['test:frontend:run'],
    // The coverage lane below executes these six files with its thresholds.
    env: { RISU_TEST_EXCLUDE_UI_MAP: 'true' },
    priority: 1,
  },
  {
    id: 'server-tests',
    label: 'server tests',
    args: ['test:server'],
    isolated: true,
  },
  {
    id: 'browser-smoke',
    label: 'browser smoke tests',
    args: ['test:smoke'],
    // check:server emits declarations under dist/, which the smoke build replaces.
    after: ['server-check'],
    isolated: true,
  },
  {
    id: 'frontend-check',
    label: 'frontend check',
    args: ['check'],
    priority: 2,
  },
  {
    id: 'ui-coverage',
    label: 'UI coverage gate',
    args: ['coverage:ui-map'],
    // Keep coverage collection after the other frontend transforms have settled.
    after: ['frontend-tests'],
    priority: 3,
  },
  {
    id: 'format',
    label: 'format check',
    args: ['format:check'],
    priority: 4,
  },
  {
    id: 'performance-gates',
    label: 'frontend performance gates',
    args: ['test:gates:perf', '--no-file-parallelism', '--maxWorkers=1'],
    isolated: true,
  },
]

function parsePositiveInteger(raw: string, option: string): number {
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${option} must be a positive integer, received ${JSON.stringify(raw)}`)
  }
  return value
}

export function parseTestAllJobs(raw: string | undefined): number {
  return raw ? parsePositiveInteger(raw, 'RISU_TEST_ALL_JOBS') : defaultJobs
}

function parseCli(args: string[]): CliOptions {
  let dryRun = false
  let jobs = parseTestAllJobs(process.env.RISU_TEST_ALL_JOBS?.trim())

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--dry-run') {
      dryRun = true
    } else if (arg === '--jobs') {
      const value = args[index + 1]
      if (!value) throw new Error('--jobs requires a positive integer')
      jobs = parsePositiveInteger(value, '--jobs')
      index += 1
    } else if (arg.startsWith('--jobs=')) {
      jobs = parsePositiveInteger(arg.slice('--jobs='.length), '--jobs')
    } else if (arg === '--') {
      continue
    } else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: pnpm test:all [--jobs <count>] [--dry-run]

Runs independent quality lanes with bounded concurrency, then runs dist- or load-sensitive
lanes in isolation. RISU_TEST_ALL_JOBS sets the default concurrency (${defaultJobs}).`)
      process.exit(0)
    } else {
      throw new Error(`unknown option: ${arg}`)
    }
  }

  return { dryRun, jobs }
}

function lanePriority(lane: QualityLane): number {
  return lane.priority ?? Number.MAX_SAFE_INTEGER
}

function validateLaneGraph(lanes: readonly QualityLane[]): void {
  const ids = new Set<string>()
  for (const lane of lanes) {
    if (ids.has(lane.id)) throw new Error(`duplicate quality lane id: ${lane.id}`)
    ids.add(lane.id)
  }
  for (const lane of lanes) {
    for (const dependency of lane.after ?? []) {
      if (!ids.has(dependency)) throw new Error(`quality lane ${lane.id} depends on unknown lane ${dependency}`)
      if (dependency === lane.id) throw new Error(`quality lane ${lane.id} cannot depend on itself`)
    }
  }
}

export async function runLanePool(
  lanes: readonly QualityLane[],
  jobs: number,
  runLane: LaneRunner,
): Promise<QualityLaneResult[]> {
  if (!Number.isInteger(jobs) || jobs < 1) throw new Error('jobs must be a positive integer')
  validateLaneGraph(lanes)
  const pending = new Map(lanes.map((lane) => [lane.id, lane]))
  const running = new Map<string, Promise<void>>()
  const completed = new Set<string>()
  const results = new Map<string, QualityLaneResult>()

  const startReadyLanes = (): void => {
    const ready = [...pending.values()]
      .filter((lane) => (lane.after ?? []).every((dependency) => completed.has(dependency)))
      .sort((left, right) => lanePriority(left) - lanePriority(right))

    for (const lane of ready) {
      if (running.size >= jobs) break
      pending.delete(lane.id)
      const promise = runLane(lane).then((result) => {
        results.set(lane.id, result)
        completed.add(lane.id)
        running.delete(lane.id)
      })
      running.set(lane.id, promise)
    }
  }

  while (pending.size > 0 || running.size > 0) {
    startReadyLanes()
    if (running.size === 0) {
      throw new Error(`quality lane dependency cycle: ${[...pending.keys()].join(', ')}`)
    }
    await Promise.race(running.values())
  }

  return lanes.map((lane) => results.get(lane.id) as QualityLaneResult)
}

function formatDuration(elapsedMs: number): string {
  const totalSeconds = Math.round(elapsedMs / 100) / 10
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = (totalSeconds - minutes * 60).toFixed(1)
  return `${minutes}m ${seconds}s`
}

function displayCommand(lane: QualityLane): string {
  const env = lane.env
    ? `${Object.entries(lane.env)
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
        .join(' ')} `
    : ''
  return `${env}pnpm ${lane.args.join(' ')}`
}

function printPlan(jobs: number): void {
  console.log(`[test:all] up to ${jobs} regular lanes will run concurrently`)
  for (const lane of qualityLanes) {
    const details = [
      lane.isolated ? 'isolated' : undefined,
      lane.after?.length ? `after ${lane.after.join(', ')}` : undefined,
    ].filter(Boolean)
    console.log(`  ${lane.label}${details.length ? ` (${details.join('; ')})` : ''}: ${displayCommand(lane)}`)
  }
}

async function run(): Promise<void> {
  const options = parseCli(process.argv.slice(2))
  printPlan(options.jobs)
  if (options.dryRun) return

  const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  const children = new Set<ChildProcess>()
  let interruptedSignal: NodeJS.Signals | undefined

  const interrupt = (signal: NodeJS.Signals): void => {
    interruptedSignal = signal
    for (const child of children) child.kill(signal)
  }
  process.once('SIGINT', () => interrupt('SIGINT'))
  process.once('SIGTERM', () => interrupt('SIGTERM'))

  const runLane: LaneRunner = async (lane) => {
    if (interruptedSignal) return { id: lane.id, exitCode: 1, elapsedMs: 0 }
    const startedAt = performance.now()
    console.log(`\n[test:all] starting ${lane.label}: ${displayCommand(lane)}`)

    const exitCode = await new Promise<number>((resolve) => {
      const spawnOptions: SpawnOptions = {
        cwd: process.cwd(),
        env: { ...process.env, ...lane.env },
        stdio: 'inherit',
      }
      const child = spawn(pnpmCommand, lane.args, spawnOptions)
      children.add(child)
      child.once('error', (error) => {
        children.delete(child)
        console.error(`[test:all] could not start ${lane.label}: ${error.message}`)
        resolve(1)
      })
      child.once('exit', (code) => {
        children.delete(child)
        resolve(code ?? 1)
      })
    })

    const elapsedMs = performance.now() - startedAt
    const status = exitCode === 0 ? 'passed' : `failed (exit ${exitCode})`
    console.log(`\n[test:all] ${lane.label} ${status} in ${formatDuration(elapsedMs)}`)
    return { id: lane.id, exitCode, elapsedMs }
  }

  const startedAt = performance.now()
  const regularLanes = qualityLanes.filter((lane) => !lane.isolated)
  const isolatedLanes = qualityLanes.filter((lane) => lane.isolated)
  const results = await runLanePool(regularLanes, options.jobs, runLane)
  for (const lane of isolatedLanes) {
    results.push(await runLane(lane))
  }

  if (interruptedSignal) {
    console.error(`[test:all] interrupted by ${interruptedSignal}`)
    process.exitCode = interruptedSignal === 'SIGINT' ? 130 : 143
    return
  }

  console.log(`\n[test:all] completed in ${formatDuration(performance.now() - startedAt)}`)
  for (const lane of qualityLanes) {
    const result = results.find((candidate) => candidate.id === lane.id)
    const status = result?.exitCode === 0 ? 'PASS' : 'FAIL'
    console.log(`  ${status}  ${lane.label} (${formatDuration(result?.elapsedMs ?? 0)})`)
  }
  if (results.some((result) => result.exitCode !== 0)) process.exitCode = 1
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath && existsSync(invokedPath)) {
  run().catch((error) => {
    console.error(`[test:all] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}
