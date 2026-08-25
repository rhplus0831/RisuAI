import { prefetchRoutePathResources } from './server/routeResourceLoader'

export type RouteModuleLoader = () => Promise<unknown>

/** Warm exact route data during idle time and start its code chunks on strong navigation intent. */
export function prefetchRouteIntent(path: string, moduleLoaders: readonly RouteModuleLoader[] = []): void {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return
  prefetchRoutePathResources(path)
  for (const loader of moduleLoaders) {
    void loader().catch(() => undefined)
  }
}
