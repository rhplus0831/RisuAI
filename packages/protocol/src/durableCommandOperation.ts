import {
  findProtocolRouteOperationById,
  protocolRouteOperationMatches,
  type ProtocolRouteOperationId,
} from './routeOperation'

export const PROTOCOL_DURABLE_COMMAND_METHODS = ['DELETE', 'PATCH', 'POST', 'PUT'] as const

export type ProtocolDurableCommandMethod = (typeof PROTOCOL_DURABLE_COMMAND_METHODS)[number]

export interface ProtocolDurableCommandOperationDescriptor {
  readonly id: string
  readonly method: ProtocolDurableCommandMethod
  readonly path: RegExp
  readonly examplePath: string
}

/**
 * Stable identifiers for command requests that the browser may retain in its
 * encrypted outbox. This catalog describes client-side retention only; it does
 * not grant authentication, active-writer, persistence, or replay authority.
 * Paths are relative to `/api/v1/commands`.
 */
export const PROTOCOL_DURABLE_COMMAND_OPERATION_CATALOG = [
  {
    id: 'settings-field-patch',
    method: 'PATCH',
    path: /^\/settings\/[a-z][a-z-]*$/,
    examplePath: '/settings/runtime',
  },
  {
    id: 'settings-object-patch',
    method: 'PATCH',
    path: /^\/settings\/[a-z][a-z-]*\/objects\/[^/?#]+$/,
    examplePath: '/settings/runtime/objects/object-a',
  },
  { id: 'character-create', method: 'POST', path: /^\/characters$/, examplePath: '/characters' },
  {
    id: 'character-create-and-select',
    method: 'POST',
    path: /^\/characters\/create-and-select$/,
    examplePath: '/characters/create-and-select',
  },
  {
    id: 'character-alternate-greetings-patch',
    method: 'PATCH',
    path: /^\/characters\/[^/?#]+\/alternate-greetings$/,
    examplePath: '/characters/character-a/alternate-greetings',
  },
  {
    id: 'character-patch',
    method: 'PATCH',
    path: /^\/characters\/[^/?#]+$/,
    examplePath: '/characters/character-a',
  },
  {
    id: 'character-delete',
    method: 'DELETE',
    path: /^\/characters\/[^/?#]+$/,
    examplePath: '/characters/character-a',
  },
  { id: 'character-select', method: 'POST', path: /^\/characters\/select$/, examplePath: '/characters/select' },
  {
    id: 'character-reorder',
    method: 'POST',
    path: /^\/characters\/reorder$/,
    examplePath: '/characters/reorder',
  },
  {
    id: 'character-chat-create',
    method: 'POST',
    path: /^\/characters\/[^/?#]+\/chats$/,
    examplePath: '/characters/character-a/chats',
  },
  {
    id: 'character-chats-replace',
    method: 'PUT',
    path: /^\/characters\/[^/?#]+\/chats$/,
    examplePath: '/characters/character-a/chats',
  },
  {
    id: 'character-chat-reorder',
    method: 'POST',
    path: /^\/characters\/[^/?#]+\/chats\/reorder$/,
    examplePath: '/characters/character-a/chats/reorder',
  },
  {
    id: 'character-chat-folder-create',
    method: 'POST',
    path: /^\/characters\/[^/?#]+\/chat-folders$/,
    examplePath: '/characters/character-a/chat-folders',
  },
  {
    id: 'character-chat-folder-reorder',
    method: 'POST',
    path: /^\/characters\/[^/?#]+\/chat-folders\/reorder$/,
    examplePath: '/characters/character-a/chat-folders/reorder',
  },
  {
    id: 'character-module-reorder',
    method: 'POST',
    path: /^\/characters\/[^/?#]+\/modules\/reorder$/,
    examplePath: '/characters/character-a/modules/reorder',
  },
  { id: 'chat-patch', method: 'PATCH', path: /^\/chats\/[^/?#]+$/, examplePath: '/chats/chat-a' },
  {
    id: 'chat-script-state-patch',
    method: 'PATCH',
    path: /^\/chats\/[^/?#]+\/scriptstate$/,
    examplePath: '/chats/chat-a/scriptstate',
  },
  { id: 'chat-delete', method: 'DELETE', path: /^\/chats\/[^/?#]+$/, examplePath: '/chats/chat-a' },
  {
    id: 'chat-fork',
    method: 'POST',
    path: /^\/chats\/[^/?#]+\/fork$/,
    examplePath: '/chats/chat-a/fork',
  },
  {
    id: 'chat-message-append',
    method: 'POST',
    path: /^\/chats\/[^/?#]+\/messages$/,
    examplePath: '/chats/chat-a/messages',
  },
  {
    id: 'chat-messages-truncate',
    method: 'POST',
    path: /^\/chats\/[^/?#]+\/messages\/truncate$/,
    examplePath: '/chats/chat-a/messages/truncate',
  },
  {
    id: 'chat-messages-tail',
    method: 'POST',
    path: /^\/chats\/[^/?#]+\/messages\/tail$/,
    examplePath: '/chats/chat-a/messages/tail',
  },
  {
    id: 'chat-messages-replace',
    method: 'PUT',
    path: /^\/chats\/[^/?#]+\/messages$/,
    examplePath: '/chats/chat-a/messages',
  },
  {
    id: 'chat-generation-settings-replace',
    method: 'PUT',
    path: /^\/chats\/[^/?#]+\/generation-settings$/,
    examplePath: '/chats/chat-a/generation-settings',
  },
  { id: 'message-patch', method: 'PATCH', path: /^\/messages\/[^/?#]+$/, examplePath: '/messages/message-a' },
  {
    id: 'message-delete',
    method: 'DELETE',
    path: /^\/messages\/[^/?#]+$/,
    examplePath: '/messages/message-a',
  },
  {
    id: 'chat-folder-patch',
    method: 'PATCH',
    path: /^\/chat-folders\/[^/?#]+$/,
    examplePath: '/chat-folders/folder-a',
  },
  {
    id: 'chat-folder-delete',
    method: 'DELETE',
    path: /^\/chat-folders\/[^/?#]+$/,
    examplePath: '/chat-folders/folder-a',
  },
  { id: 'prompt-item-create', method: 'POST', path: /^\/prompt-items$/, examplePath: '/prompt-items' },
  {
    id: 'prompt-item-reorder',
    method: 'POST',
    path: /^\/prompt-items\/reorder$/,
    examplePath: '/prompt-items/reorder',
  },
  {
    id: 'prompt-item-patch',
    method: 'PATCH',
    path: /^\/prompt-items\/[^/?#]+$/,
    examplePath: '/prompt-items/item-a',
  },
  {
    id: 'prompt-item-delete',
    method: 'DELETE',
    path: /^\/prompt-items\/[^/?#]+$/,
    examplePath: '/prompt-items/item-a',
  },
  {
    id: 'prompt-item-enable',
    method: 'POST',
    path: /^\/prompt-items\/enable$/,
    examplePath: '/prompt-items/enable',
  },
  { id: 'persona-patch', method: 'PATCH', path: /^\/personas\/[^/?#]+$/, examplePath: '/personas/persona-a' },
  {
    id: 'persona-delete',
    method: 'DELETE',
    path: /^\/personas\/[^/?#]+$/,
    examplePath: '/personas/persona-a',
  },
  { id: 'persona-create', method: 'POST', path: /^\/personas$/, examplePath: '/personas' },
  { id: 'persona-select', method: 'POST', path: /^\/personas\/select$/, examplePath: '/personas/select' },
  { id: 'persona-reorder', method: 'POST', path: /^\/personas\/reorder$/, examplePath: '/personas/reorder' },
  { id: 'preset-create', method: 'POST', path: /^\/presets$/, examplePath: '/presets' },
  { id: 'preset-patch', method: 'PATCH', path: /^\/presets\/[^/?#]+$/, examplePath: '/presets/preset-a' },
  { id: 'preset-delete', method: 'DELETE', path: /^\/presets\/[^/?#]+$/, examplePath: '/presets/preset-a' },
  {
    id: 'preset-copy',
    method: 'POST',
    path: /^\/presets\/[^/?#]+\/copy$/,
    examplePath: '/presets/preset-a/copy',
  },
  { id: 'preset-select', method: 'POST', path: /^\/presets\/select$/, examplePath: '/presets/select' },
  { id: 'preset-reorder', method: 'POST', path: /^\/presets\/reorder$/, examplePath: '/presets/reorder' },
  { id: 'model-preset-create', method: 'POST', path: /^\/model-presets$/, examplePath: '/model-presets' },
  {
    id: 'model-preset-patch',
    method: 'PATCH',
    path: /^\/model-presets\/[^/?#]+$/,
    examplePath: '/model-presets/model-a',
  },
  {
    id: 'model-preset-delete',
    method: 'DELETE',
    path: /^\/model-presets\/[^/?#]+$/,
    examplePath: '/model-presets/model-a',
  },
  {
    id: 'model-preset-select',
    method: 'POST',
    path: /^\/model-presets\/select$/,
    examplePath: '/model-presets/select',
  },
  {
    id: 'model-preset-reorder',
    method: 'POST',
    path: /^\/model-presets\/reorder$/,
    examplePath: '/model-presets/reorder',
  },
  { id: 'model-profile-create', method: 'POST', path: /^\/model-profiles$/, examplePath: '/model-profiles' },
  {
    id: 'model-profile-patch',
    method: 'PATCH',
    path: /^\/model-profiles\/[^/?#]+$/,
    examplePath: '/model-profiles/profile-a',
  },
  {
    id: 'model-profile-delete',
    method: 'DELETE',
    path: /^\/model-profiles\/[^/?#]+$/,
    examplePath: '/model-profiles/profile-a',
  },
  {
    id: 'model-profile-duplicate',
    method: 'POST',
    path: /^\/model-profiles\/[^/?#]+\/duplicate$/,
    examplePath: '/model-profiles/profile-a/duplicate',
  },
  {
    id: 'model-profile-convert-legacy',
    method: 'POST',
    path: /^\/model-profiles\/convert-legacy$/,
    examplePath: '/model-profiles/convert-legacy',
  },
  {
    id: 'model-profile-reorder',
    method: 'POST',
    path: /^\/model-profiles\/reorder$/,
    examplePath: '/model-profiles/reorder',
  },
  {
    id: 'provider-credential-create',
    method: 'POST',
    path: /^\/provider-credentials$/,
    examplePath: '/provider-credentials',
  },
  {
    id: 'provider-credential-patch',
    method: 'PATCH',
    path: /^\/provider-credentials\/[^/?#]+$/,
    examplePath: '/provider-credentials/credential-a',
  },
  {
    id: 'provider-credential-delete',
    method: 'DELETE',
    path: /^\/provider-credentials\/[^/?#]+$/,
    examplePath: '/provider-credentials/credential-a',
  },
  {
    id: 'model-role-profiles-replace',
    method: 'PUT',
    path: /^\/model-role-profiles$/,
    examplePath: '/model-role-profiles',
  },
  {
    id: 'model-runtime-defaults-replace',
    method: 'PUT',
    path: /^\/model-runtime-defaults$/,
    examplePath: '/model-runtime-defaults',
  },
  { id: 'agent-preset-create', method: 'POST', path: /^\/agent-presets$/, examplePath: '/agent-presets' },
  { id: 'agent-create', method: 'POST', path: /^\/agents$/, examplePath: '/agents' },
  {
    id: 'agent-patch',
    method: 'PATCH',
    path: /^\/agents\/(?!reorder$)[^/?#]+$/,
    examplePath: '/agents/agent-a',
  },
  {
    id: 'agent-delete',
    method: 'DELETE',
    path: /^\/agents\/(?!reorder$)[^/?#]+$/,
    examplePath: '/agents/agent-a',
  },
  {
    id: 'agent-duplicate',
    method: 'POST',
    path: /^\/agents\/[^/?#]+\/duplicate$/,
    examplePath: '/agents/agent-a/duplicate',
  },
  { id: 'agent-reorder', method: 'POST', path: /^\/agents\/reorder$/, examplePath: '/agents/reorder' },
  {
    id: 'agent-preset-patch',
    method: 'PATCH',
    path: /^\/agent-presets\/[^/?#]+$/,
    examplePath: '/agent-presets/preset-a',
  },
  {
    id: 'agent-preset-delete',
    method: 'DELETE',
    path: /^\/agent-presets\/[^/?#]+$/,
    examplePath: '/agent-presets/preset-a',
  },
  {
    id: 'agent-preset-duplicate',
    method: 'POST',
    path: /^\/agent-presets\/[^/?#]+\/duplicate$/,
    examplePath: '/agent-presets/preset-a/duplicate',
  },
  {
    id: 'agent-preset-reorder',
    method: 'POST',
    path: /^\/agent-presets\/reorder$/,
    examplePath: '/agent-presets/reorder',
  },
  {
    id: 'agent-preset-default-create',
    method: 'POST',
    path: /^\/agent-presets\/default$/,
    examplePath: '/agent-presets/default',
  },
  {
    id: 'agent-preset-use-create',
    method: 'POST',
    path: /^\/agent-presets\/[^/?#]+\/uses$/,
    examplePath: '/agent-presets/preset-a/uses',
  },
  {
    id: 'agent-preset-use-patch',
    method: 'PATCH',
    path: /^\/agent-presets\/[^/?#]+\/uses\/(?!reorder$)[^/?#]+$/,
    examplePath: '/agent-presets/preset-a/uses/use-a',
  },
  {
    id: 'agent-preset-use-delete',
    method: 'DELETE',
    path: /^\/agent-presets\/[^/?#]+\/uses\/(?!reorder$)[^/?#]+$/,
    examplePath: '/agent-presets/preset-a/uses/use-a',
  },
  {
    id: 'agent-preset-use-reorder',
    method: 'POST',
    path: /^\/agent-presets\/[^/?#]+\/uses\/reorder$/,
    examplePath: '/agent-presets/preset-a/uses/reorder',
  },
  {
    id: 'agent-preset-step-create',
    method: 'POST',
    path: /^\/agent-presets\/[^/?#]+\/steps$/,
    examplePath: '/agent-presets/preset-a/steps',
  },
  {
    id: 'agent-preset-step-patch',
    method: 'PATCH',
    path: /^\/agent-presets\/[^/?#]+\/steps\/[^/?#]+$/,
    examplePath: '/agent-presets/preset-a/steps/step-a',
  },
  {
    id: 'agent-preset-step-delete',
    method: 'DELETE',
    path: /^\/agent-presets\/[^/?#]+\/steps\/[^/?#]+$/,
    examplePath: '/agent-presets/preset-a/steps/step-a',
  },
  {
    id: 'agent-preset-step-duplicate',
    method: 'POST',
    path: /^\/agent-presets\/[^/?#]+\/steps\/[^/?#]+\/duplicate$/,
    examplePath: '/agent-presets/preset-a/steps/step-a/duplicate',
  },
  {
    id: 'agent-preset-step-reorder',
    method: 'POST',
    path: /^\/agent-presets\/[^/?#]+\/steps\/reorder$/,
    examplePath: '/agent-presets/preset-a/steps/reorder',
  },
  { id: 'prompt-preset-create', method: 'POST', path: /^\/prompt-presets$/, examplePath: '/prompt-presets' },
  {
    id: 'prompt-preset-patch',
    method: 'PATCH',
    path: /^\/prompt-presets\/[^/?#]+$/,
    examplePath: '/prompt-presets/prompt-a',
  },
  {
    id: 'prompt-preset-delete',
    method: 'DELETE',
    path: /^\/prompt-presets\/[^/?#]+$/,
    examplePath: '/prompt-presets/prompt-a',
  },
  {
    id: 'prompt-preset-select',
    method: 'POST',
    path: /^\/prompt-presets\/select$/,
    examplePath: '/prompt-presets/select',
  },
  {
    id: 'prompt-preset-reorder',
    method: 'POST',
    path: /^\/prompt-presets\/reorder$/,
    examplePath: '/prompt-presets/reorder',
  },
  {
    id: 'legacy-bot-preset-extract',
    method: 'POST',
    path: /^\/legacy-bot-presets\/[^/?#]+\/extract$/,
    examplePath: '/legacy-bot-presets/preset-a/extract',
  },
  {
    id: 'translator-preset-create',
    method: 'POST',
    path: /^\/translator-presets$/,
    examplePath: '/translator-presets',
  },
  {
    id: 'translator-preset-patch',
    method: 'PATCH',
    path: /^\/translator-presets\/[^/?#]+$/,
    examplePath: '/translator-presets/translator-a',
  },
  {
    id: 'translator-preset-delete',
    method: 'DELETE',
    path: /^\/translator-presets\/[^/?#]+$/,
    examplePath: '/translator-presets/translator-a',
  },
  {
    id: 'translator-preset-select',
    method: 'POST',
    path: /^\/translator-presets\/select$/,
    examplePath: '/translator-presets/select',
  },
  { id: 'module-create', method: 'POST', path: /^\/modules$/, examplePath: '/modules' },
  { id: 'module-patch', method: 'PATCH', path: /^\/modules\/[^/?#]+$/, examplePath: '/modules/module-a' },
  { id: 'module-delete', method: 'DELETE', path: /^\/modules\/[^/?#]+$/, examplePath: '/modules/module-a' },
  { id: 'module-enable', method: 'POST', path: /^\/modules\/enable$/, examplePath: '/modules/enable' },
  { id: 'module-reorder', method: 'POST', path: /^\/modules\/reorder$/, examplePath: '/modules/reorder' },
  { id: 'plugin-create', method: 'POST', path: /^\/plugins$/, examplePath: '/plugins' },
  { id: 'plugin-patch', method: 'PATCH', path: /^\/plugins\/[^/?#]+$/, examplePath: '/plugins/plugin-a' },
  { id: 'plugin-delete', method: 'DELETE', path: /^\/plugins\/[^/?#]+$/, examplePath: '/plugins/plugin-a' },
  {
    id: 'plugin-enable',
    method: 'POST',
    path: /^\/plugins\/[^/?#]+\/enable$/,
    examplePath: '/plugins/plugin-a/enable',
  },
  { id: 'plugin-provider-set', method: 'POST', path: /^\/plugins\/provider$/, examplePath: '/plugins/provider' },
  { id: 'plugin-reorder', method: 'POST', path: /^\/plugins\/reorder$/, examplePath: '/plugins/reorder' },
  {
    id: 'plugin-storage-replace',
    method: 'PUT',
    path: /^\/plugin-storage\/[^/?#]+$/,
    examplePath: '/plugin-storage/key-a',
  },
  {
    id: 'plugin-storage-delete',
    method: 'DELETE',
    path: /^\/plugin-storage\/[^/?#]+$/,
    examplePath: '/plugin-storage/key-a',
  },
  {
    id: 'plugin-storage-bulk-create',
    method: 'POST',
    path: /^\/plugin-storage\/bulk$/,
    examplePath: '/plugin-storage/bulk',
  },
  { id: 'loadout-create', method: 'POST', path: /^\/loadouts$/, examplePath: '/loadouts' },
  { id: 'loadout-delete', method: 'DELETE', path: /^\/loadouts\/[^/?#]+$/, examplePath: '/loadouts/loadout-a' },
  {
    id: 'loadout-favorite',
    method: 'POST',
    path: /^\/loadouts\/[^/?#]+\/favorite$/,
    examplePath: '/loadouts/loadout-a/favorite',
  },
  {
    id: 'loadout-touch',
    method: 'POST',
    path: /^\/loadouts\/[^/?#]+\/touch$/,
    examplePath: '/loadouts/loadout-a/touch',
  },
  {
    id: 'global-scripts-patch',
    method: 'PATCH',
    path: /^\/settings\/advanced\/global-scripts$/,
    examplePath: '/settings/advanced/global-scripts',
  },
  {
    id: 'resource-script-definitions-replace',
    method: 'PUT',
    path: /^\/(?:characters|modules)\/[^/?#]+\/(?:scripts|triggers)$/,
    examplePath: '/characters/character-a/scripts',
  },
  {
    id: 'resource-script-definitions-patch',
    method: 'PATCH',
    path: /^\/(?:characters|modules)\/[^/?#]+\/(?:scripts|triggers)$/,
    examplePath: '/modules/module-a/triggers',
  },
  { id: 'lorebook-create', method: 'POST', path: /^\/lorebooks$/, examplePath: '/lorebooks' },
  { id: 'lorebook-reorder', method: 'POST', path: /^\/lorebooks\/reorder$/, examplePath: '/lorebooks/reorder' },
  { id: 'lorebook-patch', method: 'PATCH', path: /^\/lorebooks\/[^/?#]+$/, examplePath: '/lorebooks/lorebook-a' },
  {
    id: 'lorebook-delete',
    method: 'DELETE',
    path: /^\/lorebooks\/[^/?#]+$/,
    examplePath: '/lorebooks/lorebook-a',
  },
  {
    id: 'lorebook-select',
    method: 'POST',
    path: /^\/lorebooks\/[^/?#]+\/select$/,
    examplePath: '/lorebooks/lorebook-a/select',
  },
  {
    id: 'lorebook-entries-replace',
    method: 'PUT',
    path: /^\/lorebooks\/[^/?#]+\/entries$/,
    examplePath: '/lorebooks/lorebook-a/entries',
  },
  {
    id: 'lorebook-entry-replace',
    method: 'PUT',
    path: /^\/lorebooks\/[^/?#]+\/entries\/[^/?#]+$/,
    examplePath: '/lorebooks/lorebook-a/entries/entry-a',
  },
  {
    id: 'lorebook-entry-delete',
    method: 'DELETE',
    path: /^\/lorebooks\/[^/?#]+\/entries\/[^/?#]+$/,
    examplePath: '/lorebooks/lorebook-a/entries/entry-a',
  },
  {
    id: 'lorebook-entry-reorder',
    method: 'POST',
    path: /^\/lorebooks\/[^/?#]+\/entries\/reorder$/,
    examplePath: '/lorebooks/lorebook-a/entries/reorder',
  },
  {
    id: 'bardwiki-chat-settings-patch',
    method: 'PATCH',
    path: /^\/bardwiki\/chats\/[^/?#]+\/settings$/,
    examplePath: '/bardwiki/chats/chat-a/settings',
  },
  {
    id: 'bardwiki-chat-document-create',
    method: 'POST',
    path: /^\/bardwiki\/chats\/[^/?#]+\/documents$/,
    examplePath: '/bardwiki/chats/chat-a/documents',
  },
  {
    id: 'bardwiki-chat-document-patch',
    method: 'PATCH',
    path: /^\/bardwiki\/chats\/[^/?#]+\/documents\/[^/?#]+$/,
    examplePath: '/bardwiki/chats/chat-a/documents/document-a',
  },
  {
    id: 'bardwiki-chat-document-delete',
    method: 'DELETE',
    path: /^\/bardwiki\/chats\/[^/?#]+\/documents\/[^/?#]+$/,
    examplePath: '/bardwiki/chats/chat-a/documents/document-a',
  },
  {
    id: 'bardwiki-chat-confirmation-create',
    method: 'POST',
    path: /^\/bardwiki\/chats\/[^/?#]+\/confirmations$/,
    examplePath: '/bardwiki/chats/chat-a/confirmations',
  },
  {
    id: 'resource-lorebook-replace',
    method: 'PUT',
    path: /^\/(?:characters|chats|modules)\/[^/?#]+\/lorebooks$/,
    examplePath: '/characters/character-a/lorebooks',
  },
  {
    id: 'resource-lorebook-entry-replace',
    method: 'PUT',
    path: /^\/(?:characters|chats|modules)\/[^/?#]+\/lorebooks\/entries\/[^/?#]+$/,
    examplePath: '/chats/chat-a/lorebooks/entries/entry-a',
  },
  {
    id: 'resource-lorebook-entry-delete',
    method: 'DELETE',
    path: /^\/(?:characters|chats|modules)\/[^/?#]+\/lorebooks\/entries\/[^/?#]+$/,
    examplePath: '/modules/module-a/lorebooks/entries/entry-a',
  },
  {
    id: 'resource-lorebook-entry-reorder',
    method: 'POST',
    path: /^\/(?:characters|chats|modules)\/[^/?#]+\/lorebooks\/entries\/reorder$/,
    examplePath: '/chats/chat-a/lorebooks/entries/reorder',
  },
] as const satisfies readonly ProtocolDurableCommandOperationDescriptor[]

export type ProtocolDurableCommandOperationId = (typeof PROTOCOL_DURABLE_COMMAND_OPERATION_CATALOG)[number]['id']

export const PROTOCOL_DURABLE_COMMAND_ROUTE_OPERATION_ID = 'commands' satisfies ProtocolRouteOperationId

export const PROTOCOL_DURABLE_GENERATION_OPERATION_CATALOG = {
  'generation-operation-submit': {
    routeOperationId: 'generation-operation-submit',
    method: 'POST',
    path: /^\/generation-operations$/,
  },
  'generation-operation-cancel': {
    routeOperationId: 'generation-operation-cancel',
    method: 'PUT',
    path: /^\/generation-operations\/[^/?#]+\/cancellation$/,
  },
  'generation-operation-retry': {
    routeOperationId: 'generation-operation-retry',
    method: 'POST',
    path: /^\/generation-operations\/[^/?#]+\/retries$/,
  },
} as const satisfies Record<
  string,
  {
    readonly routeOperationId: ProtocolRouteOperationId
    readonly method: ProtocolDurableCommandMethod
    readonly path: RegExp
  }
>

export type ProtocolDurableGenerationIntentKind = keyof typeof PROTOCOL_DURABLE_GENERATION_OPERATION_CATALOG

export function findProtocolDurableCommandOperation(
  method: string,
  path: string,
): ProtocolDurableCommandOperationDescriptor | undefined {
  const normalizedMethod = method.toUpperCase()
  const matches = PROTOCOL_DURABLE_COMMAND_OPERATION_CATALOG.filter(
    (operation) => operation.method === normalizedMethod && operation.path.test(path),
  )
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous durable command operation ${normalizedMethod} ${path}: ${matches.map(({ id }) => id).join(', ')}`,
    )
  }
  return matches[0]
}

export function isProtocolDurableGenerationIntentKind(value: unknown): value is ProtocolDurableGenerationIntentKind {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(PROTOCOL_DURABLE_GENERATION_OPERATION_CATALOG, value)
  )
}

export function protocolDurableGenerationOperationMatches(
  kind: ProtocolDurableGenerationIntentKind,
  method: string,
  path: string,
): boolean {
  const descriptor = PROTOCOL_DURABLE_GENERATION_OPERATION_CATALOG[kind]
  const operation = findProtocolRouteOperationById(descriptor.routeOperationId)
  return (
    descriptor.method === method.toUpperCase() &&
    descriptor.path.test(path) &&
    operation !== undefined &&
    protocolRouteOperationMatches(operation, method, `/api/v1${path}`)
  )
}

export function assertProtocolDurableCommandOperationCatalog(
  catalog: readonly ProtocolDurableCommandOperationDescriptor[],
): void {
  const ids = new Set<string>()
  const matchers = new Set<string>()
  for (const operation of catalog) {
    if (ids.has(operation.id)) throw new Error(`Duplicate durable command operation id: ${operation.id}`)
    ids.add(operation.id)

    const matcher = `${operation.method}:${operation.path.source}/${operation.path.flags}`
    if (matchers.has(matcher)) throw new Error(`Duplicate durable command operation matcher: ${matcher}`)
    matchers.add(matcher)

    if (!operation.path.source.startsWith('^') || !operation.path.source.endsWith('$') || operation.path.flags !== '') {
      throw new Error(`Durable command operation ${operation.id} must use an anchored, flag-free matcher`)
    }
    if (!operation.path.test(operation.examplePath)) {
      throw new Error(`Durable command operation ${operation.id} does not match its example path`)
    }
  }

  for (const operation of catalog) {
    const matches = catalog.filter(
      (candidate) => candidate.method === operation.method && candidate.path.test(operation.examplePath),
    )
    if (matches.length !== 1 || matches[0]?.id !== operation.id) {
      throw new Error(
        `Ambiguous durable command operation example ${operation.method} ${operation.examplePath}: ${matches
          .map(({ id }) => id)
          .join(', ')}`,
      )
    }
  }
}

assertProtocolDurableCommandOperationCatalog(PROTOCOL_DURABLE_COMMAND_OPERATION_CATALOG)
