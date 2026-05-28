// EC2 fixture: the server bridge does not expose pluginV2. `pluginV2` is not in
// allowedDbKeys, and unsupportedServerBridgeKeys blocks it regardless.
export const allowedDbKeys = ['characters', 'botPresets', 'customBackground']
export const unsupportedServerBridgeKeys = ['pluginV2']
