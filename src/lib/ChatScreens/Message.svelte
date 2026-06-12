<script lang="ts">
  interface Props {
    characterIcon: string
    characterName: string
    characterIconType: 'normal' | 'portrait'

    onCopy: () => void
    onBookmark: () => void
    onRegenerate: () => void
    onDegenerate: () => void
    onRemove: () => void
    onDisableButtonClick: () => void
    onCutButtonClick: () => void
    pagesString: string
    isTranslation: boolean
    isBookmarked: boolean
    isComment: boolean
    isDisabled: boolean
    message: string
  }

  const props: Props = $props()
</script>
