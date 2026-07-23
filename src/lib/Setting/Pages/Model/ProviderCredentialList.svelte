<script lang="ts">
  import { PencilIcon, PlusIcon, SaveIcon, TrashIcon, XIcon } from '@lucide/svelte'
  import { language } from 'src/lang'
  import Button from 'src/lib/UI/GUI/Button.svelte'
  import TextInput from 'src/lib/UI/GUI/TextInput.svelte'
  import {
    beginPendingModelMutation,
    createProviderCredentialDurably,
    deleteProviderCredentialDurably,
    finishPendingModelMutation,
    getPendingModelMutations,
    isPendingModelMutationProjectionApplied,
    providerCredentialProjectionFingerprint,
    retainPendingModelMutation,
    subscribePendingModelMutations,
    updateProviderCredentialDurably,
  } from 'src/ts/model/modelProfileMutations'
  import {
    createModelProfileSecretDraft,
    modelProfileSecretValueForSave,
    type ModelProfileSecretDraft,
  } from 'src/ts/model/modelProfileSecrets'
  import type { ProviderCredentialRecord, ProviderCredentialType } from 'src/ts/model/providerCredentialRecords'
  import type { ProviderCredentialSnapshot, ServerCommandResult } from 'src/ts/server/commands'
  import { getDatabase } from 'src/ts/storage/database.svelte'
  import SecretField from './SecretField.svelte'

  interface Props {
    initialCreateType?: ProviderCredentialType | null
  }

  let { initialCreateType = null }: Props = $props()

  let editingId = $state<string | null>(null)
  let editingBaseline = $state<ProviderCredentialRecord | null>(null)
  let creating = $state(false)
  let credentialType = $state<ProviderCredentialType>('apiKey')
  let name = $state('')
  let apiKeyDraft = $state<ModelProfileSecretDraft>(createModelProfileSecretDraft(undefined))
  let clientEmail = $state('')
  let privateKeyDraft = $state<ModelProfileSecretDraft>(createModelProfileSecretDraft(undefined))
  let busy = $state(false)
  let commandError = $state('')
  let pendingMutations = $state(getPendingModelMutations('provider-credentials'))
  let initialCreateHandled = $state(false)

  let credentials = $derived(getDatabase().providerCredentials ?? [])
  let profiles = $derived(getDatabase().modelProfiles ?? [])
  let mutationPending = $derived(pendingMutations.length > 0)
  let editorOpen = $derived(creating || editingId !== null)
  let secretReady = $derived(
    credentialType === 'apiKey'
      ? modelProfileSecretValueForSave(apiKeyDraft) !== undefined
      : clientEmail.trim() !== '' && modelProfileSecretValueForSave(privateKeyDraft) !== undefined,
  )
  let canSave = $derived(!busy && !mutationPending && name.trim() !== '' && secretReady)

  $effect(() => {
    return subscribePendingModelMutations('provider-credentials', (pending) => {
      pendingMutations = pending
    })
  })

  $effect(() => {
    for (const pending of pendingMutations) {
      if (pending.phase === 'discarded') {
        commandError = language.modelProfiles.commandReplayDiscarded
        finishPendingModelMutation(pending.token)
        continue
      }
      if (pending.phase === 'dispatching') continue
      if (
        isPendingModelMutationProjectionApplied(pending.projection, {
          providerCredentials: credentials,
        })
      ) {
        finishPendingModelMutation(pending.token)
      }
    }
  })

  $effect(() => {
    if (!initialCreateHandled && initialCreateType && !editorOpen) {
      initialCreateHandled = true
      openCreate(initialCreateType)
    }
  })

  function openCreate(type: ProviderCredentialType): void {
    if (busy || mutationPending) return
    creating = true
    editingId = null
    editingBaseline = null
    credentialType = type
    name =
      type === 'apiKey' ? language.modelProfiles.newApiCredentialName : language.modelProfiles.newVertexCredentialName
    apiKeyDraft = createModelProfileSecretDraft(undefined)
    clientEmail = ''
    privateKeyDraft = createModelProfileSecretDraft(undefined)
    commandError = ''
  }

  function openEdit(credential: ProviderCredentialRecord): void {
    if (busy || mutationPending) return
    creating = false
    editingId = credential.id
    editingBaseline = cloneJsonValue(credential)
    credentialType = credential.type
    name = credential.name
    apiKeyDraft = createModelProfileSecretDraft(credential.apiKey)
    clientEmail = credential.vertex?.clientEmail ?? ''
    privateKeyDraft = createModelProfileSecretDraft(credential.vertex?.privateKey)
    commandError = ''
  }

  function closeEditor(): void {
    creating = false
    editingId = null
    editingBaseline = null
  }

  function credentialForSave(): ProviderCredentialSnapshot | null {
    const trimmedName = name.trim()
    if (!trimmedName) return null
    if (credentialType === 'apiKey') {
      const apiKey = modelProfileSecretValueForSave(apiKeyDraft)
      return apiKey ? { name: trimmedName, type: 'apiKey', apiKey } : null
    }

    const privateKey = modelProfileSecretValueForSave(privateKeyDraft)
    const trimmedEmail = clientEmail.trim()
    return privateKey && trimmedEmail
      ? {
          name: trimmedName,
          type: 'vertexServiceAccount',
          vertex: { clientEmail: trimmedEmail, privateKey },
        }
      : null
  }

  async function saveCredential(): Promise<void> {
    const credential = credentialForSave()
    if (!credential || !canSave) return
    busy = true
    commandError = ''
    const pendingToken = beginPendingModelMutation(
      'provider-credentials',
      creating
        ? {
            kind: 'credential-create',
            baselineIds: credentials.map((candidate) => candidate.id),
            attemptedFingerprint: providerCredentialProjectionFingerprint(credential, true),
          }
        : {
            kind: 'credential-update',
            credentialId: editingId ?? '',
            attemptedFingerprint: providerCredentialProjectionFingerprint({ ...credential, id: editingId ?? '' }),
          },
    )
    if (!pendingToken) {
      busy = false
      return
    }

    try {
      const outcome = creating
        ? await createProviderCredentialDurably(credential)
        : await updateProviderCredentialDurably(editingId ?? '', credential, editingBaseline ?? credential)
      if (outcome.status === 'accepted') {
        finishPendingModelMutation(pendingToken)
        closeEditor()
      } else if (outcome.status === 'queued') {
        retainPendingModelMutation(pendingToken, outcome.mutationId)
        closeEditor()
      } else {
        finishPendingModelMutation(pendingToken)
        commandError = commandErrorMessage(outcome.result)
      }
    } catch {
      finishPendingModelMutation(pendingToken)
      commandError = language.modelProfiles.commandUnavailable
    } finally {
      busy = false
    }
  }

  function referencingProfiles(credentialId: string): ProviderCredentialReference[] {
    return profiles
      .filter((profile) => profile.providerOptions?.credentialId === credentialId)
      .map((profile) => ({ id: profile.id, name: profile.name }))
  }

  async function deleteCredential(credential: ProviderCredentialRecord): Promise<void> {
    if (busy || mutationPending) return
    const references = referencingProfiles(credential.id)
    if (references.length > 0) {
      commandError = language.modelProfiles.credentialInUse(
        references.map((profile) => `${profile.name} (${profile.id})`).join(', '),
      )
      return
    }
    if (!window.confirm(language.modelProfiles.deleteCredentialConfirm(credential.name))) return

    busy = true
    commandError = ''
    const pendingToken = beginPendingModelMutation('provider-credentials', {
      kind: 'credential-delete',
      credentialId: credential.id,
    })
    if (!pendingToken) {
      busy = false
      return
    }
    try {
      const outcome = await deleteProviderCredentialDurably(credential.id)
      if (outcome.status === 'accepted') {
        finishPendingModelMutation(pendingToken)
      } else if (outcome.status === 'queued') {
        retainPendingModelMutation(pendingToken, outcome.mutationId)
      } else {
        finishPendingModelMutation(pendingToken)
        commandError = commandErrorMessage(outcome.result)
      }
    } catch {
      finishPendingModelMutation(pendingToken)
      commandError = language.modelProfiles.commandUnavailable
    } finally {
      busy = false
    }
  }

  function commandErrorMessage(result: Exclude<ServerCommandResult, { status: 'ok' }>): string {
    return result.status === 'conflict'
      ? language.modelProfiles.commandConflict
      : result.status === 'error'
        ? result.error
        : language.modelProfiles.commandUnavailable
  }

  function cloneJsonValue<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
  }

  interface ProviderCredentialReference {
    id: string
    name: string
  }
