<script lang="ts">
  import {
    MASKED_MODEL_PROFILE_SECRET,
    createModelProfileSecretDraft,
    type ModelProfileSecretDraft,
  } from 'src/ts/model/modelProfileSecrets'
  import SecretField from './SecretField.svelte'

  let value = $state(createModelProfileSecretDraft(MASKED_MODEL_PROFILE_SECRET))

  export function currentValue(): ModelProfileSecretDraft {
    return value
  }
</script>

<SecretField label="API key" placeholder="Saved secret" bind:value />
