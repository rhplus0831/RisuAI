import { describe, expect, it } from 'vitest'

import {
  beginPersonaIconUpload,
  capturePersonaIconUploadTarget,
  clearPersonaIconUpload,
  resolveFreshPersonaIconUploadIndex,
  type PersonaIconRecord,
  type PersonaIconUploadOperation,
} from './personaIconUpload'

function persona(id: string | null | undefined, icon = 'old-icon'): PersonaIconRecord {
  return { id, icon }
}

function beginUpload(input: {
  selectedPersona?: number
  userIcon?: unknown
  personas?: PersonaIconRecord[]
}): PersonaIconUploadOperation {
  const target = capturePersonaIconUploadTarget({
    selectedPersona: input.selectedPersona ?? 0,
    userIcon: Object.hasOwn(input, 'userIcon') ? input.userIcon : 'old-icon',
    personas: input.personas ?? [persona('persona-a', 'old-icon')],
  })

  if (!target) {
    throw new Error('expected persona icon upload target')
  }

  return beginPersonaIconUpload(target)
}

function resolveUpload(
  operation: PersonaIconUploadOperation,
  freshness?: Partial<{
    selectedPersona: number
    userIcon: unknown
    personas: PersonaIconRecord[]
  }>,
): number | null {
  return resolveFreshPersonaIconUploadIndex(operation, {
    selectedPersona: freshness?.selectedPersona ?? 0,
    userIcon: Object.hasOwn(freshness ?? {}, 'userIcon') ? freshness?.userIcon : 'old-icon',
    personas: freshness?.personas ?? [persona(operation.personaId, 'old-icon')],
  })
}

describe('persona icon upload freshness', () => {
  it('rejects stale completion after selected persona changes', () => {
    const operation = beginUpload({
      personas: [persona('persona-a', 'old-icon'), persona('persona-b', 'icon-b')],
    })

    try {
      expect(
        resolveUpload(operation, {
          selectedPersona: 1,
          userIcon: 'old-icon',
          personas: [persona('persona-a', 'old-icon'), persona('persona-b', 'icon-b')],
        }),
      ).toBeNull()
    } finally {
      clearPersonaIconUpload(operation)
    }
  })

  it('rejects stale completion after the same persona icon changes', () => {
    const operation = beginUpload({
      userIcon: 'old-icon',
      personas: [persona('persona-a', 'old-icon')],
    })

    try {
      expect(
        resolveUpload(operation, {
          userIcon: 'manual-newer-icon',
          personas: [persona('persona-a', 'old-icon')],
        }),
      ).toBeNull()
      expect(
        resolveUpload(operation, {
          userIcon: 'old-icon',
          personas: [persona('persona-a', 'manual-newer-icon')],
        }),
      ).toBeNull()
    } finally {
      clearPersonaIconUpload(operation)
    }
  })

  it('lets the newer upload for the same persona win over an older delayed upload', () => {
    const older = beginUpload({})
    const newer = beginUpload({})

    try {
      expect(resolveUpload(newer)).toBe(0)
      expect(resolveUpload(older)).toBeNull()
    } finally {
      clearPersonaIconUpload(older)
      clearPersonaIconUpload(newer)
    }
  })

  it('does not let a canceled newer picker invalidate an older pending upload', () => {
    const older = beginUpload({})
    const canceledTarget = capturePersonaIconUploadTarget({
      selectedPersona: 0,
      userIcon: 'old-icon',
      personas: [persona('persona-a', 'old-icon')],
    })

    try {
      expect(canceledTarget).not.toBeNull()
      expect(resolveUpload(older)).toBe(0)
    } finally {
      clearPersonaIconUpload(older)
    }
  })

  it('rejects missing and duplicate persona ids', () => {
    expect(
      capturePersonaIconUploadTarget({
        selectedPersona: 0,
        userIcon: 'old-icon',
        personas: [persona(undefined, 'old-icon')],
      }),
    ).toBeNull()

    expect(
      capturePersonaIconUploadTarget({
        selectedPersona: 1,
        userIcon: 'old-icon',
        personas: [persona('duplicate', 'icon-a'), persona('duplicate', 'icon-b')],
      }),
    ).toBeNull()

    const operation = beginUpload({
      personas: [persona('persona-a', 'old-icon')],
    })
    try {
      expect(
        resolveUpload(operation, {
          personas: [persona('persona-a', 'old-icon'), persona('persona-a', 'old-icon')],
        }),
      ).toBeNull()
    } finally {
      clearPersonaIconUpload(operation)
    }
  })
})
