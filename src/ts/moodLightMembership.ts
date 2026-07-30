import { getCharacterDisplayName } from './characterDisplayName'
import type { Database, folder } from './storage/database.svelte'

export interface MoodLightFolderMembership {
  id: string
  characterIds: string[]
  excludedCharacterIds: string[]
}

export interface MoodLightMembership {
  characterIds: string[]
  folders: MoodLightFolderMembership[]
}

export type MoodLightManagementTarget =
  | { kind: 'character'; id: string; name: string; folderName?: string }
  | { kind: 'folder'; id: string; name: string }

type CharacterOrderEntry = string | folder

const EMPTY_MEMBERSHIP: MoodLightMembership = {
  characterIds: [],
  folders: [],
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(
    new Set(value.filter((id): id is string => typeof id === 'string' && id.trim().length > 0).map((id) => id.trim())),
  )
}

export function normalizeMoodLightMembership(value: unknown): MoodLightMembership {
  if (!isRecord(value)) return { ...EMPTY_MEMBERSHIP, characterIds: [], folders: [] }

  const foldersById = new Map<string, MoodLightFolderMembership>()
  if (Array.isArray(value.folders)) {
    for (const candidate of value.folders) {
      if (!isRecord(candidate) || typeof candidate.id !== 'string' || candidate.id.trim().length === 0) continue
      const id = candidate.id.trim()
      const existing = foldersById.get(id)
      const characterIds = normalizeIds(candidate.characterIds)
      const excludedCharacterIds = normalizeIds(candidate.excludedCharacterIds)
      if (existing) {
        existing.characterIds = Array.from(new Set([...existing.characterIds, ...characterIds]))
        existing.excludedCharacterIds = Array.from(new Set([...existing.excludedCharacterIds, ...excludedCharacterIds]))
      } else {
        foldersById.set(id, { id, characterIds, excludedCharacterIds })
      }
    }
  }

  return {
    characterIds: normalizeIds(value.characterIds),
    folders: Array.from(foldersById.values()),
  }
}

export function moodLightMembershipFromDatabase(
  database: Pick<Database, 'moodLightMembership'> | null | undefined,
): MoodLightMembership {
  return normalizeMoodLightMembership(database?.moodLightMembership)
}

function characterOrder(database: Pick<Database, 'characterOrder'>): readonly CharacterOrderEntry[] {
  return Array.isArray(database.characterOrder) ? database.characterOrder : []
}

function currentFolderCharacterIds(database: Pick<Database, 'characterOrder'>, folderId: string): readonly string[] {
  const matching = characterOrder(database).find(
    (entry): entry is folder => typeof entry !== 'string' && entry.id === folderId,
  )
  return Array.isArray(matching?.data) ? matching.data : []
}

export function moodLightFolderIsProtected(database: Pick<Database, 'moodLightMembership'>, folderId: string): boolean {
  return moodLightMembershipFromDatabase(database).folders.some((entry) => entry.id === folderId)
}

export function moodLightProtectedCharacterIds(
  database: Pick<Database, 'characterOrder' | 'moodLightMembership'>,
): Set<string> {
  const membership = moodLightMembershipFromDatabase(database)
  const protectedIds = new Set(membership.characterIds)

  for (const protectedFolder of membership.folders) {
    const excluded = new Set(protectedFolder.excludedCharacterIds)
    for (const characterId of [
      ...protectedFolder.characterIds,
      ...currentFolderCharacterIds(database, protectedFolder.id),
    ]) {
      if (!excluded.has(characterId)) protectedIds.add(characterId)
    }
  }

  return protectedIds
}

export function moodLightCharacterIsProtected(
  database: Pick<Database, 'characterOrder' | 'moodLightMembership'>,
  characterId: string | null | undefined,
): boolean {
  return typeof characterId === 'string' && moodLightProtectedCharacterIds(database).has(characterId)
}

export function isMoodLightCharacterVisible(
  database: Pick<Database, 'characterOrder' | 'moodLightMembership'>,
  characterId: string | null | undefined,
  moodLightActive: boolean,
): boolean {
  if (typeof characterId !== 'string' || characterId.length === 0) return !moodLightActive
  return moodLightCharacterIsProtected(database, characterId) === moodLightActive
}

