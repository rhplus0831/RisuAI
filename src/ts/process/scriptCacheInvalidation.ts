let resetScriptCaches: () => void = () => undefined

export function registerScriptCacheResetter(resetter: () => void): () => void {
  resetScriptCaches = resetter
  return () => {
    if (resetScriptCaches === resetter) resetScriptCaches = () => undefined
  }
}

export function resetRegisteredScriptCaches(): void {
  resetScriptCaches()
}
