import { fetchServerBootstrapProjection } from './server/bootstrap'

// Accepted: page-load bootstrap is the writer-intent caller.
export async function loadData(): Promise<unknown> {
  return fetchServerBootstrapProjection()
}
