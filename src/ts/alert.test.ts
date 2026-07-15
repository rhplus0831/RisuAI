import { beforeEach, describe, expect, it, vi } from 'vitest'

const alertTestState = vi.hoisted(() => ({
  alertStoreValue: { type: 'none', msg: '' } as Record<string, unknown>,
  alertStoreSet: vi.fn(),
  alertStoreSubscribers: new Set<(value: Record<string, unknown>) => void>(),
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
      for (const subscriber of alertTestState.alertStoreSubscribers) subscriber(value)
    },
    subscribe: (run: (value: Record<string, unknown>) => void) => {
      alertTestState.alertStoreSubscribers.add(run)
      run(alertTestState.alertStoreValue)
      return () => alertTestState.alertStoreSubscribers.delete(run)
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
  alertClear,
  alertConfirm,
  alertError,
  alertInput,
  alertNormal,
  alertPluginConfirm,
  alertProgress,
  alertTOS,
  beginAlertWait,
  cardExportCancelMessage,
  clearAlertWait,
  parseCardExportResult,
  resolveAlertConfirmation,
  alertStore,
  updateAlertWait,
} from './alert'

beforeEach(() => {
  vi.unstubAllEnvs()
  alertTestState.alertStoreValue = { type: 'none', msg: '' }
  for (const subscriber of alertTestState.alertStoreSubscribers) subscriber(alertTestState.alertStoreValue)
  alertTestState.alertStoreSet.mockClear()
  alertTestState.getDatabase.mockClear()
  alertTestState.getDatabase.mockReturnValue({ usePlainFetch: false })
  localStorage.clear()
})

describe('confirmation queue', () => {
  it('shows concurrent confirmations in FIFO order and keeps their yes/no results separate', async () => {
    const firstResult = alertConfirm('First confirmation')
    const secondResult = alertConfirm('Second confirmation')

    expect(alertTestState.alertStoreValue).toMatchObject({ type: 'ask', msg: 'First confirmation' })
    const firstOwner = alertTestState.alertStoreValue.dialogOwner as symbol

    expect(resolveAlertConfirmation(firstOwner, true)).toBe(true)
    await expect(firstResult).resolves.toBe(true)

    expect(alertTestState.alertStoreValue).toMatchObject({ type: 'ask', msg: 'Second confirmation' })
    const secondOwner = alertTestState.alertStoreValue.dialogOwner as symbol
    expect(secondOwner).not.toBe(firstOwner)

    expect(resolveAlertConfirmation(secondOwner, false)).toBe(true)
    await expect(secondResult).resolves.toBe(false)
    expect(alertTestState.alertStoreValue).toMatchObject({ type: 'none', msg: 'no' })
  })

  it('shares FIFO ownership between normal and plugin confirmations', async () => {
    const firstResult = alertPluginConfirm('Plugin permission')
    const secondResult = alertConfirm('Follow-up confirmation')

    expect(alertTestState.alertStoreValue).toMatchObject({ type: 'pluginconfirm', msg: 'Plugin permission' })
    const firstOwner = alertTestState.alertStoreValue.dialogOwner as symbol
    resolveAlertConfirmation(firstOwner, false)
    await expect(firstResult).resolves.toBe(false)

    expect(alertTestState.alertStoreValue).toMatchObject({ type: 'ask', msg: 'Follow-up confirmation' })
    const secondOwner = alertTestState.alertStoreValue.dialogOwner as symbol
    resolveAlertConfirmation(secondOwner, true)
    await expect(secondResult).resolves.toBe(true)
  })

  it('treats a programmatic close as cancellation before advancing the queue', async () => {
    const firstResult = alertConfirm('Close this confirmation')
    const secondResult = alertConfirm('Show this after close')

    alertClear()

    await expect(firstResult).resolves.toBe(false)
    expect(alertTestState.alertStoreValue).toMatchObject({ type: 'ask', msg: 'Show this after close' })

    const secondOwner = alertTestState.alertStoreValue.dialogOwner as symbol
    resolveAlertConfirmation(secondOwner, true)
    await expect(secondResult).resolves.toBe(true)
  })

  it('waits for an unrelated modal instead of overwriting it', async () => {
    alertNormal('Read this notice first')

    const result = alertConfirm('Confirmation after notice')

    expect(alertTestState.alertStoreValue).toEqual({ type: 'normal', msg: 'Read this notice first' })

    alertClear()
    await vi.waitFor(() =>
      expect(alertTestState.alertStoreValue).toMatchObject({ type: 'ask', msg: 'Confirmation after notice' }),
    )

    const owner = alertTestState.alertStoreValue.dialogOwner as symbol
    resolveAlertConfirmation(owner, true)
    await expect(result).resolves.toBe(true)
  })

  it('cancels a replaced confirmation and resumes the queue only after the replacement closes', async () => {
    const replacedResult = alertConfirm('Confirmation being replaced')
    const queuedResult = alertConfirm('Confirmation waiting behind replacement')

    alertNormal('Unrelated urgent notice')

    await expect(replacedResult).resolves.toBe(false)
    expect(alertTestState.alertStoreValue).toEqual({ type: 'normal', msg: 'Unrelated urgent notice' })

    alertClear()
    await vi.waitFor(() =>
      expect(alertTestState.alertStoreValue).toMatchObject({
        type: 'ask',
        msg: 'Confirmation waiting behind replacement',
      }),
    )

    const queuedOwner = alertTestState.alertStoreValue.dialogOwner as symbol
    resolveAlertConfirmation(queuedOwner, false)
    await expect(queuedResult).resolves.toBe(false)
  })

  it('ignores a stale response without resolving or hiding the active confirmation', async () => {
    const firstResult = alertConfirm('Old confirmation')
    const secondResult = alertConfirm('Current confirmation')
    const firstOwner = alertTestState.alertStoreValue.dialogOwner as symbol

    resolveAlertConfirmation(firstOwner, true)
    await expect(firstResult).resolves.toBe(true)
    const secondOwner = alertTestState.alertStoreValue.dialogOwner as symbol

    expect(resolveAlertConfirmation(firstOwner, false)).toBe(false)
    expect(alertTestState.alertStoreValue).toMatchObject({
      type: 'ask',
      msg: 'Current confirmation',
      dialogOwner: secondOwner,
    })

    resolveAlertConfirmation(secondOwner, false)
    await expect(secondResult).resolves.toBe(false)
  })

  it('preserves an unrelated dialog result before displaying a queued confirmation', async () => {
    const inputResult = alertInput('Name')
    const confirmationResult = alertConfirm('Continue after input')

    alertStore.set({ type: 'none', msg: 'Risu' })

    await expect(inputResult).resolves.toBe('Risu')
    await vi.waitFor(() =>
      expect(alertTestState.alertStoreValue).toMatchObject({ type: 'ask', msg: 'Continue after input' }),
    )

    const owner = alertTestState.alertStoreValue.dialogOwner as symbol
    resolveAlertConfirmation(owner, true)
    await expect(confirmationResult).resolves.toBe(true)
  })
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
