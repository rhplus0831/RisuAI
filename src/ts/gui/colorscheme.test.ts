import { beforeEach, describe, expect, it, vi } from 'vitest'

const colorSchemeMocks = vi.hoisted(() => ({
  alertError: vi.fn(),
  applyServerBackedSettingsPatch: vi.fn(),
  database: {} as any,
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
  getDatabase: () => colorSchemeMocks.database,
  setDatabase: colorSchemeMocks.setDatabase,
}))

vi.mock('../stores.svelte', () => ({
  CustomCSSStore: colorSchemeMocks.stores.customCSS,
  SafeModeStore: colorSchemeMocks.stores.safeMode,
}))

vi.mock('../util', () => ({
  BufferToText: (data: Uint8Array) => new TextDecoder().decode(data),
  selectSingleFile: colorSchemeMocks.selectSingleFile,
}))

import {
  builtInColorSchemes,
  importColorScheme,
  migrateLegacyBuiltInColorScheme,
  updateColorScheme,
  type ColorScheme,
} from './colorscheme'
import { language } from 'src/lang'

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
        const data = value.data.buffer.slice(value.data.byteOffset, value.data.byteOffset + value.data.byteLength)
        options?.onFileSelected?.(new File([data as ArrayBuffer], value.name))
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
  colorSchemeMocks.database = {
    colorSchemeName: 'default',
    colorScheme: scheme('aaa'),
  } as any
  colorSchemeMocks.alertError.mockReset()
  colorSchemeMocks.applyServerBackedSettingsPatch.mockReset()
  colorSchemeMocks.selectSingleFile.mockReset()
  colorSchemeMocks.applyServerBackedSettingsPatch.mockImplementation((patch: Record<string, unknown>) => {
    Object.assign(colorSchemeMocks.database, patch)
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

    colorSchemeMocks.database.colorSchemeName = 'light'
    colorSchemeMocks.database.colorScheme = scheme('bbb')

    picker.resolve(selectedJsonFile(scheme('ccc')))
    await importPromise

    expect(colorSchemeMocks.applyServerBackedSettingsPatch).not.toHaveBeenCalled()
    expect(colorSchemeMocks.alertError).toHaveBeenCalledWith(language.fileSelectionStale)
    expect(colorSchemeMocks.database.colorSchemeName).toBe('light')
    expect(colorSchemeMocks.database.colorScheme).toEqual(scheme('bbb'))
  })

  it('reports an invalid stale file after the scheme changed while selection was pending', async () => {
    const picker = createPicker()
    colorSchemeMocks.selectSingleFile.mockImplementation(picker.selectSingleFile)

    const importPromise = importColorScheme()
    await vi.waitFor(() => {
      expect(colorSchemeMocks.selectSingleFile).toHaveBeenCalledWith(['json'], expect.any(Object))
    })

    colorSchemeMocks.database.colorSchemeName = 'custom'
    colorSchemeMocks.database.colorScheme = scheme('bbb')

    picker.resolve(selectedJsonFile('{'))
    await importPromise

    expect(colorSchemeMocks.applyServerBackedSettingsPatch).not.toHaveBeenCalled()
    expect(colorSchemeMocks.alertError).toHaveBeenCalledWith('Invalid color scheme')
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
    expect(colorSchemeMocks.database.colorScheme).toEqual(scheme('bbb'))
    expect(colorSchemeMocks.alertError).toHaveBeenCalledWith(language.fileSelectionStale)
  })
})

function relativeLuminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)!
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}

function contrastRatio(first: string, second: string): number {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second))
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second))
  return (lighter + 0.05) / (darker + 0.05)
}

describe('built-in color scheme contrast', () => {
  it.each(Object.entries(builtInColorSchemes))(
    '%s keeps primary and secondary text readable on its main surfaces',
    (_name, colorScheme) => {
      for (const background of [colorScheme.bgcolor, colorScheme.darkbg]) {
        expect(contrastRatio(colorScheme.textcolor, background)).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(colorScheme.textcolor2, background)).toBeGreaterThanOrEqual(4.5)
      }
    },
  )
})

describe('legacy built-in color scheme migration', () => {
  it.each([
    ['default', '#64748b'],
    ['nature', '#4d908e'],
  ] as const)('upgrades a persisted %s palette to the readable secondary text color', (name, legacyTextColor) => {
    const legacy = { ...builtInColorSchemes[name], textcolor2: legacyTextColor } as ColorScheme

    expect(migrateLegacyBuiltInColorScheme(name, legacy)).toEqual(builtInColorSchemes[name])
  })

  it('does not overwrite a custom or modified palette', () => {
    const custom = { ...builtInColorSchemes.default, textcolor2: '#64748b', bgcolor: '#123456' } as ColorScheme

    expect(migrateLegacyBuiltInColorScheme('custom', custom)).toBe(custom)
    expect(migrateLegacyBuiltInColorScheme('default', custom)).toBe(custom)
  })

  it('persists the migration when applying an existing built-in theme', () => {
    colorSchemeMocks.database = {
      colorSchemeName: 'nature',
      colorScheme: { ...builtInColorSchemes.nature, textcolor2: '#4d908e' },
    }

    updateColorScheme()

    expect(colorSchemeMocks.applyServerBackedSettingsPatch).toHaveBeenCalledWith({
      colorScheme: builtInColorSchemes.nature,
    })
    expect(document.documentElement.style.getPropertyValue('--risu-theme-textcolor2')).toBe(
      builtInColorSchemes.nature.textcolor2,
    )
  })
})
