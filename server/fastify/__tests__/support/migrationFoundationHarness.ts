import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

export type CompatibilityFixtureFamily =
  | 'model-configuration'
  | 'prompt-template'
  | 'translator'
  | 'repair'
  | 'interchange'

export type CompatibilityFixtureLane = 'server-vitest' | 'frontend-vitest' | 'compatibility-data'

export interface CompatibilityMigrationFixtureAdapter {
  surfaceId: string
  family: CompatibilityFixtureFamily
  fixturePath: string
  lane: CompatibilityFixtureLane
  command: string
}

interface CompatibilityBaseline {
  surfaces: Array<{
    id: string
    family: CompatibilityFixtureFamily
    historicalFixture: string
  }>
}

function fixtureLane(fixturePath: string): CompatibilityFixtureLane {
  if (fixturePath.startsWith('server/fastify/')) return 'server-vitest'
  if (fixturePath.endsWith('.test.ts')) return 'frontend-vitest'
  return 'compatibility-data'
}

function fixtureCommand(fixturePath: string, lane: CompatibilityFixtureLane): string {
  if (lane === 'server-vitest') {
    return `pnpm exec vitest run --config server/fastify/vitest.config.ts ${fixturePath}`
  }
  if (lane === 'frontend-vitest') return `pnpm exec vitest run ${fixturePath}`
  return 'pnpm exec tsx test/compat-harness/run.ts --current-only'
}

export function loadCompatibilityMigrationFixtureAdapters(
  repositoryRoot: string,
): CompatibilityMigrationFixtureAdapter[] {
  const baselinePath = path.join(
    repositoryRoot,
    'docs/plan/canonical-state-and-compatibility/compatibility-baseline.json',
  )
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as CompatibilityBaseline
  return baseline.surfaces.map(({ id, family, historicalFixture }) => {
    const lane = fixtureLane(historicalFixture)
    return {
      surfaceId: id,
      family,
      fixturePath: historicalFixture,
      lane,
      command: fixtureCommand(historicalFixture, lane),
    }
  })
}

/**
 * Installs a durable test-only failure exactly between a migration step's writes
 * and its schema-version update. Production configuration has no injection seam.
 */
export function installMigrationVersionCommitFailure(db: DatabaseSync, version: number): void {
  if (!Number.isInteger(version) || version <= 0) throw new Error(`Invalid injected migration version: ${version}`)
  db.exec(`
    CREATE TRIGGER fail_migration_version_commit
    BEFORE UPDATE OF version ON schema_version
    WHEN NEW.version = ${version}
    BEGIN
      SELECT RAISE(FAIL, 'injected migration version commit failure');
    END;
  `)
}

export function removeMigrationVersionCommitFailure(db: DatabaseSync): void {
  db.exec('DROP TRIGGER fail_migration_version_commit')
}
