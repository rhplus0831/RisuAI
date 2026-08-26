import { beforeEach, describe, expect, it, vi } from 'vitest'

const importRegexMocks = vi.hoisted(() => ({
  alertError: vi.fn(),
  alertNormal: vi.fn(),
  downloadFile: vi.fn(),
}))

vi.mock('../alert', () => ({
  alertError: importRegexMocks.alertError,
  alertNormal: importRegexMocks.alertNormal,
}))

vi.mock('../globalApi.svelte', async (importActual) => {
  const actual = await importActual<typeof import('../globalApi.svelte')>()
  return {
    ...actual,
    downloadFile: importRegexMocks.downloadFile,
  }
})

import '../stores.svelte'
import { importRegex, importRegexRows } from './scripts'
import type { customscript } from '../storage/database.svelte'
import type { selectSingleFile } from 'src/ts/filePicker'

function script(id: string): customscript {
  return {
    id,
    comment: id,
    in: id,
    out: id,
    type: 'editinput',
  }
}

function regexImportFile(data: unknown): { name: string; data: Uint8Array } {
  return {
    name: 'regexscript_export.json',
    data: Buffer.from(JSON.stringify({ type: 'regex', data })),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('importRegexRows', () => {
  it('returns null without alerting when selectSingleFile is canceled', async () => {
    const selectFile = vi.fn<typeof selectSingleFile>()
    selectFile.mockResolvedValue(null)

    await expect(importRegexRows(selectFile)).resolves.toBeNull()

    expect(selectFile).toHaveBeenCalledWith(['json'])
    expect(importRegexMocks.alertError).not.toHaveBeenCalled()
  })

  it('compatibility importRegex returns the original rows without throwing on cancel', async () => {
    const original = [script('existing')]
    const selectFile = vi.fn<typeof selectSingleFile>()
    selectFile.mockResolvedValue(null)

    await expect(importRegex(original, selectFile)).resolves.toBe(original)

    expect(original).toEqual([script('existing')])
    expect(importRegexMocks.alertError).not.toHaveBeenCalled()
  })

  it('rejects malformed regex members without returning a partial import', async () => {
    const selectFile = vi.fn<typeof selectSingleFile>()
    selectFile.mockResolvedValue(
      regexImportFile([
        script('valid'),
        { id: 'invalid', comment: 'Invalid', in: 'x', out: { nested: 'not text' }, type: 'editinput' },
      ]),
    )

    await expect(importRegexRows(selectFile)).resolves.toBeNull()

    expect(importRegexMocks.alertError).toHaveBeenCalledOnce()
  })

  it('keeps the existing collection unchanged when a mixed import contains an invalid member', async () => {
    const original = [script('existing')]
    const selectFile = vi.fn<typeof selectSingleFile>()
    selectFile.mockResolvedValue(regexImportFile([script('valid'), null]))

    await expect(importRegex(original, selectFile)).resolves.toBe(original)

    expect(original).toEqual([script('existing')])
    expect(importRegexMocks.alertError).toHaveBeenCalledOnce()
  })

  it('normalizes legitimate id-less legacy rows and preserves compatible extension data', async () => {
    const selectFile = vi.fn<typeof selectSingleFile>()
    selectFile.mockResolvedValue(
      regexImportFile([
        {
          in: 'legacy pattern',
          out: 'legacy replacement',
          flag: 'gi',
          ableFlag: true,
          legacyExtension: { retained: true },
        },
      ]),
    )

    await expect(importRegexRows(selectFile)).resolves.toEqual([
      {
        comment: '',
        in: 'legacy pattern',
        out: 'legacy replacement',
        type: 'editinput',
        flag: 'gi',
        ableFlag: true,
        legacyExtension: { retained: true },
      },
    ])
    expect(importRegexMocks.alertError).not.toHaveBeenCalled()
  })
})
