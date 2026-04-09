import test from 'node:test'
import assert from 'node:assert/strict'
import { createTempDir, createMockWorkbench, removeDir } from './helpers'

test('session save/load restores event history and MCP profiles', async () => {
  const firstDir = await createTempDir('agent-blueprint-session-a-')
  const secondDir = await createTempDir('agent-blueprint-session-b-')
  const first = createMockWorkbench(firstDir)
  const second = createMockWorkbench(secondDir)

  try {
    first.runtime.events.emitEvent('custom.test.event', { ok: true })
    await first.upsertMcpProfile({
      name: 'local',
      description: 'Local profile',
      connections: [
        {
          name: 'demo',
          config: {
            transport: 'http',
            url: 'https://example.com',
          },
        },
      ],
    })
    await first.saveSession(firstDir)

    const loaded = await second.loadSession(firstDir)
    assert.equal(loaded, true)
    assert.equal(second.listMcpProfiles().length, 1)
    assert.equal(second.listMcpProfiles()[0].name, 'local')
    assert.equal(
      second.getRecentEvents(20).some(event => event.type === 'custom.test.event'),
      true,
    )
  } finally {
    await first.shutdown()
    await second.shutdown()
    await removeDir(firstDir)
    await removeDir(secondDir)
  }
})
