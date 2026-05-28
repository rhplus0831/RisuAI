import { fetchServerBootstrapProjection } from './server/bootstrap'

// Accepted: the page-load entrypoint is the writer-intent caller and is listed
// in WRITER_BOOTSTRAP_CALLERS, so registering active-writer ownership here is
// exactly the documented behavior.
export async function loadData(): Promise<unknown> {
  return fetchServerBootstrapProjection()
}
