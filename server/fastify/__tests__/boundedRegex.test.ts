import { describe, expect, it, vi } from 'vitest'
import type { Database } from '../../../src/ts/storage/database.svelte'
import {
  BOUNDED_REGEX_LIMITS,
  DEFAULT_COMPLEX_REGEX_TIMEOUT_MS,
  type BoundedRegexCompatibilityOptions,
  type BoundedRegexLike,
  type ComplexBoundedRegex,
  compileBoundedRegex,
  compileBoundedRegexWithCompatibility,
  complexRegexCompatibilityOptions,
  isBoundedRegexError,
  isComplexBoundedRegex,
  matchFirstBoundedRegexWithCompatibility,
  moveBoundedRegexWithCompatibility,
  replaceBoundedRegexWithCompatibility,
  splitBoundedRegexWithCompatibility,
  testBoundedRegex,
  testBoundedRegexWithCompatibility,
  triggerReplaceBoundedRegexWithCompatibility,
} from '../src/prompt/boundedRegex.js'

const workerOptions: BoundedRegexCompatibilityOptions = {
  enabled: true,
  stage: 'output',
  timeoutMs: DEFAULT_COMPLEX_REGEX_TIMEOUT_MS,
  sizeLimit: 128 * 1024,
}

const disabledOptions: BoundedRegexCompatibilityOptions = {
  ...workerOptions,
  enabled: false,
}

function compileComplex(pattern = '((a+)+)(b)', flags = 'g'): ComplexBoundedRegex {
  const regex = compileBoundedRegexWithCompatibility(pattern, flags, 'compatibility pattern', workerOptions)
  if (!isComplexBoundedRegex(regex)) {
    throw new Error('expected the complexity screen to select the worker representation')
  }
  return regex
}

async function runPublicOperations(regex: BoundedRegexLike) {
  const haystack = 'aab xx aaab'
  return {
    test: await testBoundedRegexWithCompatibility(regex, haystack, 'test input', workerOptions),
    replace: await replaceBoundedRegexWithCompatibility(
      regex,
      haystack,
      '[$1:$3]',
      'replace input',
      'replace value',
      workerOptions,
    ),
    split: await splitBoundedRegexWithCompatibility(regex, haystack, 'split input', workerOptions),
    matchFirst: await matchFirstBoundedRegexWithCompatibility(regex, haystack, 'match input', workerOptions),
    move: await moveBoundedRegexWithCompatibility(
      regex,
      haystack,
      '@@move_bottom <$1>/$3/$&',
      false,
      'move input',
      'move value',
      workerOptions,
    ),
    triggerReplace: await triggerReplaceBoundedRegexWithCompatibility(
      regex,
      haystack,
      '$1',
      'X',
      'trigger input',
      'trigger result',
      'trigger replacement',
      workerOptions,
    ),
  }
}

describe('bounded regex limits', () => {
  it('accepts each exact cap and rejects the first code unit beyond it', async () => {
    expect(BOUNDED_REGEX_LIMITS.replacement).toBe(16 * 1024 * 1024)
    expect(BOUNDED_REGEX_LIMITS.output).toBe(16 * 1024 * 1024)
    const exactPattern = 'a'.repeat(BOUNDED_REGEX_LIMITS.pattern)
    expect(compileBoundedRegex(exactPattern, '', 'pattern boundary')).toBeInstanceOf(RegExp)
    expect(() => compileBoundedRegex(`${exactPattern}a`, '', 'pattern boundary')).toThrow(
      `pattern length ${BOUNDED_REGEX_LIMITS.pattern + 1} exceeds cap ${BOUNDED_REGEX_LIMITS.pattern}`,
    )

    const exactHaystack = 'a'.repeat(BOUNDED_REGEX_LIMITS.haystack)
    expect(testBoundedRegex(/z/, exactHaystack, 'haystack boundary')).toBe(false)
    expect(() => testBoundedRegex(/z/, `${exactHaystack}a`, 'haystack boundary')).toThrow(
      `haystack length ${BOUNDED_REGEX_LIMITS.haystack + 1} exceeds cap ${BOUNDED_REGEX_LIMITS.haystack}`,
    )

    const exactReplacement = 'x'.repeat(workerOptions.sizeLimit)
    await expect(
      replaceBoundedRegexWithCompatibility(
        /a/,
        'a',
        exactReplacement,
        'replacement input',
        'replacement boundary',
        workerOptions,
      ),
    ).resolves.toHaveLength(workerOptions.sizeLimit)
    await expect(
      replaceBoundedRegexWithCompatibility(
        /a/,
        'a',
        `${exactReplacement}x`,
        'replacement input',
        'replacement boundary',
        workerOptions,
      ),
    ).rejects.toMatchObject({
      code: 'RISU_BOUNDED_REGEX',
      message: expect.stringContaining(
        `replacement length ${workerOptions.sizeLimit + 1} exceeds cap ${workerOptions.sizeLimit}`,
      ),
    })
  })
})

