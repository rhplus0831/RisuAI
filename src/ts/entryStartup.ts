export async function startApplicationAfterEnvironment<T>(
  installEnvironment: () => Promise<void>,
  loadApplication: () => Promise<{ startApplication: () => T }>,
): Promise<T> {
  await installEnvironment()
  const { startApplication } = await loadApplication()
  return startApplication()
}
