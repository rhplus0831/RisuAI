<script lang="ts">
  import { selectedCharID } from 'src/ts/stores.svelte'
  import TextInput from '../UI/GUI/TextInput.svelte'
  import NumberInput from '../UI/GUI/NumberInput.svelte'
  import Button from '../UI/GUI/Button.svelte'
  import { getRequestLog } from 'src/ts/globalApi.svelte'
  import { alertError, alertMd, beginAlertWait, clearAlertWait } from 'src/ts/alert'
  import Accordion from '../UI/Accordion.svelte'
  import { getCharToken, getChatToken } from 'src/ts/tokenizer'
  import { tokenizePreset } from 'src/ts/process/prompt'

  import { getDatabase, type Chat } from 'src/ts/storage/database.svelte'
  import TextAreaInput from '../UI/GUI/TextAreaInput.svelte'
  import { HardDriveUploadIcon, PlusIcon, TrashIcon } from '@lucide/svelte'
  import { selectSingleFile } from 'src/ts/filePicker'
  import { previewFormated, previewBody, sendChat } from 'src/ts/process/index.svelte'
  import SelectInput from '../UI/GUI/SelectInput.svelte'
  import { applyChatTemplate, chatTemplates } from 'src/ts/process/templates/chatTemplate'
  import OptionInput from '../UI/GUI/OptionInput.svelte'
  import { loadLoreBookV3Prompt } from 'src/ts/process/lorebook.svelte'
  import { getModules } from 'src/ts/process/modules'
  import {
    appendCurrentChatUserMessageForSend,
    captureActiveChatTarget,
    isActiveChatTargetFresh,
    setChatScriptstateValue,
  } from 'src/ts/chatCommands'
  import CheckInput from '../UI/GUI/CheckInput.svelte'
  import { language } from 'src/lang'
  import { parseDevToolAutopilotImport } from './devToolAutopilotImport'
  import { findChatGenerationActivity } from 'src/ts/process/generationActivity.svelte'
  import { coordinateAcceptedChatSend } from 'src/ts/process/acceptedSendCoordinator.svelte'
  import { canUseGenerationOperationProtocol } from 'src/ts/server/generationOperations'

  let previewMode = $state('chat')
  let previewJoin = $state('yes')
  let instructType = $state('chatml')
  let instructCustom = $state('')

  const preview = async () => {
    const target = captureActiveChatTarget()
    if (!target || findChatGenerationActivity(target)) return false
    const waitOwner = beginAlertWait('Loading...')
    let generated = false
    try {
      generated = await sendChat(-1, {
        preview: previewJoin !== 'prompt',
        previewPrompt: previewJoin === 'prompt',
        expectedTarget: target,
      })
    } finally {
      clearAlertWait(waitOwner)
    }
    if (!generated || !isActiveChatTargetFresh(target)) return false

    let md = ''
    const styledRole = {
      function: '📐 Function',
      user: '😐 User',
      system: '⚙️ System',
      assistant: '✨ Assistant',
    }

    if (previewJoin === 'prompt') {
      md += '### Prompt\n'
      md += '```json\n' + JSON.stringify(JSON.parse(previewBody), null, 2).replaceAll('```', '\\`\\`\\`') + '\n```\n'
      alertMd(md)
      return
    }

    let formated = safeStructuredClone(previewFormated)

    if (previewJoin === 'yes') {
      let newFormated = []
      let latestRole = ''

      for (let i = 0; i < formated.length; i++) {
        if (formated[i].role === latestRole) {
          newFormated[newFormated.length - 1].content += '\n' + formated[i].content
        } else {
          newFormated.push(formated[i])
          latestRole = formated[i].role
        }
      }

      formated = newFormated
    }

    if (previewMode === 'instruct') {
      const instructed = applyChatTemplate(formated, {
        type: instructType,
        custom: instructCustom,
      })

      md += '### Instruction\n'
      md += '```\n' + instructed.replaceAll('```', '\\`\\`\\`') + '\n```\n'
      alertMd(md)
      return
    }

    for (let i = 0; i < formated.length; i++) {
      md += '### ' + (styledRole[formated[i].role] ?? '🤔 Unknown role') + '\n'
      const modals = formated[i].multimodals

      if (modals && modals.length > 0) {
        md += `> ${modals.length} non-text content(s) included\n`
      }

      if (formated[i].thoughts && formated[i].thoughts.length > 0) {
        md += `> ${formated[i].thoughts.length} thought(s) included\n`
      }

      if (formated[i].cachePoint) {
        md += `> Cache point\n`
      }

      md += '```\n' + formated[i].content.replaceAll('```', '\\`\\`\\`') + '\n```\n'
    }
    alertMd(md)
  }

  let autopilot = $state([])

  function currentDevToolChat(): Chat | undefined {
    const character = getDatabase().characters?.[$selectedCharID]
    return character?.chats?.[character.chatPage]
  }

  function currentScriptstateEntries(): Array<[string, unknown]> {
    return Object.entries(currentDevToolChat()?.scriptstate ?? {})
  }

  function commitScriptstateValue(key: string, value: unknown): void {
    setChatScriptstateValue(currentDevToolChat()?.id, key, value)
  }
