import { beforeEach, describe, expect, it, vi } from 'vitest'

const alertTestState = vi.hoisted(() => ({
  alertStoreSet: vi.fn(),
  getDatabase: vi.fn(() => ({ usePlainFetch: false })),
}))

vi.mock('./stores.svelte', () => ({
  CurrentTriggerIdStore: {
    subscribe: vi.fn(),
  },
  DBState: {
    db: {
      characters: [],
    },
  },
  alertStore: {
    set: alertTestState.alertStoreSet,
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

import { alertError, alertProgress, alertTOS } from './alert'

beforeEach(() => {
  vi.unstubAllEnvs()
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

describe('alertTOS', () => {
  it('returns accepted without opening the modal in the agent dev browser environment', async () => {
    vi.stubEnv('VITE_RISU_AGENT_DEV_IGNORE_TOS', 'TRUE')

    await expect(alertTOS()).resolves.toBe(true)

    expect(alertTestState.alertStoreSet).not.toHaveBeenCalled()
    expect(localStorage.getItem('tos4')).toBeNull()
  })
})
