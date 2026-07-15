import { describe, expect, it } from 'vitest'
import { resolveRealmImportId } from './realmImportInput'

describe('resolveRealmImportId', () => {
  it.each([
    ['realm-card', 'realm-card'],
    ['  realm-card  ', 'realm-card'],
    ['?realm=query-card', 'query-card'],
    ['code=query-code', 'query-code'],
    ['https://realm.risuai.net/character/path-card', 'path-card'],
    ['//realm.risuai.net/character/path-card', 'path-card'],
    ['https://realm.risuai.net/character/path-card/?unrelated=value#details', 'path-card'],
    ['https://risuai.net/?realm=query-card', 'query-card'],
    ['https://risuai.net/character/path-card?code=query-code', 'query-code'],
  ])('resolves %s without including URL syntax in the id', (input, expected) => {
    expect(resolveRealmImportId(input)).toBe(expected)
  })

  it.each([
    '',
    '   ',
    'https://',
    'https://[broken',
    'ftp://realm.risuai.net/character/card',
    'https://realm.risuai.net/character/',
    'https://realm.risuai.net/character/%E0%A4%A',
    'id/with/slashes',
    'id?with=query',
  ])('returns null without throwing for invalid input %s', (input) => {
    expect(() => resolveRealmImportId(input)).not.toThrow()
    expect(resolveRealmImportId(input)).toBeNull()
  })
})
