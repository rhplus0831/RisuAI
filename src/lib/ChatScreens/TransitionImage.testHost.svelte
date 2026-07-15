<script lang="ts">
  import TransitionImage from './TransitionImage.svelte'

  interface Props {
    initialSource: string[] | Promise<string[]>
  }

  let { initialSource }: Props = $props()
  const readInitialSource = () => initialSource
  let source = $state(readInitialSource())

  export function setSource(nextSource: string[] | Promise<string[]>) {
    source = nextSource
  }
</script>

<TransitionImage classType="waifu" src={source} />
