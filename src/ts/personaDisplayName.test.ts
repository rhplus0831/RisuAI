import { describe, expect, it } from 'vitest'

import { getPersonaDisplayInfo, getPersonaDisplayName } from './personaDisplayName'

describe('persona display names', () => {
  it('prefers a trimmed display name over the internal persona name', () => {
    expect(getPersonaDisplayName({ name: 'Internal User', displayName: '  Visible User  ' })).toBe('Visible User')
  })

  it('falls back to internal name and includes both names in search text when they differ', () => {
    expect(getPersonaDisplayName({ name: 'Internal User', displayName: '   ' })).toBe('Internal User')
    expect(getPersonaDisplayInfo({ name: 'Internal User', displayName: 'Visible User' })).toEqual({
      name: 'Visible User',
      searchText: 'Visible User Internal User',
    })
  })
})
