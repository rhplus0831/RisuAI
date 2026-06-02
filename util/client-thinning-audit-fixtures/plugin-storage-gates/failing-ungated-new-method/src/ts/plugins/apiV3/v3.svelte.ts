// EC2 fixture: the Plugin V3 runtime/storage bridge separates Fastify server
// save mode from local save mode and gates device-local storage access.

declare function isDeviceLocalPluginStorageEnabled(): boolean
declare function assertDeviceLocalPluginStorageEnabled(): void

export function buildPluginV3Runtime() {
  return {
    saveMethod: 'server',
    deviceLocalPluginStorage: isDeviceLocalPluginStorageEnabled(),
    getLocalPluginStorage: () => {
      assertDeviceLocalPluginStorageEnabled()
      return null
    },
  }
}
