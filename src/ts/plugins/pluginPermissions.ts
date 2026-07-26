import localforage from 'localforage'
import { language } from 'src/lang'
import { alertConfirm } from 'src/ts/alert'
import { hasher } from 'src/ts/parser/parser.svelte'
import { getDatabase } from 'src/ts/storage/database.svelte'

export type PluginPermission =
  | 'fetchLogs'
  | 'db'
  | 'mainDom'
  | 'network'
  | 'pluginUpdate'
  | 'replacer'
  | 'provider'
  | 'sendChat'
  | 'v3Runtime'
export type PluginPermissionReconfirmation = boolean | 'periodically'

export interface PluginPermissionContext {
  updateURL?: string
}

const grantedPluginPermissions = new Set<string>()
const deniedPluginPermissions = new Set<string>()
const pendingPluginPermissions = new Map<string, Promise<boolean>>()
const permissionForage = localforage.createInstance({
  name: 'plugin_permissions',
  storeName: 'plugin_permissions',
})

function pluginUpdatePermissionScope(context?: PluginPermissionContext): string | null {
  if (typeof context?.updateURL !== 'string') return null
  try {
    const url = new URL(context.updateURL)
    if (url.protocol !== 'https:' || url.username || url.password) return null
    return url.toString()
  } catch {
    return null
  }
}

function permissionPrompt(
  pluginName: string,
  permission: PluginPermission,
  context?: PluginPermissionContext,
): string | null {
  switch (permission) {
    case 'fetchLogs':
      return language.fetchLogConsent.replace('{}', pluginName)
    case 'db':
      return language.getFullDatabaseConsent.replace('{}', pluginName)
    case 'mainDom':
      return language.mainDomAccessConsent.replace('{}', pluginName)
    case 'network':
      return language.pluginNetworkConsent.replace('{}', pluginName)
    case 'pluginUpdate': {
      const updateURL = pluginUpdatePermissionScope(context)
      if (!updateURL) return null
      return language.pluginUpdateSourceConsent.replace('{{plugin}}', pluginName).replace('{{url}}', updateURL)
    }
    case 'replacer':
      return language.replacerPermissionConsent.replace('{}', pluginName)
    case 'provider':
      return language.providerPermissionConsent.replace('{}', pluginName)
    case 'sendChat':
      return language.sendChatConsent.replace('{}', pluginName)
    case 'v3Runtime':
      return language.v3RuntimeConsent.replace('{}', pluginName)
  }
}

/**
 * Requests a capability for one exact installed plugin script. Passing the
 * runtime script avoids granting an older, still-running instance based on a
 * newer database record with the same plugin name.
 */
export async function getPluginPermission(
  pluginName: string,
  permission: PluginPermission,
  reconfirm: PluginPermissionReconfirmation = false,
  runtimeScript?: string,
  assertActive?: () => void,
  context?: PluginPermissionContext,
): Promise<boolean> {
  const installedScript = getDatabase().plugins.find((plugin) => plugin.name === pluginName)?.script
  const script = runtimeScript ?? installedScript
  if (typeof script !== 'string') return false
  const validateFreshRuntime = (): boolean => {
    const installed = getDatabase().plugins.some((plugin) => plugin.name === pluginName && plugin.script === script)
    if (!installed) return false
    assertActive?.()
    return true
  }
  if (!validateFreshRuntime()) return false

  const scriptHash = await hasher(new TextEncoder().encode(script))
  if (!scriptHash || !validateFreshRuntime()) return false

  const permissionScope = permission === 'pluginUpdate' ? pluginUpdatePermissionScope(context) : undefined
  if (permission === 'pluginUpdate' && !permissionScope) return false

  const permissionKey = permissionScope
    ? `${pluginName}\u0000${scriptHash}\u0000${permission}\u0000${permissionScope}`
    : `${pluginName}\u0000${scriptHash}\u0000${permission}`
  const persistedGrantKey = `plugin_permission:${JSON.stringify(
    permissionScope ? [pluginName, scriptHash, permission, permissionScope] : [pluginName, scriptHash, permission],
  )}`
  const periodicGrantKey = `${persistedGrantKey}_lastGrantTime`
  let requiresReconfirm = false

  if (reconfirm === 'periodically') {
    const lastGrantTime = await permissionForage.getItem<number>(periodicGrantKey)
    if (!validateFreshRuntime()) return false
    const now = Date.now()
    if (!lastGrantTime || now - lastGrantTime > 3 * 24 * 60 * 60 * 1000) {
      requiresReconfirm = true
    }
  } else if (reconfirm === true) {
    requiresReconfirm = true
  }

  if (!requiresReconfirm && grantedPluginPermissions.has(permissionKey)) {
    if (!validateFreshRuntime()) return false
    return true
  }
  if (deniedPluginPermissions.has(permissionKey)) {
    if (!validateFreshRuntime()) return false
    return false
  }

  const requestDecision = async (): Promise<boolean> => {
    const persisted = !requiresReconfirm && (await permissionForage.getItem(persistedGrantKey))
    if (!validateFreshRuntime()) return false
    if (persisted) {
      grantedPluginPermissions.add(permissionKey)
      return true
    }

    const prompt = permissionPrompt(pluginName, permission, context)
    if (!prompt) return false

    const confirmed = await alertConfirm(prompt)
    if (confirmed) {
      // A plugin may be unloaded or superseded while its modal is open. Never
      // persist that stale runtime's decision.
      if (!validateFreshRuntime()) return false
      deniedPluginPermissions.delete(permissionKey)
      await permissionForage.setItem(persistedGrantKey, true)
      if (!validateFreshRuntime()) {
        await permissionForage.removeItem(persistedGrantKey)
        return false
      }
      if (reconfirm === 'periodically') {
        await permissionForage.setItem(periodicGrantKey, Date.now())
        if (!validateFreshRuntime()) {
          await Promise.all([
            permissionForage.removeItem(persistedGrantKey),
            permissionForage.removeItem(periodicGrantKey),
          ])
          return false
        }
      }
      grantedPluginPermissions.add(permissionKey)
      return true
    }

    grantedPluginPermissions.delete(permissionKey)
    deniedPluginPermissions.add(permissionKey)
    return false
  }

  const pendingKey = `${permissionKey}\u0000${String(reconfirm)}`
  const existing = pendingPluginPermissions.get(pendingKey)
  if (existing) {
    const result = await existing
    if (!validateFreshRuntime()) return false
    return result
  }

  const pending = requestDecision()
  pendingPluginPermissions.set(pendingKey, pending)
  try {
    const result = await pending
    if (!validateFreshRuntime()) return false
    return result
  } finally {
    if (pendingPluginPermissions.get(pendingKey) === pending) {
      pendingPluginPermissions.delete(pendingKey)
    }
  }
}

export function clearInMemoryPluginPermissions(): void {
  grantedPluginPermissions.clear()
  deniedPluginPermissions.clear()
  pendingPluginPermissions.clear()
}
