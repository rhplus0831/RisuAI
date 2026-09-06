<script lang="ts">
  import { ExternalLinkIcon, GitForkIcon, GithubIcon } from '@lucide/svelte'
  import { language } from 'src/lang'

  const repositoryGroups = $derived([
    {
      heading: language.sourceCodeOriginalTitle,
      repositories: [
        {
          name: language.sourceCodeOriginalName,
          description: language.sourceCodeOriginalDescription,
          url: 'https://github.com/kwaroran/RisuAI',
          icon: GithubIcon,
        },
      ],
    },
    {
      heading: '',
      repositories: [
        {
          name: language.sourceCodeForkName,
          description: language.sourceCodeForkDescription,
          url: 'https://github.com/rhplus0831/risuai-fastify',
          icon: GitForkIcon,
        },
      ],
    },
    {
      heading: language.sourceCodeFeatureReferenceTitle,
      repositories: [
        {
          name: language.sourceCodePocketRisuName,
          description: 'https://github.com/PocketRisu/PocketRisu',
          url: 'https://github.com/PocketRisu/PocketRisu',
          icon: GithubIcon,
        },
        {
          name: language.sourceCodeRisuBardName,
          description: 'https://github.com/rpaddict/RisuBard',
          url: 'https://github.com/rpaddict/RisuBard',
          icon: GithubIcon,
        },
      ],
    },
  ])
</script>

<div class="flex w-full max-w-2xl flex-col gap-3" data-risu-source-code>
  <div class="mb-1">
    <h2 class="text-2xl font-bold">{language.sourceCodeTitle}</h2>
    <p class="mt-1 text-sm text-textcolor2">{language.sourceCodeDescription}</p>
  </div>

  {#each repositoryGroups as group, index}
    {#if index > 0}
      <hr class="my-2 border-selected" />
    {/if}
    {#if group.heading}
      <h3 class="text-lg font-semibold">{group.heading}</h3>
    {/if}
    {#each group.repositories as repository}
      <a
        href={repository.url}
        target="_blank"
        rel="nofollow noopener noreferrer"
        class="group flex min-h-20 items-center gap-4 rounded-lg border border-selected p-4 transition-colors hover:bg-selected/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-500"
        aria-label={language.openSourceCodeRepository(repository.name)}>
        <repository.icon aria-hidden="true" class="h-7 w-7 shrink-0 text-textcolor2" />
        <span class="min-w-0 grow">
          <span class="block font-semibold text-textcolor">{repository.name}</span>
          <span class="mt-0.5 block break-words text-sm text-textcolor2">{repository.description}</span>
        </span>
        <ExternalLinkIcon aria-hidden="true" class="h-5 w-5 shrink-0 text-textcolor2 group-hover:text-textcolor" />
      </a>
    {/each}
  {/each}
</div>