</script>

<Accordion styled name={'Variables'}>
  <div class="rounded-md border border-darkborderc grid grid-cols-2 gap-2 p-2">
    {#if currentScriptstateEntries().length > 0}
      {#each currentScriptstateEntries() as [key, value] (key)}
        <span>{key}</span>
        {#if typeof value === 'object'}
          <div class="p-2 text-center">Object</div>
        {:else if typeof value === 'string'}
          <TextInput {value} onchange={(event) => commitScriptstateValue(key, event.currentTarget.value)} />
        {:else if typeof value === 'number'}
          <NumberInput {value} onChange={(event) => commitScriptstateValue(key, event.currentTarget.valueAsNumber)} />
        {:else if typeof value === 'boolean'}
          <CheckInput
            check={value}
            hiddenName
            name={key}
            onChange={(checked) => commitScriptstateValue(key, checked)} />
        {/if}
      {/each}
    {:else}
      <div class="p-2 text-center">No variables</div>
    {/if}
  </div>
</Accordion>

<Accordion styled name={'Tokens'}>
  <div class="rounded-md border border-darkborderc grid grid-cols-2 gap-2 p-2">
    {#await getCharToken(getDatabase().characters[$selectedCharID])}
      <span>Character Persistant</span>
      <div class="p-2 text-center">Loading...</div>
      <span>Character Dynamic</span>
      <div class="p-2 text-center">Loading...</div>
    {:then token}
      <span>Character Persistant</span>
      <div class="p-2 text-center">{token.persistant} Tokens</div>
      <span>Character Dynamic</span>
      <div class="p-2 text-center">{token.dynamic} Tokens</div>
    {/await}
    {#await getChatToken(getDatabase().characters[$selectedCharID].chats[getDatabase().characters[$selectedCharID].chatPage])}
      <span>Current Chat</span>
      <div class="p-2 text-center">Loading...</div>
    {:then token}
      <span>Current Chat</span>
      <div class="p-2 text-center">{token} Tokens</div>
    {/await}
    {#if getDatabase().promptTemplate}
      {#await tokenizePreset(getDatabase().promptTemplate)}
        <span>Prompt Template</span>
        <div class="p-2 text-center">Loading...</div>
      {:then token}
        <span>Prompt Template</span>
        <div class="p-2 text-center">{token} Tokens</div>
      {/await}
    {/if}
  </div>
  <span class="text-sm text-textcolor2">This is a estimate. The actual token count may be different.</span>
</Accordion>

<Accordion styled name={'Autopilot'}>
  <div class="flex flex-col p-2 border border-darkborderc rounded-md">
    {#each autopilot as text, i}
      <TextAreaInput bind:value={autopilot[i]} />
    {/each}
  </div>
  <div class="flex justify-end">
    <button
      class="text-textcolor2 hover:text-textcolor"
      aria-label={`${language.remove}: Autopilot`}
      onclick={() => {
        autopilot.pop()
        autopilot = autopilot
      }}>
      <TrashIcon />
    </button>

    <button
      class="text-textcolor2 hover:text-textcolor"
      aria-label={`${language.add}: Autopilot`}
      onclick={() => {
        autopilot.push('')
        autopilot = autopilot
      }}>
      <PlusIcon />
    </button>

    <button
      class="text-textcolor2 hover:text-textcolor"
      aria-label={`${language.import}: Autopilot`}
      onclick={async () => {
        try {
          const selected = await selectSingleFile(['txt', 'csv', 'json'])
          if (!selected) return
          const imported = parseDevToolAutopilotImport(selected.name, selected.data)
          if (!imported) {
            alertError(language.errors.noData)
            return
          }
          autopilot = imported
        } catch {
          alertError(language.errors.noData)
        }
      }}>
      <HardDriveUploadIcon />
    </button>
  </div>
  <Button
    className="mt-2"
    onclick={async () => {
      const activeTarget = captureActiveChatTarget()
      if (!activeTarget || findChatGenerationActivity(activeTarget)) return
      for (let i = 0; i < autopilot.length; i++) {
        if (findChatGenerationActivity(activeTarget) || !isActiveChatTargetFresh(activeTarget)) {
          return
        }
        const outcome = canUseGenerationOperationProtocol()
          ? await coordinateAcceptedChatSend({ target: activeTarget, message: autopilot[i] })
          : await (async () => {
              const appended = await appendCurrentChatUserMessageForSend(autopilot[i], {
                expectedTarget: activeTarget,
              })
              if (appended.status === 'error') {
                alertError(appended.error)
                return { status: 'append_failed' as const }
              }
              return coordinateAcceptedChatSend({ target: activeTarget, append: appended })
            })()
        if (outcome.status !== 'generated') return
        if (!isActiveChatTargetFresh(activeTarget)) {
          return
        }
      }
    }}>Run</Button>
</Accordion>

<Accordion styled name={'Preview Prompt'}>
  <span>Type</span>
  <SelectInput bind:value={previewMode}>
    <OptionInput value="chat">Chat</OptionInput>
    <OptionInput value="instruct">Instruct</OptionInput>
  </SelectInput>
  {#if previewMode === 'instruct'}
    <span>Instruction Type</span>
    <SelectInput bind:value={instructType}>
      {#each Object.keys(chatTemplates) as template}
        <OptionInput value={template}>{template}</OptionInput>
      {/each}
      <OptionInput value="jinja">Custom Jinja</OptionInput>
    </SelectInput>
    {#if instructType === 'jinja'}
      <span>Custom Jinja</span>
      <TextAreaInput bind:value={instructCustom} />
    {/if}
  {/if}
  <span>Join</span>
  <SelectInput bind:value={previewJoin}>
    <OptionInput value="yes">With Join</OptionInput>
    <OptionInput value="no">Without Join</OptionInput>
    <OptionInput value="prompt">As Request</OptionInput>
  </SelectInput>
  <Button
    className="mt-2"
    onclick={() => {
      preview()
    }}>Run</Button>
</Accordion>

<Accordion styled name={'Preview Lorebook'}>
  <Button
    className="mt-2"
    onclick={async () => {
      const lorebookResult = await loadLoreBookV3Prompt()
      const html = `
        ${lorebookResult.actives
          .map((v) => {
            return `## ${v.source}\n\n\`\`\`\n${v.prompt}\n\`\`\`\n`
          })
          .join('\n')}
        `.trim()
      alertMd(html)
    }}>Test Lore</Button>
  <Button
    className="mt-2"
    onclick={async () => {
      const lorebookResult = await loadLoreBookV3Prompt()
      const html = `
        <table>
            <thead>
                <tr>
                    <th>Key</th>
                    <th>Source</th>
                </tr>
            </thead>
            <tbody>
                ${lorebookResult.matchLog
                  .map((v) => {
                    return `<tr>
                        <td><pre>${v.activated.trim()}</pre></td>
                        <td><pre>${v.source.trim()}</pre></td>
                    </tr>`
                  })
                  .join('\n')}
            </tbody>
        </table>
        `.trim()
      alertMd(html)
    }}>Match Sources</Button>
</Accordion>

<Button
  className="mt-2"
  onclick={() => {
    const modules = getModules()
    const html = `
    ${modules
      .map((v) => {
        return `## ${v.name}\n\n\`\`\`\n${v.description}\n\`\`\`\n`
      })
      .join('\n')}
    `.trim()
    alertMd(html)
  }}>Preview Module</Button>

<Button
  className="mt-2"
  onclick={() => {
    alertMd(getRequestLog())
  }}>Request Log</Button>
