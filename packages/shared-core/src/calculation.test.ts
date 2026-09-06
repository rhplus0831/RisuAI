import { describe, expect, it } from 'vitest'
import { calculateString, type CalculationVariableResolver } from './calculation.js'

const variables: CalculationVariableResolver = {
  getChatVar: (key) => ({ score: '4', invalid: 'not-a-number' })[key] ?? 'null',
  getGlobalChatVar: (key) => ({ bonus: '3' })[key] ?? 'null',
}

describe('injected string calculation', () => {
  it.each([
    ['2+3*4', 14],
    ['(2+3)*4', 20],
    ['-2+5', 3],
    ['2^3', 8],
    ['3>=3', 1],
    ['3!=3', 0],
    ['null+1', 1],
    ['$score+@bonus', 7],
    ['$invalid+1', 1],
  ])('preserves historical evaluation for %s', (expression, expected) => {
    expect(calculateString(expression, variables)).toBe(expected)
  })
})
