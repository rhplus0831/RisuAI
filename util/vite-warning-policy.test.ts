import path from 'node:path'
import type { Rolldown } from 'vite'
import { describe, expect, it, vi } from 'vitest'
import { createViteBuildWarningPolicy, type IneffectiveDynamicImportException } from './vite-warning-policy'

const rootDir = path.resolve('/workspace/project')

function ineffectiveDynamicImportLog(overrides: Partial<Rolldown.RolldownLog> = {}): Rolldown.RolldownLog {
  return {
    code: 'INEFFECTIVE_DYNAMIC_IMPORT',
    id: path.join(rootDir, 'src/ts/lazy.ts'),
    ids: [path.join(rootDir, 'src/main.ts')],
    message: 'A dynamic import cannot create a separate chunk',
    ...overrides,
  }
}

describe('createViteBuildWarningPolicy', () => {
  it('fails an unexplained static-plus-dynamic import warning with normalized evidence', () => {
    const defaultHandler = vi.fn()
    const policy = createViteBuildWarningPolicy(rootDir)

    expect(() => policy('warn', ineffectiveDynamicImportLog(), defaultHandler)).toThrowError(
      [
        'Unexplained INEFFECTIVE_DYNAMIC_IMPORT warning for src/ts/lazy.ts.',
        'Static importers:',
        '  - src/main.ts',
      ].join('\n'),
    )
    expect(defaultHandler).not.toHaveBeenCalled()
  })

  it('forwards unrelated build logs unchanged', () => {
    const defaultHandler = vi.fn()
    const policy = createViteBuildWarningPolicy(rootDir)
    const log: Rolldown.RolldownLog = {
      code: 'CIRCULAR_DEPENDENCY',
      message: 'A cycle exists',
    }

    policy('warn', log, defaultHandler)

    expect(defaultHandler).toHaveBeenCalledOnce()
    expect(defaultHandler).toHaveBeenCalledWith('warn', log)
  })

  it('allows only an exact documented exception and still prints its warning', () => {
    const exceptions: readonly IneffectiveDynamicImportException[] = [
      {
        importedModule: 'src/ts/lazy.ts',
        importers: ['src/main.ts'],
        reason: 'The host intentionally shares one singleton with the deferred path.',
      },
    ]
    const defaultHandler = vi.fn()
    const policy = createViteBuildWarningPolicy(rootDir, exceptions)
    const log = ineffectiveDynamicImportLog({
      ids: [path.join(rootDir, 'src/main.ts'), path.join(rootDir, 'src/main.ts')],
    })

    policy('warn', log, defaultHandler)

    expect(defaultHandler).toHaveBeenCalledWith('warn', log)
  })

  it('does not let an exception hide a new static importer', () => {
    const exceptions: readonly IneffectiveDynamicImportException[] = [
      {
        importedModule: 'src/ts/lazy.ts',
        importers: ['src/main.ts'],
        reason: 'The original owner is intentional.',
      },
    ]
    const policy = createViteBuildWarningPolicy(rootDir, exceptions)

    expect(() =>
      policy(
        'warn',
        ineffectiveDynamicImportLog({
          ids: [path.join(rootDir, 'src/main.ts'), path.join(rootDir, 'src/ts/second-owner.ts')],
        }),
        vi.fn(),
      ),
    ).toThrowError('src/ts/second-owner.ts')
  })

  it('rejects undocumented exceptions when the policy is created', () => {
    expect(() =>
      createViteBuildWarningPolicy(rootDir, [
        {
          importedModule: 'src/ts/lazy.ts',
          importers: ['src/main.ts'],
          reason: '   ',
        },
      ]),
    ).toThrowError('must include a reason')
  })
})
