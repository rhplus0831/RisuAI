import {
  RisuSaveBlockType,
  encodeRisuSaveBlockFixtureEnvelope,
  type RisuSaveEnvelopeKind,
  type RisuSaveBlockFixture,
} from '../../src/risuSave/fixtureHarness.js'

export interface RisuSaveFixtureCase {
  name: string
  description: string
  bytes: Uint8Array
  expectedEnvelope: RisuSaveEnvelopeKind | 'unknown'
  expectedDecodedShape?: unknown
  expectedBlocks?: Array<{
    name: string
    type: RisuSaveBlockType
    unsupportedReference?: 'remote' | 'cache-only'
  }>
  malformed?: boolean
}

const legacyDatabase = {
  version: 1,
  characters: [
    {
      chaId: 'fixture-char',
      name: 'Fixture Character',
      chats: [{ chatId: 'fixture-chat', name: 'First Chat', message: [] }],
    },
  ],
  botPresets: [{ id: 'preset-a', name: 'Preset A' }],
  modules: [],
  loadouts: [],
  plugins: [],
  pluginCustomStorage: {},
}

// Frozen with the pre-Fastify encoder in /home/codex/Risuai at its pinned
// msgpackr 1.10.1 boundary. These bytes must not be regenerated through the
// decoder/codec under test: they are the independent historical vectors.
const legacyFixtureBytes = {
  raw: Buffer.from(
    'AFJJU1VTQVZFAAfeAAendmVyc2lvbgGqY2hhcmFjdGVyc5HeAAOlY2hhSWSsZml4dHVyZS1jaGFypG5hbWWxRml4dHVyZSBDaGFyYWN0ZXKlY2hhdHOR3gADpmNoYXRJZKxmaXh0dXJlLWNoYXSkbmFtZapGaXJzdCBDaGF0p21lc3NhZ2WQqmJvdFByZXNldHOR3gAComlkqHByZXNldC1hpG5hbWWoUHJlc2V0IEGnbW9kdWxlc5CobG9hZG91dHOQp3BsdWdpbnOQs3BsdWdpbkN1c3RvbVN0b3JhZ2XeAAA=',
    'base64',
  ),
  compressed: Buffer.from(
    'AFJJU1VTQVZFAAgfiwgA9MeRagADVYxBCsIwEEWjLrxGL9BDSKHgTvAEsRlroOmUzEQ8RryCqCnFjXifnsUmxYW7/+b/N6NYhzNY0tguhuokrax4wusoVo8Jt+p11Bd2FvJY3ltp4F3Ol6z4zeOSk/OM6V/iJA2ltsRR4WCASNbghwPyzgJBcpc3rfouYS6T089ltgkGlWuAfN+gVOiYfOgaV+uW/GcOhSNGs2e00+dRiC+etBzl2AAAAA==',
    'base64',
  ),
  stream: Buffer.from(
    'AFJJU1VTQVZFAAkfiwgA9MeRagADVYxBCsIwEEWjLrxGL9BDSKHgTvAEsRlroOmUzEQ8RryCqCnFjXifnsUmxYW7/+b/N6NYhzNY0tguhuokrax4wusoVo8Jt+p11Bd2FvJY3ltp4F3Ol6z4zeOSk/OM6V/iJA2ltsRR4WCASNbghwPyzgJBcpc3rfouYS6T089ltgkGlWuAfN+gVOiYfOgaV+uW/GcOhSNGs2e00+dRiC+etBzl2AAAAA==',
    'base64',
  ),
} as const

const blockRoot = {
  version: 1,
  selectedCharID: 0,
  botPresetsId: 0,
  __directory: ['preset', 'modules', 'loadouts', 'plugins', 'pluginStorage', 'fixture-char', 'config'],
}

const blockFixtures: RisuSaveBlockFixture[] = [
  {
    name: 'root',
    type: RisuSaveBlockType.ROOT,
    data: JSON.stringify(blockRoot),
  },
  {
    name: 'preset',
    type: RisuSaveBlockType.BOTPRESET,
    data: JSON.stringify([{ id: 'preset-a', name: 'Preset A' }]),
  },
  {
    name: 'modules',
    type: RisuSaveBlockType.MODULES,
    data: JSON.stringify([{ id: 'module-a', name: 'Module A' }]),
    compression: true,
  },
  {
    name: 'loadouts',
    type: RisuSaveBlockType.LOADOUTS,
    data: JSON.stringify([{ id: 'loadout-a', name: 'Loadout A' }]),
  },
  {
    name: 'plugins',
    type: RisuSaveBlockType.PLUGINS,
    data: JSON.stringify([{ id: 'plugin-a', name: 'Plugin A', version: '3.0' }]),
  },
  {
    name: 'pluginStorage',
    type: RisuSaveBlockType.PLUGIN_STORAGE,
    data: JSON.stringify({ 'plugin-a:key': { enabled: true } }),
  },
  {
    name: 'fixture-char',
    type: RisuSaveBlockType.CHARACTER_WITH_CHAT,
    data: JSON.stringify({
      chaId: 'fixture-char',
      name: 'Fixture Character',
      chats: [{ chatId: 'fixture-chat', name: 'First Chat', message: [] }],
    }),
  },
  {
    name: 'config',
    type: RisuSaveBlockType.CONFIG,
    data: JSON.stringify({ version: 1 }),
  },
]

