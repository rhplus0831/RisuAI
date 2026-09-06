<script lang="ts">
  import SelectInput from 'src/lib/UI/GUI/SelectInput.svelte'
  import OptionInput from 'src/lib/UI/GUI/OptionInput.svelte'
  import OptionalInput from 'src/lib/UI/GUI/OptionalInput.svelte'

  import CheckInput from 'src/lib/UI/GUI/CheckInput.svelte'
  import { language } from 'src/lang'
  import { PlusIcon, TrashIcon } from '@lucide/svelte'
  import TextInput from 'src/lib/UI/GUI/TextInput.svelte'
  import Accordion from 'src/lib/UI/Accordion.svelte'
  import ChatFormatSettings from './ChatFormatSettings.svelte'
  import { createServerBackedSettingDraft } from 'src/ts/server/settingsOwner.svelte'
  import { confirmSettingsItemRemoval } from 'src/ts/setting/confirmSettingsItemRemoval'
  const reverseProxyOobaArgsDraft = createServerBackedSettingDraft<Record<string, any>>('reverseProxyOobaArgs', {})
  const localStopStringsDraft = createServerBackedSettingDraft<string[] | null>('localStopStrings', null)

  interface Props {
    instructionMode?: boolean
  }

  let { instructionMode = false }: Props = $props()
</script>

