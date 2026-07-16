import { describe, expect, it } from 'vitest'

import { parseDevToolAutopilotImport } from './devToolAutopilotImport'

const bytes = (value: string) => new TextEncoder().encode(value)

describe('DevTool autopilot imports', () => {
  it('accepts supported extensions case-insensitively', () => {
    expect(parseDevToolAutopilotImport('AUTO.JSON', bytes('["one","two"]'))).toEqual(['one', 'two'])
    expect(parseDevToolAutopilotImport('AUTO.TXT', bytes('one\ntwo'))).toEqual(['one', 'two'])
    expect(parseDevToolAutopilotImport('AUTO.CSV', bytes('one\\ntwo\r\nthree'))).toEqual(['one\ntwo', 'three'])
  })

  it('rejects unsupported or non-text JSON list data', () => {
    expect(parseDevToolAutopilotImport('auto.json', bytes('["one",2]'))).toBeNull()
    expect(parseDevToolAutopilotImport('auto.md', bytes('one'))).toBeNull()
  })

  it('surfaces malformed JSON to the caller', () => {
    expect(() => parseDevToolAutopilotImport('auto.json', bytes('{'))).toThrow()
  })
})