const unsupportedRemoteBlocks: RisuSaveBlockFixture[] = [
  {
    name: 'root',
    type: RisuSaveBlockType.ROOT,
    data: JSON.stringify({ version: 1, __directory: ['remote-char'] }),
  },
  {
    name: 'remote-char',
    type: RisuSaveBlockType.REMOTE,
    data: JSON.stringify({
      v: 1,
      type: RisuSaveBlockType.CHARACTER_WITH_CHAT,
      name: 'remote-char',
    }),
  },
]

const cacheOnlyBlocks: RisuSaveBlockFixture[] = [
  {
    name: 'root',
    type: RisuSaveBlockType.ROOT,
    data: JSON.stringify({ version: 1, __directory: ['cache-only-char'] }),
  },
]

export const risuSaveFixtureCases: RisuSaveFixtureCase[] = [
  {
    name: 'legacy-raw-basic',
    description: 'Legacy raw msgpack .risu envelope.',
    bytes: legacyFixtureBytes.raw,
    expectedEnvelope: 'legacy-raw',
    expectedDecodedShape: legacyDatabase,
  },
  {
    name: 'legacy-compressed-basic',
    description: 'Legacy fflate-compressed msgpack .risu envelope.',
    bytes: legacyFixtureBytes.compressed,
    expectedEnvelope: 'legacy-compressed',
    expectedDecodedShape: legacyDatabase,
  },
  {
    name: 'legacy-stream-basic',
    description: 'Legacy gzip stream-compressed msgpack .risu envelope.',
    bytes: legacyFixtureBytes.stream,
    expectedEnvelope: 'legacy-stream',
    expectedDecodedShape: legacyDatabase,
  },
  {
    name: 'risusave-blocks-basic',
    description: 'RISUSAVE block envelope with current Phase 9 resource families.',
    bytes: encodeRisuSaveBlockFixtureEnvelope(blockFixtures),
    expectedEnvelope: 'risusave-blocks',
    expectedBlocks: blockFixtures.map((block) => ({ name: block.name, type: block.type })),
  },
  {
    name: 'risusave-remote-reference',
    description: 'RISUSAVE block envelope with a remote block reference that server decode must reject.',
    bytes: encodeRisuSaveBlockFixtureEnvelope(unsupportedRemoteBlocks),
    expectedEnvelope: 'risusave-blocks',
    expectedBlocks: [
      { name: 'root', type: RisuSaveBlockType.ROOT },
      {
        name: 'remote-char',
        type: RisuSaveBlockType.REMOTE,
        unsupportedReference: 'remote',
      },
    ],
  },
  {
    name: 'risusave-cache-only-reference',
    description: 'RISUSAVE directory points to a missing cache-only block.',
    bytes: encodeRisuSaveBlockFixtureEnvelope(cacheOnlyBlocks),
    expectedEnvelope: 'risusave-blocks',
    expectedBlocks: [
      { name: 'root', type: RisuSaveBlockType.ROOT },
      {
        name: 'cache-only-char',
        type: RisuSaveBlockType.REMOTE,
        unsupportedReference: 'cache-only',
      },
    ],
  },
  {
    name: 'malformed-unknown-envelope',
    description: 'Malformed bytes with no supported .risu envelope header.',
    bytes: Uint8Array.from([82, 73, 83, 85, 0, 255, 1, 2, 3]),
    expectedEnvelope: 'unknown',
    malformed: true,
  },
  {
    name: 'malformed-truncated-block',
    description: 'RISUSAVE block envelope with an incomplete block header.',
    bytes: Uint8Array.from([...new TextEncoder().encode('RISUSAVE\0'), 1, 0, 4, 114]),
    expectedEnvelope: 'risusave-blocks',
    malformed: true,
  },
]
