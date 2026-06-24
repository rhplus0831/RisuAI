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
import type { selectSingleFile } from 'src/ts/util'

function script(id: string): customscript {
  return {
    id,
    comment: id,
    in: id,
    out: id,
    type: 'editinput',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('importRegexRows', () => {
  it('I-10: returns null without alerting when selectSingleFile is canceled', async () => {
    const selectFile = vi.fn<typeof selectSingleFile>()
    selectFile.mockResolvedValue(null)

    await expect(importRegexRows(selectFile)).resolves.toBeNull()

    expect(selectFile).toHaveBeenCalledWith(['json'])
    expect(importRegexMocks.alertError).not.toHaveBeenCalled()
  })

  it('I-10: compatibility importRegex returns the original rows without throwing on cancel', async () => {
    const original = [script('existing')]
    const selectFile = vi.fn<typeof selectSingleFile>()
    selectFile.mockResolvedValue(null)

    await expect(importRegex(original, selectFile)).resolves.toBe(original)

    expect(original).toEqual([script('existing')])
    expect(importRegexMocks.alertError).not.toHaveBeenCalled()
  })
})