describe('bounded regex compatibility selection', () => {
  it('uses a 15-second runtime fallback timeout', () => {
    expect(DEFAULT_COMPLEX_REGEX_TIMEOUT_MS).toBe(15_000)
  })

  it('uses the worker fallback only for complexity-screen rejections', () => {
    expect(compileComplex()).toEqual({
      kind: 'complex-bounded-regex',
      pattern: '((a+)+)(b)',
      flags: 'g',
      context: 'compatibility pattern',
    })
    expect(compileBoundedRegexWithCompatibility('(ab)+', 'g', 'safe pattern', workerOptions)).toBeInstanceOf(RegExp)

    expect(() => compileBoundedRegexWithCompatibility('(', '', 'syntax error', workerOptions)).toThrow(SyntaxError)

    const oversizedComplexPattern = '(a+)+'.repeat(Math.ceil((BOUNDED_REGEX_LIMITS.pattern + 1) / 5))
    expect(() =>
      compileBoundedRegexWithCompatibility(oversizedComplexPattern, '', 'oversized pattern', workerOptions),
    ).toThrow(/pattern length \d+ exceeds cap 4096/)

    expect(() =>
      compileBoundedRegexWithCompatibility('(a+)+', '', 'strict complexity rejection', disabledOptions),
    ).toThrow('complexity screen rejected nested unbounded quantifiers')
  })

  it('rejects prefix-overlapping quantified alternatives without rejecting distinct branches', () => {
    for (const pattern of ['(a|aa)+$', '(a|a?)+']) {
      expect(() => compileBoundedRegex(pattern, '', 'overlapping alternatives')).toThrow(
        'complexity screen rejected overlapping quantified alternatives',
      )
      expect(compileBoundedRegexWithCompatibility(pattern, '', 'worker alternatives', workerOptions)).toMatchObject({
        kind: 'complex-bounded-regex',
        pattern,
      })
    }

    for (const pattern of ['(ab|ac)+$', '(cat|dog)+$']) {
      expect(compileBoundedRegex(pattern, '', 'distinct alternatives')).toBeInstanceOf(RegExp)
    }
  })

  it('normalizes the stage timeout and enables only positive worker-mode values', () => {
    const database = {
      complexRegexCompatibilityMode: 'worker',
      complexRegexInputTimeoutMs: 12.9,
      complexRegexOutputTimeoutMs: -3,
      complexRegexDisplayTimeoutMs: 999_999,
      regexOutputSizeLimitMiB: 4,
    } as unknown as Database

    expect(complexRegexCompatibilityOptions(database, 'input')).toEqual({
      enabled: true,
      stage: 'input',
      timeoutMs: 12,
      sizeLimit: 4 * 1024 * 1024,
    })
    expect(complexRegexCompatibilityOptions(database, 'output')).toEqual({
      enabled: false,
      stage: 'output',
      timeoutMs: 0,
      sizeLimit: 4 * 1024 * 1024,
    })
    expect(complexRegexCompatibilityOptions(database, 'display')).toEqual({
      enabled: true,
      stage: 'display',
      timeoutMs: 600_000,
      sizeLimit: 4 * 1024 * 1024,
    })

    database.complexRegexInputTimeoutMs = Number.NaN
    expect(complexRegexCompatibilityOptions(database, 'input')).toEqual({
      enabled: true,
      stage: 'input',
      timeoutMs: DEFAULT_COMPLEX_REGEX_TIMEOUT_MS,
      sizeLimit: 4 * 1024 * 1024,
    })

    database.complexRegexCompatibilityMode = 'strict'
    expect(complexRegexCompatibilityOptions(database, 'display')).toMatchObject({ enabled: false })
  })
})