/**
 * Partition the character order without mutating the durable organization.
 * Children whose privacy differs from their folder are promoted into the
 * visible root so the hidden folder itself never leaks into the other mode.
 */
export function filterCharacterOrderForMoodLight(
  database: Pick<Database, 'characterOrder' | 'moodLightMembership'>,
  moodLightActive: boolean,
): CharacterOrderEntry[] {
  const membership = moodLightMembershipFromDatabase(database)
  const protectedFolders = new Set(membership.folders.map((entry) => entry.id))
  const protectedCharacters = moodLightProtectedCharacterIds(database)
  const visible: CharacterOrderEntry[] = []

  for (const entry of characterOrder(database)) {
    if (typeof entry === 'string') {
      if (protectedCharacters.has(entry) === moodLightActive) visible.push(entry)
      continue
    }

    const folderProtected = protectedFolders.has(entry.id)
    const visibleChildren = entry.data.filter((characterId) => protectedCharacters.has(characterId) === moodLightActive)

    if (folderProtected === moodLightActive) {
      visible.push({ ...entry, data: visibleChildren })
    } else {
      visible.push(...visibleChildren)
    }
  }

  return visible
}

export function buildMoodLightManagementTargets(
  database: Pick<Database, 'characterOrder' | 'characters'>,
): MoodLightManagementTarget[] {
  const charactersById = new Map(
    database.characters
      .filter((character): character is typeof character & { chaId: string } =>
        Boolean(character?.chaId && character.chaId !== '§playground' && !character.trashTime),
      )
      .map((character) => [character.chaId, character]),
  )
  const targets: MoodLightManagementTarget[] = []
  const seenCharacters = new Set<string>()

  const addCharacter = (characterId: string, folderName?: string) => {
    if (seenCharacters.has(characterId)) return
    const character = charactersById.get(characterId)
    if (!character) return
    seenCharacters.add(characterId)
    targets.push({
      kind: 'character',
      id: characterId,
      name: getCharacterDisplayName(character),
      ...(folderName ? { folderName } : {}),
    })
  }

  for (const entry of characterOrder(database)) {
    if (typeof entry === 'string') {
      addCharacter(entry)
      continue
    }
    targets.push({ kind: 'folder', id: entry.id, name: entry.name })
    for (const characterId of entry.data) addCharacter(characterId, entry.name)
  }

  for (const characterId of charactersById.keys()) addCharacter(characterId)
  return targets
}

export function toggleMoodLightManagementTarget(
  database: Pick<Database, 'characterOrder' | 'moodLightMembership'>,
  target: Pick<MoodLightManagementTarget, 'kind' | 'id'>,
): MoodLightMembership {
  const membership = moodLightMembershipFromDatabase(database)
  if (target.kind === 'folder') {
    const existingIndex = membership.folders.findIndex((entry) => entry.id === target.id)
    if (existingIndex >= 0) {
      membership.folders.splice(existingIndex, 1)
    } else {
      membership.folders.push({
        id: target.id,
        characterIds: [...currentFolderCharacterIds(database, target.id)],
        excludedCharacterIds: [],
      })
    }
    return normalizeMoodLightMembership(membership)
  }

  const currentlyProtected = moodLightCharacterIsProtected(database, target.id)
  membership.characterIds = membership.characterIds.filter((id) => id !== target.id)

  for (const protectedFolder of membership.folders) {
    const inherited = new Set([
      ...protectedFolder.characterIds,
      ...currentFolderCharacterIds(database, protectedFolder.id),
    ]).has(target.id)
    protectedFolder.excludedCharacterIds = protectedFolder.excludedCharacterIds.filter((id) => id !== target.id)
    if (currentlyProtected && inherited) protectedFolder.excludedCharacterIds.push(target.id)
  }

  if (!currentlyProtected) membership.characterIds.push(target.id)
  return normalizeMoodLightMembership(membership)
}
