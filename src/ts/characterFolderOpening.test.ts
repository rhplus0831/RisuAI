import { describe, expect, it, vi } from 'vitest'
import { canOpenCharacterFolder } from './characterFolderOpening'

describe('character folder opening confirmation', () => {
  it('remembers only confirmed folders for the lifetime of the page module', async () => {
    const confirm = vi.fn<() => Promise<boolean>>()

    await expect(canOpenCharacterFolder({ folderId: 'unprotected', askBeforeOpening: false, confirm })).resolves.toBe(
      true,
    )
    expect(confirm).not.toHaveBeenCalled()

    confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    await expect(canOpenCharacterFolder({ folderId: 'protected', askBeforeOpening: true, confirm })).resolves.toBe(
      false,
    )
    await expect(canOpenCharacterFolder({ folderId: 'protected', askBeforeOpening: true, confirm })).resolves.toBe(true)
    await expect(canOpenCharacterFolder({ folderId: 'protected', askBeforeOpening: true, confirm })).resolves.toBe(true)

    expect(confirm).toHaveBeenCalledTimes(2)
  })

  it('coalesces simultaneous opening attempts for the same folder', async () => {
    let resolveConfirmation!: (confirmed: boolean) => void
    const confirmation = new Promise<boolean>((resolve) => {
      resolveConfirmation = resolve
    })
    const confirm = vi.fn(() => confirmation)

    const first = canOpenCharacterFolder({ folderId: 'simultaneous', askBeforeOpening: true, confirm })
    const second = canOpenCharacterFolder({ folderId: 'simultaneous', askBeforeOpening: true, confirm })
    await Promise.resolve()
    resolveConfirmation(true)

    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
    expect(confirm).toHaveBeenCalledTimes(1)
  })
})