describe('bounded regex worker operations', () => {
  it('matches in-process behavior for captures and global operations', async () => {
    const direct = await runPublicOperations(new RegExp('((a+)+)(b)', 'g'))
    const worker = await runPublicOperations(compileComplex())

    expect(worker).toEqual(direct)
    expect(worker).toEqual({
      test: true,
      replace: '[aa:b] xx [aaa:b]',
      split: ['', 'aa', 'aa', 'b', ' xx ', 'aaa', 'aaa', 'b', ''],
      matchFirst: 'aab',
      move: ' xx \n<aa>/b/aab\n<aaa>/b/aaab',
      triggerReplace: 'Xb xx Xb',
    })
  })

  it('preserves native replacement-token semantics in direct and worker execution', async () => {
    const source = 'z aab q'
    const replacement = "[$`][$&][$1][$3][$'][$$][$99]"
    const directRegex = /((a+)+)(b)/g
    const expected = source.replace(directRegex, replacement)

    await expect(
      replaceBoundedRegexWithCompatibility(
        /((a+)+)(b)/g,
        source,
        replacement,
        'direct replacement semantics',
        'direct replacement template',
        workerOptions,
      ),
    ).resolves.toBe(expected)
    await expect(
      replaceBoundedRegexWithCompatibility(
        compileComplex(),
        source,
        replacement,
        'worker replacement semantics',
        'worker replacement template',
        workerOptions,
      ),
    ).resolves.toBe(expected)
  })

  it.each([
    {
      operation: 'replace',
      run: (regex: BoundedRegexLike) =>
        replaceBoundedRegexWithCompatibility(
          regex,
          'a a a',
          'x'.repeat(workerOptions.sizeLimit),
          'amplified replace',
          'amplified replacement',
          workerOptions,
        ),
    },
    {
      operation: 'move',
      run: (regex: BoundedRegexLike) =>
        moveBoundedRegexWithCompatibility(
          regex,
          'a a a',
          `@@move_bottom ${'x'.repeat(workerOptions.sizeLimit - '@@move_bottom '.length)}`,
          false,
          'amplified move',
          'amplified move replacement',
          workerOptions,
        ),
    },
    {
      operation: 'trigger replacement',
      run: (regex: BoundedRegexLike) =>
        triggerReplaceBoundedRegexWithCompatibility(
          regex,
          'a a a',
          '$1',
          'x'.repeat(workerOptions.sizeLimit),
          'amplified trigger replacement',
          'amplified trigger result',
          'amplified trigger value',
          workerOptions,
        ),
    },
  ])('rejects $operation amplification in direct and complex-worker paths', async ({ run }) => {
    await expect(run(/(a)/g)).rejects.toMatchObject({
      code: 'RISU_BOUNDED_REGEX',
      message: expect.stringContaining(`output length`),
    })
    await expect(run(compileComplex('((a+)+)', 'g'))).rejects.toMatchObject({
      code: 'RISU_BOUNDED_REGEX',
      message: expect.stringContaining(`output length`),
    })
  })

  it('preflights capture-amplified split output in direct and complex-worker paths', async () => {
    const source = 'a'.repeat(600)
    await expect(
      splitBoundedRegexWithCompatibility(/(?=(a+))/g, source, 'amplified direct split', workerOptions),
    ).rejects.toMatchObject({
      code: 'RISU_BOUNDED_REGEX',
      message: expect.stringContaining('output length'),
    })
    await expect(
      splitBoundedRegexWithCompatibility(
        compileComplex('(?=((a+)+))', 'g'),
        source,
        'amplified worker split',
        workerOptions,
      ),
    ).rejects.toMatchObject({
      code: 'RISU_BOUNDED_REGEX',
      message: expect.stringContaining('output length'),
    })
  })

  it('rejects replacement-token amplification before direct or worker output construction', async () => {
    const replacement = '$&'.repeat(workerOptions.sizeLimit / 2)
    const run = (regex: BoundedRegexLike) =>
      replaceBoundedRegexWithCompatibility(
        regex,
        'a a a a a',
        replacement,
        'token-amplified replace',
        'token-amplified replacement',
        workerOptions,
      )

    await expect(run(/(a)/g)).rejects.toMatchObject({
      code: 'RISU_BOUNDED_REGEX',
      message: expect.stringContaining('output length'),
    })
    await expect(run(compileComplex('((a+)+)', 'g'))).rejects.toMatchObject({
      code: 'RISU_BOUNDED_REGEX',
      message: expect.stringContaining('output length'),
    })
  })

  it('rejects a complex operation cleanly when compatibility is disabled', async () => {
    await expect(
      testBoundedRegexWithCompatibility(compileComplex('(a+)+', ''), 'aaa', 'disabled operation', disabledOptions),
    ).rejects.toMatchObject({
      code: 'RISU_BOUNDED_REGEX',
      message: expect.stringContaining('complexity screen rejected nested unbounded quantifiers'),
    })
  })

  it('wraps worker-side regex construction errors as bounded errors', async () => {
    const invalidWorkerRegex: ComplexBoundedRegex = {
      kind: 'complex-bounded-regex',
      pattern: '(',
      flags: '',
      context: 'invalid worker pattern',
    }

    const error = await testBoundedRegexWithCompatibility(
      invalidWorkerRegex,
      'input',
      'worker construction',
      workerOptions,
    ).catch((caught: unknown) => caught)

    expect(isBoundedRegexError(error)).toBe(true)
    expect(error).toMatchObject({
      code: 'RISU_BOUNDED_REGEX',
      message: expect.stringContaining('worker construction: complex regex worker failed'),
    })
  })

  it('reports worker timeouts with their configured stage without relying on wall-clock timing', async () => {
    vi.useFakeTimers()
    try {
      const pending = testBoundedRegexWithCompatibility(compileComplex('(a+)+', ''), 'aaa', 'timed operation', {
        enabled: true,
        stage: 'display',
        timeoutMs: 50,
        sizeLimit: workerOptions.sizeLimit,
      })

      vi.advanceTimersByTime(50)

      await expect(pending).rejects.toMatchObject({
        code: 'RISU_BOUNDED_REGEX',
        message: expect.stringContaining('timed out after 50ms during display stage'),
      })
    } finally {
      vi.useRealTimers()
    }
  })
})
