import { beforeEach, describe, expect, it, vi } from 'vitest'

const alertTestState = vi.hoisted(() => ({
  alertStoreValue: { type: 'none', msg: '' } as Record<string, unknown>,
  alertStoreSet: vi.fn(),
  getDatabase: vi.fn(() => ({ usePlainFetch: false })),
}))

vi.mock('./stores.svelte', () => ({
  CurrentTriggerIdStore: {
    subscribe: vi.fn(),
  },
  alertStore: {
    set: (value: Record<string, unknown>) => {
      alertTestState.alertStoreValue = value
      alertTestState.alertStoreSet(value)
    },
    subscribe: (run: (value: Record<string, unknown>) => void) => {
      run(alertTestState.alertStoreValue)
      return () => undefined
    },
  },
  selIdState: {
    selId: -1,
  },
  selectedCharID: {
    subscribe: vi.fn(),
  },
}))

vi.mock('./storage/database.svelte', () => ({
  appVer: 'test',
  getCurrentCharacter: vi.fn(() => undefined),
  getDatabase: alertTestState.getDatabase,
}))

vi.mock('../lang', () => ({
  language: {
    errors: {
      networkFetch: 'Network fetch help',
      networkFetchPlain: 'Plain fetch help',
    },
  },
}))

vi.mock('src/lang', () => ({
  language: {
    errors: {
      networkFetch: 'Network fetch help',
      networkFetchPlain: 'Plain fetch help',
    },
  },
}))

import {
  alertError,
  alertNormal,
  alertProgress,
  alertTOS,
  beginAlertWait,
  cardExportCancelMessage,
  clearAlertWait,
  parseCardExportResult,
  updateAlertWait,
} from './alert'

beforeEach(() => {
  vi.unstubAllEnvs()
  alertTestState.alertStoreValue = { type: 'none', msg: '' }
  alertTestState.alertStoreSet.mockClear()
  alertTestState.getDatabase.mockClear()
  alertTestState.getDatabase.mockReturnValue({ usePlainFetch: false })
  localStorage.clear()
})

describe('alertError', () => {
  it('L37/I21: accepts non-string payloads with String coercion after Error handling', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      expect(() => alertError(undefined)).not.toThrow()
      expect(alertTestState.alertStoreSet).toHaveBeenLastCalledWith(expect.objectContaining({ msg: 'undefined' }))

      expect(() => alertError(null)).not.toThrow()
      expect(alertTestState.alertStoreSet).toHaveBeenLastCalledWith(expect.objectContaining({ msg: 'null' }))

      expect(() => alertError({ code: 'plain-object' })).not.toThrow()
      expect(alertTestState.alertStoreSet).toHaveBeenLastCalledWith(expect.objectContaining({ msg: '[object Object]' }))

      expect(() => alertError(Symbol('reason'))).not.toThrow()
      expect(alertTestState.alertStoreSet).toHaveBeenLastCalledWith(expect.objectContaining({ msg: 'Symbol(reason)' }))
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })

  it('keeps Error messages and stack traces intact', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const error = new Error('kept error')

      expect(() => alertError(error)).not.toThrow()

      expect(alertTestState.alertStoreSet).toHaveBeenCalledWith(
        expect.objectContaining({
          msg: 'kept error',
          stackTrace: error.stack,
        }),
      )
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })
})

describe('card export results', () => {
  it('preserves valid selections', () => {
    expect(parseCardExportResult('{"type":"ccv2","type2":"png"}')).toEqual({ type: 'ccv2', type2: 'png' })
  })

  it('turns empty and malformed dismissal values into cancellation', () => {
    expect(parseCardExportResult('')).toEqual({ type: 'cancel', type2: '' })
    expect(parseCardExportResult('{"type":"ccv2"}')).toEqual({ type: 'cancel', type2: '' })
    expect(parseCardExportResult(cardExportCancelMessage('charx'))).toEqual({ type: 'cancel', type2: 'charx' })
  })
})

describe('alertProgress', () => {
  it('sets a progress alert with a clamped percentage', () => {
    alertProgress('Loading assets', 125, 'Saving embedded assets')

    expect(alertTestState.alertStoreSet).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'progress',
        msg: 'Loading assets',
        progress: 100,
        submsg: 'Saving embedded assets',
      }),
    )

    alertProgress('Loading assets', -10)
    expect(alertTestState.alertStoreSet).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'progress',
        msg: 'Loading assets',
        progress: 0,
      }),
    )
  })

  it('supports indeterminate progress alerts', () => {
    alertProgress('Working', null)

    expect(alertTestState.alertStoreSet).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'progress',
        msg: 'Working',
        progress: null,
      }),
    )
  })
})

describe('owned wait alerts', () => {
  it('updates and clears the wait opened by its handle', () => {
    const handle = beginAlertWait('Starting')

    expect(updateAlertWait(handle, 'Still working')).toBe(true)
    expect(alertTestState.alertStoreValue).toEqual({
      type: 'wait',
      msg: 'Still working',
      waitOwner: handle,
    })

    expect(clearAlertWait(handle)).toBe(true)
    expect(alertTestState.alertStoreValue).toEqual({ type: 'none', msg: '' })
  })

  it('does not update or clear an alert that replaced its wait', () => {
    const handle = beginAlertWait('Starting')
    alertNormal('Newer result')

    expect(updateAlertWait(handle, 'Stale progress')).toBe(false)
    expect(clearAlertWait(handle)).toBe(false)
    expect(alertTestState.alertStoreValue).toEqual({ type: 'normal', msg: 'Newer result' })
  })
})

describe('alertTOS', () => {
  it('returns accepted without opening the modal in the agent dev browser environment', async () => {
    vi.stubEnv('VITE_RISU_AGENT_DEV_IGNORE_TOS', 'TRUE')

    await expect(alertTOS()).resolves.toBe(true)

    expect(alertTestState.alertStoreSet).not.toHaveBeenCalled()
    expect(localStorage.getItem('tos4')).toBeNull()
  })
})
