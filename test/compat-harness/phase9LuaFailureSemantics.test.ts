import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from 'vitest'
import { resolveCompatibilityBaselineRoot } from '../../util/compat-baseline'

const currentRoot = path.resolve(import.meta.dirname, '../..')
const baselineRoot = resolveCompatibilityBaselineRoot()

function source(root: string, relativePath: string): string {
  return readFileSync(path.join(root, relativePath), 'utf8')
}

function runLuaEditTriggerBody(scriptingsSource: string): string {
  const start = scriptingsSource.indexOf('export async function runLuaEditTrigger')
  const end = scriptingsSource.indexOf('export async function runLuaButtonTrigger', start)
  if (start === -1 || end === -1) throw new Error('runLuaEditTrigger source boundary not found')
  return scriptingsSource.slice(start, end)
}

test('baseline and current browser Lua edit hooks retain the original content after a failure', () => {
  const baselineBody = runLuaEditTriggerBody(source(baselineRoot, 'src/ts/process/scriptings.ts'))
  const currentBody = runLuaEditTriggerBody(source(currentRoot, 'src/ts/process/scriptings.ts'))

  expect(baselineBody).toMatch(/catch\s*\([^)]*\)\s*\{[\s\S]*return content/)
  expect(currentBody).toMatch(/catch\s*\([^)]*\)\s*\{[\s\S]*return content/)
})

test('Fastify keeps the RH+-authorized visible Lua edit-hook failure', () => {
  const serverSource = source(currentRoot, 'server/fastify/src/prompt/luaRuntime.ts')
  const start = serverSource.indexOf('export async function runLuaEditTrigger')
  if (start === -1) throw new Error('Fastify runLuaEditTrigger source boundary not found')
  const body = serverSource.slice(start)

  expect(body).toContain('throwServerLuaFailure(runResult, `Lua ${mode} edit trigger failed`)')
  expect(body).toMatch(/catch\s*\(error\)\s*\{[\s\S]*throw error/)
})
