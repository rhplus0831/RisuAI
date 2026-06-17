import { beforeEach, describe, expect, it, vi } from 'vitest'

const colorSchemeMocks = vi.hoisted(() => ({
  alertError: vi.fn(),
  applyServerBackedSettingsPatch: vi.fn(),
  DBState: {
    db: {} as any,
  },
  downloadFile: vi.fn(),
  selectSingleFile: vi.fn(),
  setDatabase: vi.fn(),
  stores: {
    customCSS: createTestStore(''),
    safeMode: createTestStore(false),
  },
}))

function createTestStore<T>(initialValue: T) {
  let value = initialValue
  return {
    set(nextValue: T) {
      value = nextValue
    },
    subscribe(run: (value: T) => void) {
      run(value)
      return () => {}
    },
  }
}

vi.mock('../alert', () => ({
  alertError: colorSchemeMocks.alertError,
}))

vi.mock('../server/settingsBridge.svelte', () => ({
  applyServerBackedSettingsPatch: colorSchemeMocks.applyServerBackedSettingsPatch,
}))

vi.mock('../globalApi.svelte', () => ({
  downloadFile: colorSchemeMocks.downloadFile,
}))

vi.mock('../storage/database.svelte', () => ({
  getDatabase: () => colorSchemeMocks.DBState.db,
  setDatabase: colorSchemeMocks.setDatabase,
}))

vi.mock('../stores.svelte', () => ({
  CustomCSSStore: colorSchemeMocks.stores.customCSS,
  DBState: colorSchemeMocks.DBState,
  SafeModeStore: colorSchemeMocks.stores.safeMode,
}))

vi.mock('../util', () => ({
  BufferToText: (data: Uint8Array) => new TextDecoder().decode(data),
  selectSingleFile: colorSchemeMocks.selectSingleFile,
}))

import { DBState } from '../stores.svelte'
import { importColorScheme, type ColorScheme } from './colorscheme'

type SelectedFile = {
  name: string
  data: Uint8Array
}

type SelectSingleFileOptions = {
  onFileSelected?: (file: File) => void
}

function scheme(seed: string): ColorScheme {
  return {
    bgcolor: `#${seed}001`,
    darkbg: `#${seed}002`,
    borderc: `#${seed}003`,
    selected: `#${seed}004`,
    draculared: `#${seed}005`,
    textcolor: `#${seed}006`,
    textcolor2: `#${seed}007`,
    darkBorderc: `#${seed}008`,
    darkbutton: `#${seed}009`,
    type: 'dark',
  }
}

function selectedJsonFile(value: unknown): SelectedFile {
  return {
    name: 'colorScheme.json',
    data: new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)),
  }
}

function createPicker() {
  let resolve!: (value: SelectedFile | null) => void
  const promise = new Promise<SelectedFile | null>((promiseResolve) => {
    resolve = promiseResolve
  })
  let options: SelectSingleFileOptions | undefined

  return {
    selectSingleFile: vi.fn((_extensions: string[], selectOptions?: SelectSingleFileOptions) => {
      options = selectOptions
      return promise
    }),
    resolve(value: SelectedFile | null) {
      if (value) {
        options?.onFileSelected?.(new File([value.data], value.name))
      }
      resolve(value)
    },
  }
}

async function flushAsync(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  DBState.db = {
    colorSchemeName: 'default',
    colorScheme: scheme('aaa'),
  } as any
  colorSchemeMocks.alertError.mockReset()
  colorSchemeMocks.applyServerBackedSettingsPatch.mockReset()
  colorSchemeMocks.selectSingleFile.mockReset()
  colorSchemeMocks.applyServerBackedSettingsPatch.mockImplementation((patch: Record<string, unknown>) => {
    Object.assign(DBState.db, patch)
  })
})

describe('importColorScheme freshness', () => {
  it('does not apply a valid file after the scheme changed while selection was pending', async () => {
    const picker = createPicker()
    colorSchemeMocks.selectSingleFile.mockImplementation(picker.selectSingleFile)

    const importPromise = importColorScheme()
    await vi.waitFor(() => {
      expect(colorSchemeMocks.selectSingleFile).toHaveBeenCalledWith(['json'], expect.any(Object))
    })

    DBState.db.colorSchemeName = 'light'
    DBState.db.colorScheme = scheme('bbb')

    picker.resolve(selectedJsonFile(scheme('ccc')))
    await importPromise

    expect(colorSchemeMocks.applyServerBackedSettingsPatch).not.toHaveBeenCalled()
    expect(colorSchemeMocks.alertError).not.toHaveBeenCalled()
    expect(DBState.db.colorSchemeName).toBe('light')
    expect(DBState.db.colorScheme).toEqual(scheme('bbb'))
  })

  it('does not alert for an invalid stale file after the scheme changed while selection was pending', async () => {
    const picker = createPicker()
    colorSchemeMocks.selectSingleFile.mockImplementation(picker.selectSingleFile)

    const importPromise = importColorScheme()
    await vi.waitFor(() => {
      expect(colorSchemeMocks.selectSingleFile).toHaveBeenCalledWith(['json'], expect.any(Object))
    })

    DBState.db.colorSchemeName = 'custom'
    DBState.db.colorScheme = scheme('bbb')

    picker.resolve(selectedJsonFile('{'))
    await importPromise

    expect(colorSchemeMocks.applyServerBackedSettingsPatch).not.toHaveBeenCalled()
    expect(colorSchemeMocks.alertError).not.toHaveBeenCalled()
  })

  it('lets a newer selected import win over an older delayed import', async () => {
    const olderPicker = createPicker()
    const newerPicker = createPicker()
    colorSchemeMocks.selectSingleFile
      .mockImplementationOnce(olderPicker.selectSingleFile)
      .mockImplementationOnce(newerPicker.selectSingleFile)

    const olderImport = importColorScheme()
    const newerImport = importColorScheme()
    await vi.waitFor(() => {
      expect(colorSchemeMocks.selectSingleFile).toHaveBeenCalledTimes(2)
    })

    newerPicker.resolve(selectedJsonFile(scheme('bbb')))
    await flushAsync()
    olderPicker.resolve(selectedJsonFile(scheme('ccc')))

    await Promise.all([olderImport, newerImport])

    expect(colorSchemeMocks.applyServerBackedSettingsPatch.mock.calls).toEqual([
      [
        {
          colorSchemeName: 'custom',
          colorScheme: scheme('bbb'),
        },
      ],
    ])
    expect(DBState.db.colorScheme).toEqual(scheme('bbb'))
    expect(colorSchemeMocks.alertError).not.toHaveBeenCalled()
  })
})
