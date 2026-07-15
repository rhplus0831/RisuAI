<script lang="ts">
  import { language } from 'src/lang'
  import TextAreaInput from '../UI/GUI/TextAreaInput.svelte'
  import Button from '../UI/GUI/Button.svelte'
  import { type MCPToolWithURL, callMCPToolFrom, getMCPMeta, getMCPTools, initializeMCPs } from 'src/ts/process/mcp/mcp'
  import { alertError, alertMd } from 'src/ts/alert'

  let metadatas = $state('')
  let tools: MCPToolWithURL[] = $state([])
  let toolInputs: { [key: string]: string } = $state({})
  let pendingTools: { [key: string]: boolean } = $state({})
  let refreshing = $state(false)

  async function refresh(): Promise<void> {
    if (refreshing) return
    refreshing = true
    try {
      await initializeMCPs()
      const [nextMetadata, nextTools] = await Promise.all([getMCPMeta(), getMCPTools()])
      metadatas = JSON.stringify(nextMetadata, null, 4)
      tools = nextTools
    } catch (error) {
      alertError(error instanceof Error ? error.message : String(error))
    } finally {
      refreshing = false
    }
  }

  function toolKey(tool: MCPToolWithURL): string {
    return JSON.stringify([tool.mcpURL, tool.name])
  }

  async function executeTool(tool: MCPToolWithURL): Promise<void> {
    const key = toolKey(tool)
    if (pendingTools[key]) return
    pendingTools[key] = true
    try {
      const input = toolInputs[key]?.trim()
      const args = input ? JSON.parse(input) : {}
      const response = await callMCPToolFrom(tool.mcpURL, tool.name, args)
      await alertMd(`Tool ${tool.name} executed\n\nResponse:\n\`\`\`json\n${JSON.stringify(response, null, 2)}\n\`\`\``)
    } catch (error) {
      alertError(error instanceof Error ? error.message : String(error))
    } finally {
      pendingTools[key] = false
    }
  }
</script>

<h2 class="text-4xl text-textcolor my-6 font-black relative">MCP</h2>

<span class="text-textcolor text-lg">Metadatas</span>
<TextAreaInput value={metadatas} ariaLabel={language.playground.mcpMetadata} />

<span class="text-textcolor text-lg">Tools</span>
<div class="flex flex-col gap-2">
  {#each tools as tool (toolKey(tool))}
    <div class="border border-gray-300 p-2 rounded-md">
      <h3 class="text-lg font-bold">{tool.name}</h3>
      <p class="text-sm break-all">{tool.mcpURL}</p>
      <p>{tool.description}</p>
      <div class="prose prose-gray w-full">
        <pre class="overflow-x-auto w-full">{JSON.stringify(tool.inputSchema, null, 2)}</pre>
      </div>
      <TextAreaInput
        bind:value={toolInputs[toolKey(tool)]}
        placeholder={language.playground.mcpToolInput(tool.name, tool.mcpURL)}
        ariaLabel={language.playground.mcpToolInput(tool.name, tool.mcpURL)} />
      <Button disabled={pendingTools[toolKey(tool)] ?? false} onclick={() => executeTool(tool)}>
        <span aria-hidden="true">Execute {tool.name}</span>
        <span class="sr-only">{language.playground.mcpExecuteTool(tool.name, tool.mcpURL)}</span>
      </Button>
    </div>
  {/each}
</div>

<Button disabled={refreshing} onclick={refresh}>Refresh</Button>
