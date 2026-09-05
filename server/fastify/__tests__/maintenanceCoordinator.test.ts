import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MaintenanceBusyError,
  MaintenanceCoordinator,
  closeMaintenance,
  getMaintenanceCoordinator,
  openMaintenance,
} from '../src/maintenanceCoordinator.js'

describe('maintenance admission', () => {
  it('rejects overlapping operations immediately and exposes the transient HTTP error', () => {
    const coordinator = new MaintenanceCoordinator()
    const backup = coordinator.beginExclusive('backup')

    for (const begin of [
      () => coordinator.beginExclusive('restore'),
      () => coordinator.beginSaveMutation(),
      () => coordinator.beginAssetStaging(),
    ]) {
      expect(begin).toThrow(MaintenanceBusyError)
      expect(begin).toThrow(expect.objectContaining({ statusCode: 503, code: 'maintenance_busy' }))
    }
    expect(backup.kind).toBe('backup')
    expect(coordinator.isReclamationBlocked()).toBe(true)
    backup.release()
    const restore = coordinator.beginExclusive('restore')
    restore.release()
    expect(coordinator.isReclamationBlocked()).toBe(false)
  })

  it('bounds saves and asset staging independently while excluding maintenance', () => {
    const coordinator = new MaintenanceCoordinator()
    const saves = Array.from({ length: 4 }, () => coordinator.beginSaveMutation())
    expect(coordinator.isReclamationBlocked()).toBe(false)
    const staging = Array.from({ length: 4 }, () => coordinator.beginAssetStaging())

    expect(() => coordinator.beginSaveMutation()).toThrow(MaintenanceBusyError)
    expect(() => coordinator.beginAssetStaging()).toThrow(MaintenanceBusyError)
    expect(() => coordinator.beginExclusive('import')).toThrow(MaintenanceBusyError)
    expect(coordinator.isReclamationBlocked()).toBe(true)

    saves[0]!.release()
    const replacementSave = coordinator.beginSaveMutation()
    expect(() => coordinator.beginSaveMutation()).toThrow(MaintenanceBusyError)
    staging[0]!.release()
    const replacementStaging = coordinator.beginAssetStaging()
    expect(() => coordinator.beginAssetStaging()).toThrow(MaintenanceBusyError)

    for (const lease of [...saves, ...staging, replacementSave, replacementStaging]) lease.release()
    const imported = coordinator.beginExclusive('import')
    imported.release()
  })

  it('keeps maintenance excluded until the last shared operation releases', () => {
    const coordinator = new MaintenanceCoordinator()
    const save = coordinator.beginSaveMutation()
    const staging = coordinator.beginAssetStaging()
    staging.release()

    expect(coordinator.isReclamationBlocked()).toBe(false)
    expect(() => coordinator.beginExclusive('backup')).toThrow(MaintenanceBusyError)
    save.release()
    coordinator.beginExclusive('backup').release()
  })

  it('validates explicit nested ownership and rejects stale, foreign, and shared leases', () => {
    const coordinator = new MaintenanceCoordinator()
    const otherCoordinator = new MaintenanceCoordinator()
    const restore = coordinator.beginExclusive('restore')
    const foreign = otherCoordinator.beginExclusive('backup')

    expect(() => coordinator.assertExclusive(restore)).not.toThrow()
    expect(() => coordinator.assertExclusive(restore)).not.toThrow()
    expect(() => coordinator.assertExclusive(foreign)).toThrow('invalid_maintenance_lease')
    expect(() => coordinator.assertExclusive({ ...restore })).toThrow('invalid_maintenance_lease')
    restore.release()
    expect(() => coordinator.assertExclusive(restore)).toThrow('invalid_maintenance_lease')
    const save = coordinator.beginSaveMutation()
    expect(() => coordinator.assertExclusive(save)).toThrow('invalid_maintenance_lease')
    save.release()
    foreign.release()
  })

  it('invalidates reclamation discovery across asset activity and protected intervals', () => {
    const coordinator = new MaintenanceCoordinator()
    const initialActivity = coordinator.activityVersion
    const initialProtection = coordinator.protectionVersion
    const save = coordinator.beginSaveMutation()
    save.release()
    expect(coordinator.protectionVersion).toBe(initialProtection)
    coordinator.noteAssetActivity()
    expect(coordinator.activityVersion).toBe(initialActivity + 1)

    const staging = coordinator.beginAssetStaging()
    const stagingVersion = coordinator.protectionVersion
    expect(stagingVersion).toBeGreaterThan(initialProtection)
    staging.release()
    const afterStaging = coordinator.protectionVersion
    expect(afterStaging).toBeGreaterThan(stagingVersion)
    staging.release()
    expect(coordinator.protectionVersion).toBe(afterStaging)

    const backup = coordinator.beginExclusive('backup')
    const backupVersion = coordinator.protectionVersion
    expect(backupVersion).toBeGreaterThan(afterStaging)
    backup.release()
    expect(coordinator.protectionVersion).toBeGreaterThan(backupVersion)
  })
})

