import { describe, expect, it } from 'vitest'
import { isImportableMCPIdentifier } from './mcpIdentifier.js'

describe('MCP importable identifiers', () => {
  it.each([
    'internal:risuai',
    'stdio:server-command',
    'plugin:example/tool',
    'https://example.test/mcp',
    'http://localhost:3000/mcp',
    'http://127.0.0.1/mcp',
    'http://127.255.255.255/mcp',
    'http://[::1]/mcp',
  ])('accepts %s', (identifier) => {
    expect(isImportableMCPIdentifier(identifier)).toBe(true)
  })

  it.each([
    '',
    'internal:',
    'internal:has space',
    'ftp://example.test/mcp',
    'http://example.test/mcp',
    'http://192.168.0.1/mcp',
    'not-a-url',
  ])('rejects %s', (identifier) => {
    expect(isImportableMCPIdentifier(identifier)).toBe(false)
  })
})