<Accordion name="Ooba Settings" styled>
  {#if instructionMode}
    <ChatFormatSettings />
  {:else}
    <span class="text-textcolor">Ooba Mode</span>
    <SelectInput className="mt-2 mb-4" bind:value={reverseProxyOobaArgsDraft.value.mode}>
      <OptionInput value="instruct">Instruct</OptionInput>
      <OptionInput value="chat">Chat</OptionInput>
      <OptionInput value="chat-instruct">Chat-Instruct</OptionInput>
    </SelectInput>
    <!-- name1 = user | name2 = bot --->

    {#if reverseProxyOobaArgsDraft.value.mode === 'instruct'}
      <span class="text-textcolor">user prefix</span>
      <OptionalInput
        label="user prefix"
        marginBottom={true}
        bind:value={reverseProxyOobaArgsDraft.value.name1_instruct} />
      <span class="text-textcolor">bot prefix</span>
      <OptionalInput
        label="bot prefix"
        marginBottom={true}
        bind:value={reverseProxyOobaArgsDraft.value.name2_instruct} />
      <span class="text-textcolor">system prefix</span>
      <OptionalInput
        label="system prefix"
        marginBottom={true}
        bind:value={reverseProxyOobaArgsDraft.value.context_instruct} />
      <span class="text-textcolor">system message</span>
      <OptionalInput
        label="system message"
        marginBottom={true}
        bind:value={reverseProxyOobaArgsDraft.value.system_message} />
    {/if}
    {#if reverseProxyOobaArgsDraft.value.mode === 'chat' || reverseProxyOobaArgsDraft.value.mode === 'chat-instruct'}
      <span class="text-textcolor">user prefix</span>
      <OptionalInput label="user prefix" marginBottom={true} bind:value={reverseProxyOobaArgsDraft.value.name1} />
      <span class="text-textcolor">bot prefix</span>
      <OptionalInput label="bot prefix" marginBottom={true} bind:value={reverseProxyOobaArgsDraft.value.name2} />
      <span class="text-textcolor">system prefix</span>
      <OptionalInput label="system prefix" marginBottom={true} bind:value={reverseProxyOobaArgsDraft.value.context} />
      <span class="text-textcolor">start message</span>
      <OptionalInput label="start message" marginBottom={true} bind:value={reverseProxyOobaArgsDraft.value.greeting} />
    {/if}
    {#if reverseProxyOobaArgsDraft.value.mode === 'chat-instruct'}
      <span class="text-textcolor">chat_instruct_command</span>
      <OptionalInput
        label="chat_instruct_command"
        marginBottom={true}
        bind:value={reverseProxyOobaArgsDraft.value.chat_instruct_command} />
    {/if}
  {/if}
  <span class="text-textcolor">tokenizer</span>
  <OptionalInput label="tokenizer" marginBottom={true} bind:value={reverseProxyOobaArgsDraft.value.tokenizer} />
  <span class="text-textcolor">min_p</span>
  <OptionalInput label="min_p" marginBottom={true} bind:value={reverseProxyOobaArgsDraft.value.min_p} numberMode />
  <span class="text-textcolor">top_k</span>
  <OptionalInput label="top_k" marginBottom={true} bind:value={reverseProxyOobaArgsDraft.value.top_k} numberMode />
  <span class="text-textcolor">repetition_penalty</span>
  <OptionalInput
    label="repetition_penalty"
    marginBottom={true}
    bind:value={reverseProxyOobaArgsDraft.value.repetition_penalty}
    numberMode />
  <span class="text-textcolor">repetition_penalty_range</span>
  <OptionalInput
    label="repetition_penalty_range"
    marginBottom={true}
    bind:value={reverseProxyOobaArgsDraft.value.repetition_penalty_range}
    numberMode />
  <span class="text-textcolor">typical_p</span>
  <OptionalInput
    label="typical_p"
    marginBottom={true}
    bind:value={reverseProxyOobaArgsDraft.value.typical_p}
    numberMode />
  <span class="text-textcolor">tfs</span>
  <OptionalInput label="tfs" marginBottom={true} bind:value={reverseProxyOobaArgsDraft.value.tfs} numberMode />
  <span class="text-textcolor">top_a</span>
  <OptionalInput label="top_a" marginBottom={true} bind:value={reverseProxyOobaArgsDraft.value.top_a} numberMode />
  <span class="text-textcolor">epsilon_cutoff</span>
  <OptionalInput
    label="epsilon_cutoff"
    marginBottom={true}
    bind:value={reverseProxyOobaArgsDraft.value.epsilon_cutoff}
    numberMode />
  <span class="text-textcolor">eta_cutoff</span>
  <OptionalInput
    label="eta_cutoff"
    marginBottom={true}
    bind:value={reverseProxyOobaArgsDraft.value.eta_cutoff}
    numberMode />
  <span class="text-textcolor">guidance_scale</span>
  <OptionalInput
    label="guidance_scale"
    marginBottom={true}
    bind:value={reverseProxyOobaArgsDraft.value.guidance_scale}
    numberMode />
  <span class="text-textcolor">penalty_alpha</span>
  <OptionalInput
    label="penalty_alpha"
    marginBottom={true}
    bind:value={reverseProxyOobaArgsDraft.value.penalty_alpha}
    numberMode />
  <span class="text-textcolor">mirostat_mode</span>
  <OptionalInput
    label="mirostat_mode"
    marginBottom={true}
    bind:value={reverseProxyOobaArgsDraft.value.mirostat_mode}
    numberMode />
  <span class="text-textcolor">mirostat_tau</span>
  <OptionalInput
    label="mirostat_tau"
    marginBottom={true}
    bind:value={reverseProxyOobaArgsDraft.value.mirostat_tau}
    numberMode />
  <span class="text-textcolor">mirostat_eta</span>
  <OptionalInput
    label="mirostat_eta"
    marginBottom={true}
    bind:value={reverseProxyOobaArgsDraft.value.mirostat_eta}
    numberMode />
  <span class="text-textcolor">encoder_repetition_penalty</span>
  <OptionalInput
    label="encoder_repetition_penalty"
    marginBottom={true}
    bind:value={reverseProxyOobaArgsDraft.value.encoder_repetition_penalty}
    numberMode />
  <span class="text-textcolor">no_repeat_ngram_size</span>
  <OptionalInput
    label="no_repeat_ngram_size"
    marginBottom={true}
    bind:value={reverseProxyOobaArgsDraft.value.no_repeat_ngram_size}
    numberMode />
  <span class="text-textcolor">min_length</span>
  <OptionalInput
    label="min_length"
    marginBottom={true}
    bind:value={reverseProxyOobaArgsDraft.value.min_length}
    numberMode />
  <span class="text-textcolor">num_beams</span>
  <OptionalInput
    label="num_beams"
    marginBottom={true}
    bind:value={reverseProxyOobaArgsDraft.value.num_beams}
    numberMode />
  <span class="text-textcolor">length_penalty</span>
  <OptionalInput
    label="length_penalty"
    marginBottom={true}
    bind:value={reverseProxyOobaArgsDraft.value.length_penalty}
    numberMode />
  <span class="text-textcolor">truncation_length</span>
  <OptionalInput
    label="truncation_length"
    marginBottom={true}
    bind:value={reverseProxyOobaArgsDraft.value.truncation_length}
    numberMode />
  <span class="text-textcolor">max_tokens_second</span>
  <OptionalInput
    label="max_tokens_second"
    marginBottom={true}
    bind:value={reverseProxyOobaArgsDraft.value.max_tokens_second}
    numberMode />
  <span class="text-textcolor">negative_prompt</span>
  <OptionalInput
    label="negative_prompt"
    marginBottom={true}
    bind:value={reverseProxyOobaArgsDraft.value.negative_prompt} />
  <span class="text-textcolor">custom_token_bans</span>
  <OptionalInput
    label="custom_token_bans"
    marginBottom={true}
    bind:value={reverseProxyOobaArgsDraft.value.custom_token_bans} />
  <span class="text-textcolor">grammar_string</span>
  <OptionalInput
    label="grammar_string"
    marginBottom={true}
    bind:value={reverseProxyOobaArgsDraft.value.grammar_string} />

  <span class="text-textcolor">temperature_last</span>
  <OptionalInput
    label="temperature_last"
    marginBottom={true}
    bind:value={reverseProxyOobaArgsDraft.value.temperature_last}
    boolMode />
  <span class="text-textcolor">do_sample</span>
  <OptionalInput
    label="do_sample"
    marginBottom={true}
    bind:value={reverseProxyOobaArgsDraft.value.do_sample}
    boolMode />
  <span class="text-textcolor">early_stopping</span>
  <OptionalInput
    label="early_stopping"
    marginBottom={true}
    bind:value={reverseProxyOobaArgsDraft.value.early_stopping}
    boolMode />
  <span class="text-textcolor">auto_max_new_tokens</span>
  <OptionalInput
    label="auto_max_new_tokens"
    marginBottom={true}
    bind:value={reverseProxyOobaArgsDraft.value.auto_max_new_tokens}
    boolMode />

  <span class="text-textcolor">ban_eos_token</span>
  <OptionalInput
    label="ban_eos_token"
    marginBottom={true}
    bind:value={reverseProxyOobaArgsDraft.value.ban_eos_token}
    boolMode />
  <span class="text-textcolor">add_bos_token</span>
  <OptionalInput
    label="add_bos_token"
    marginBottom={true}
    bind:value={reverseProxyOobaArgsDraft.value.add_bos_token}
    boolMode />
  <span class="text-textcolor">skip_special_tokens</span>
  <OptionalInput
    label="skip_special_tokens"
    marginBottom={true}
    bind:value={reverseProxyOobaArgsDraft.value.skip_special_tokens}
    boolMode />

  {#if instructionMode}
    <div class="flex items-center mt-4">
      <CheckInput
        check={!!localStopStringsDraft.value}
        name={language.customStopWords}
        onChange={() => {
          if (!localStopStringsDraft.value) {
            localStopStringsDraft.value = []
          } else {
            localStopStringsDraft.value = null
          }
        }} />
    </div>
    {#if localStopStringsDraft.value}
      <div class="flex flex-col p-2 rounded-sm border border-selected mt-2 gap-1">
        <div class="p-2">
          <button
            type="button"
            aria-label={`${language.add}: ${language.customStopWords}`}
            class="font-medium flex justify-center items-center h-full cursor-pointer hover:text-green-500 w-full"
            onclick={() => {
              const localStopStrings = localStopStringsDraft.value ?? []
              localStopStrings.push('')
              localStopStringsDraft.value = localStopStrings
            }}><PlusIcon /></button>
        </div>
        {#each localStopStringsDraft.value as stopString, i}
          <div class="flex w-full">
            <div class="grow">
              <TextInput marginBottom bind:value={localStopStringsDraft.value[i]} fullwidth fullh />
            </div>
            <div>
              <button
                type="button"
                aria-label={`${language.remove}: ${language.customStopWords} ${i + 1}`}
                class="font-medium flex justify-center items-center h-full cursor-pointer hover:text-green-500 w-full"
                onclick={() => {
                  if (!confirmSettingsItemRemoval()) return
                  const localStopStrings = localStopStringsDraft.value ?? []
                  localStopStrings.splice(i, 1)
                  localStopStringsDraft.value = localStopStrings
                }}><TrashIcon /></button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</Accordion>