</script>

<section class="flex flex-col gap-4">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <div>
      <h3 class="text-lg font-semibold">{language.modelProfiles.credentialsTabTitle}</h3>
      <p class="text-sm text-textcolor2">{language.modelProfiles.credentialsTabDescription}</p>
    </div>
    <div class="flex flex-wrap gap-2">
      <Button size="sm" disabled={busy || mutationPending} onclick={() => openCreate('apiKey')}>
        <span class="inline-flex items-center gap-1"
          ><PlusIcon size={14} />{language.modelProfiles.createApiCredential}</span>
      </Button>
      <Button
        size="sm"
        styled="outlined"
        disabled={busy || mutationPending}
        onclick={() => openCreate('vertexServiceAccount')}>
        <span class="inline-flex items-center gap-1"
          ><PlusIcon size={14} />{language.modelProfiles.createVertexCredential}</span>
      </Button>
    </div>
  </div>

  {#if commandError}
    <div class="rounded-md border border-draculared p-3 text-sm text-draculared">{commandError}</div>
  {/if}

  {#if editorOpen}
    <div class="flex flex-col gap-3 rounded-md border border-darkborderc p-3" data-provider-credential-editor>
      <div class="flex items-center justify-between gap-2">
        <h4 class="font-semibold">
          {creating ? language.modelProfiles.createCredential : language.modelProfiles.editCredential}
        </h4>
        <button type="button" aria-label={language.modelProfiles.cancel} disabled={busy} onclick={closeEditor}>
          <XIcon size={18} />
        </button>
      </div>
      <label class="flex flex-col gap-1">
        <span class="text-sm text-textcolor2">{language.modelProfiles.credentialName}</span>
        <TextInput size="sm" fullwidth bind:value={name} />
      </label>
      {#if credentialType === 'apiKey'}
        <SecretField
          label={language.modelProfiles.apiKeyLabel}
          bind:value={apiKeyDraft}
          placeholder={language.modelProfiles.savedSecretPlaceholder} />
      {:else}
        <label class="flex flex-col gap-1">
          <span class="text-sm text-textcolor2">{language.modelProfiles.vertexClientEmail}</span>
          <TextInput size="sm" fullwidth bind:value={clientEmail} />
        </label>
        <SecretField
          label={language.modelProfiles.vertexPrivateKey}
          bind:value={privateKeyDraft}
          placeholder={language.modelProfiles.savedSecretPlaceholder} />
      {/if}
      <div class="flex justify-end gap-2">
        <Button size="sm" styled="outlined" disabled={busy} onclick={closeEditor}>
          <span class="inline-flex items-center gap-1"><XIcon size={14} />{language.modelProfiles.cancel}</span>
        </Button>
        <Button size="sm" disabled={!canSave} onclick={saveCredential}>
          <span class="inline-flex items-center gap-1"><SaveIcon size={14} />{language.modelProfiles.save}</span>
        </Button>
      </div>
    </div>
  {/if}

  {#if credentials.length === 0}
    <div class="rounded-md border border-darkborderc p-4 text-sm text-textcolor2">
      {language.modelProfiles.noCredentials}
    </div>
  {:else}
    <div class="overflow-x-auto rounded-md border border-darkborderc">
      <table class="w-full min-w-[36rem] text-sm">
        <thead class="bg-darkbg text-left text-xs uppercase text-textcolor2">
          <tr>
            <th class="px-3 py-2 font-medium">{language.modelProfiles.credentialName}</th>
            <th class="px-3 py-2 font-medium">{language.modelProfiles.credentialType}</th>
            <th class="px-3 py-2 font-medium">{language.modelProfiles.usedByColumn}</th>
            <th class="px-3 py-2 font-medium">{language.modelProfiles.actionsColumn}</th>
          </tr>
        </thead>
        <tbody>
          {#each credentials as credential (credential.id)}
            {@const references = referencingProfiles(credential.id)}
            <tr class="border-t border-darkborderc align-top">
              <td class="px-3 py-3">
                <span class="block font-medium">{credential.name}</span>
                <span class="block text-xs text-textcolor2">{credential.id}</span>
              </td>
              <td class="px-3 py-3">
                {credential.type === 'apiKey'
                  ? language.modelProfiles.apiKeyCredentialType
                  : language.modelProfiles.vertexCredentialType}
              </td>
              <td class="px-3 py-3 text-textcolor2">
                {references.length === 0
                  ? language.modelProfiles.notUsedByProfiles
                  : references.map((profile) => profile.name).join(', ')}
              </td>
              <td class="px-3 py-3">
                <div class="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    styled="outlined"
                    disabled={busy || mutationPending}
                    onclick={() => openEdit(credential)}>
                    <span class="inline-flex items-center gap-1"
                      ><PencilIcon size={14} />{language.modelProfiles.edit}</span>
                  </Button>
                  <Button
                    size="sm"
                    styled="danger"
                    disabled={busy || mutationPending || references.length > 0}
                    onclick={() => deleteCredential(credential)}>
                    <span
                      class="inline-flex items-center gap-1"
                      title={references.length > 0 ? language.modelProfiles.credentialInUseShort : ''}
                      ><TrashIcon size={14} />{language.modelProfiles.delete}</span>
                  </Button>
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>
