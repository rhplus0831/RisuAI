import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const configPath = path.join(root, 'server/fastify/tsconfig.json')
const config = ts.readConfigFile(configPath, ts.sys.readFile)
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath))
const formatHost: ts.FormatDiagnosticsHost = {
  getCurrentDirectory: () => root,
  getCanonicalFileName: (name) => name,
  getNewLine: () => '\n',
}

describe('generation input concrete contracts', () => {
  it('rejects misspelled fields and values on every participating record', () => {
    const fixtureName = path.join(root, 'server/fastify/src/prompt/__generation_contract_fixture.ts')
    const fixture = `import type {FastifyDatabase, FastifyCharacter, FastifyChat, FastifyMessage, FastifyLoreBook, FastifyCustomScript, FastifyMessagePresetInfo, ResolvedGenerationSettings} from './serverTypes.js';
      import {runLuaEditTrigger, type ServerLuaEditTriggerContext} from './luaRuntime.js';
      import type {PromptMessage} from './promptMessage.js';
      import {validateGenerationSettings,validateFastifyDatabase,validateGenerationPreflightInputs,validateProviderGenerationSettings,validateMemoryGenerationSettings} from './generationInputValidators.js';
      declare let raw:unknown;
      if (validateGenerationSettings(raw)) {
        raw.temperature = 50;
        // @ts-expect-error generated declaration retains concrete settings values
        raw.temperature = 'hot';
      }
      if (validateFastifyDatabase(raw)) {
        // @ts-expect-error generated declaration retains deep configuration immutability
        raw.modules![0].name = 'changed';
      }
      if (validateGenerationPreflightInputs(raw)) {
        // @ts-expect-error preflight declaration cannot invent executable module bodies
        raw.database.modules![0].trigger;
      }
      if (validateProviderGenerationSettings(raw)) {
        // @ts-expect-error provider view contains display names, not transcripts
        raw.characters![0].chats;
      }
      if (validateMemoryGenerationSettings(raw)) {
        // @ts-expect-error memory metadata view contains bindings, not transcripts
        raw.characters![0].chats![0].message;
      }
      declare let editContext: ServerLuaEditTriggerContext;
      declare let database: FastifyDatabase;
      declare let character: FastifyCharacter;
      declare let chat: FastifyChat;
      const editedText:Promise<string> = runLuaEditTrigger(character,'editOutput','literal',undefined,editContext);
      const editedRows:Promise<PromptMessage[]> = runLuaEditTrigger(character,'editRequest',[],undefined,editContext);
      // @ts-expect-error the edit hook may replace a literal with other text
      const falseLiteral:Promise<'literal'> = runLuaEditTrigger(character,'editOutput','literal',undefined,editContext);
      // @ts-expect-error unsupported input channels cannot enter a typed hook
      runLuaEditTrigger(character,'editOutput',42,undefined,editContext);
      declare let message: FastifyMessage;
      declare let lore: FastifyLoreBook;
      declare let script: FastifyCustomScript;
      declare let info: FastifyMessagePresetInfo;
      declare let resolved: ResolvedGenerationSettings;
      // @ts-expect-error resolved scalars are immutable
      resolved.temperature = 10;
      // @ts-expect-error resolved nested settings are immutable
      resolved.modelProfiles![0].runtimeOptions!.maxContext = 100;
      // @ts-expect-error selected collections cannot be mutated by working consumers
      database.modules!.push({id:'new',name:'new',description:''});
      // @ts-expect-error nested selected module fields remain immutable
      database.modules![0].lorebook![0].content = 'mutated';
      database.globalChatVariables = {owned:'value'};
      database.globalChatVariables.owned = 'changed';
      database.temperature = 50;
      chat.generationSettings = {modelPresetId:'model', sidebarToggles:{test:'1'}};
      // @ts-expect-error unknown top-level fields cannot escape the contract
      database.temperatur = 50;
      // @ts-expect-error settings values are concrete
      database.temperature = 'hot';
      // @ts-expect-error nested known settings remain concrete
      database.modelProfiles = [{id:'m',name:'m',runtimeOptions:{temperature:'hot'}}];
      // @ts-expect-error unknown character property
      character.firstMesage = 'x';
      // @ts-expect-error unknown chat property
      chat.generatonSettings = {};
      // @ts-expect-error generation settings are concrete
      chat.generationSettings = {personaId: 42};
      // @ts-expect-error unknown message property
      message.datas = 'x';
      // @ts-expect-error message values are concrete
      message.data = 42;
      // @ts-expect-error unknown lorebook property
      lore.contents = 'x';
      // @ts-expect-error unknown regex property
      script.outputs = 'x';
      // @ts-expect-error unknown message preset property
      info.promptNames = 'x';
    `
    const host = ts.createCompilerHost(parsed.options)
    const originalGetSourceFile = host.getSourceFile.bind(host)
    host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) =>
      name === fixtureName
        ? ts.createSourceFile(name, fixture, languageVersion, true)
        : originalGetSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile)
    const program = ts.createProgram([fixtureName], parsed.options, host)
    const diagnostics = ts.getPreEmitDiagnostics(program)
    expect(ts.formatDiagnostics(diagnostics, formatHost)).toBe('')
  }, 60_000)
})
