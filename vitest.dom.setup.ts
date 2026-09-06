import { afterAll, afterEach, beforeEach } from 'vitest'
import { createUnexpectedPort3000FetchGuard } from './vitest.fetchGuard'

const happyDomFetchGuard = createUnexpectedPort3000FetchGuard(globalThis.fetch, () => globalThis.location.href)
globalThis.fetch = happyDomFetchGuard.fetch

function failUnexpectedPort3000Fetches(): void {
  const unexpectedRequests = happyDomFetchGuard.takeUnexpectedRequests()
  if (unexpectedRequests.length === 0) return
  if (unexpectedRequests.length === 1) throw unexpectedRequests[0]

  throw new AggregateError(
    unexpectedRequests,
    `${unexpectedRequests.length} unexpected Happy-DOM fetches targeted loopback port 3000`,
  )
}

// afterEach catches requests made during an awaited test. beforeEach and
// afterAll also surface work that escaped the preceding test's teardown.
beforeEach(failUnexpectedPort3000Fetches)
afterEach(failUnexpectedPort3000Fetches)
afterAll(failUnexpectedPort3000Fetches)
