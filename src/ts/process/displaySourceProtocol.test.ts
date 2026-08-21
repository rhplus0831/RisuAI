import { describe, expect, it } from 'vitest'
import {
  displaySourceNamespaceJson,
  normalizeDisplayRequestContext,
  stableDisplayDependencyJson,
} from './displaySourceProtocol'

describe('display source protocol helpers', () => {
  it('normalizes viewport context while requiring an ephemeral page id', () => {
    expect(
      normalizeDisplayRequestContext({
        pageSessionId: ' page-a ',
        browserLanguage: ' ko-KR ',
        screenWidth: 777.4,
        screenHeight: 555.6,
      }),
    ).toEqual({ pageSessionId: 'page-a', browserLanguage: 'ko-KR', screenWidth: 777, screenHeight: 556 })
    expect(normalizeDisplayRequestContext({ screenWidth: 777 })).toBeUndefined()
  })

  it('serializes dependencies canonically and includes every namespace dimension', () => {
    expect(stableDisplayDependencyJson({ z: 1, a: { y: 2, x: 3 }, omitted: undefined })).toBe(
      '{"a":{"x":3,"y":2},"z":1}',
    )
    const first = displaySourceNamespaceJson({
      databaseLineage: 'lineage-a',
      activeWriterEpoch: 1,
      context: { pageSessionId: 'page-a', screenWidth: 800, screenHeight: 600, browserLanguage: 'en-US' },
    })
    const changedHeight = displaySourceNamespaceJson({
      databaseLineage: 'lineage-a',
      activeWriterEpoch: 1,
      context: { pageSessionId: 'page-a', screenWidth: 800, screenHeight: 601, browserLanguage: 'en-US' },
    })
    expect(changedHeight).not.toBe(first)
  })
})
