export function createLatestBackgroundLoader(loadBackground: (source: string) => Promise<string>) {
  let latestRun = 0

  return async (source: string): Promise<string | undefined> => {
    const run = ++latestRun
    const background = await loadBackground(source)
    return run === latestRun ? background : undefined
  }
}