describe('maintenance cancellation and shutdown', () => {
  it('preserves ownership until caller cleanup finishes after request cancellation', () => {
    const coordinator = new MaintenanceCoordinator()
    const request = new AbortController()
    const backup = coordinator.beginExclusive('backup', request.signal)
    const reason = new Error('request disconnected')
    request.abort(reason)

    expect(backup.signal.aborted).toBe(true)
    expect(backup.signal.reason).toBe(reason)
    expect(coordinator.isReclamationBlocked()).toBe(true)
    expect(() => coordinator.assertExclusive(backup)).not.toThrow()
    expect(() => coordinator.beginExclusive('restore')).toThrow(MaintenanceBusyError)
    backup.release()
    coordinator.beginExclusive('restore').release()
  })

  it('does not admit an already cancelled request or retain one of its shared slots', () => {
    const coordinator = new MaintenanceCoordinator()
    const reason = new Error('already cancelled')
    const signal = AbortSignal.abort(reason)
    for (const begin of [
      () => coordinator.beginExclusive('backup', signal),
      () => coordinator.beginSaveMutation(signal),
      () => coordinator.beginAssetStaging(signal),
    ]) {
      expect(begin).toThrow(reason)
    }
    const leases = Array.from({ length: 4 }, () => coordinator.beginAssetStaging())
    for (const lease of leases) lease.release()
    coordinator.beginExclusive('backup').release()
  })

  it('aborts every lease, rejects admission, and waits for all cleanup to release', async () => {
    const coordinator = new MaintenanceCoordinator()
    const save = coordinator.beginSaveMutation()
    const request = new AbortController()
    const staging = coordinator.beginAssetStaging(request.signal)
    const protectionBeforeClose = coordinator.protectionVersion
    let drained = false
    const closing = coordinator.close()
    void closing.then(() => {
      drained = true
    })

    expect(coordinator.close()).toBe(closing)
    expect(save.signal.aborted).toBe(true)
    expect(staging.signal.aborted).toBe(true)
    expect(request.signal.aborted).toBe(false)
    expect(coordinator.protectionVersion).toBeGreaterThan(protectionBeforeClose)
    expect(coordinator.isClosing).toBe(true)
    for (const begin of [
      () => coordinator.beginExclusive('restore'),
      () => coordinator.beginSaveMutation(),
      () => coordinator.beginAssetStaging(),
    ]) {
      expect(begin).toThrow(MaintenanceBusyError)
    }
    await Promise.resolve()
    expect(drained).toBe(false)
    save.release()
    save.release()
    await Promise.resolve()
    expect(drained).toBe(false)
    staging.release()
    await closing
    expect(drained).toBe(true)
    expect(coordinator.isClosed).toBe(true)
    expect(coordinator.isReclamationBlocked()).toBe(true)
    expect(() => coordinator.beginExclusive('backup')).toThrow(MaintenanceBusyError)
  })

  it('can drain when an abort handler releases its lease synchronously', async () => {
    const coordinator = new MaintenanceCoordinator()
    const backup = coordinator.beginExclusive('backup')
    backup.signal.addEventListener('abort', () => backup.release(), { once: true })
    await coordinator.close()
    expect(coordinator.isClosed).toBe(true)
  })

  it('shares normalized directories and only reopens them after shutdown drains', async () => {
    const dataDir = resolve('maintenance-coordinator-tests', randomUUID())
    const alias = `${dataDir}/assets/..`
    const coordinator = openMaintenance(dataDir)
    expect(getMaintenanceCoordinator(alias)).toBe(coordinator)
    expect(openMaintenance(alias)).toBe(coordinator)
    const backup = coordinator.beginExclusive('backup')
    const closing = closeMaintenance(alias)

    expect(getMaintenanceCoordinator(dataDir)).toBe(coordinator)
    expect(() => openMaintenance(dataDir)).toThrow(MaintenanceBusyError)
    expect(() => getMaintenanceCoordinator(alias).beginExclusive('backup')).toThrow(MaintenanceBusyError)
    backup.release()
    await closing
    expect(getMaintenanceCoordinator(dataDir)).toBe(coordinator)
    expect(() => coordinator.beginExclusive('backup')).toThrow(MaintenanceBusyError)

    const replacement = openMaintenance(alias)
    expect(replacement).not.toBe(coordinator)
    expect(getMaintenanceCoordinator(dataDir)).toBe(replacement)
    replacement.beginExclusive('backup').release()
    expect(() => coordinator.beginExclusive('backup')).toThrow(MaintenanceBusyError)
    await closeMaintenance(dataDir)
  })
})
