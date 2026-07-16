<script lang="ts">
  interface Props {
    message?: string
  }

  let { message = '' }: Props = $props()
</script>

<div data-testid="bookmark-chat-preview">{message}</div>
