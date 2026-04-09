import test from 'node:test'
import assert from 'node:assert/strict'
import { createMockWorkbench, createTempDir, removeDir } from './helpers'

async function requestJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init)
  const text = await response.text()
  return {
    status: response.status,
    headers: response.headers,
    body: text ? JSON.parse(text) : null,
  }
}

test('remote server enforces auth, body limits, and redacts MCP secrets', async () => {
  const baseDir = await createTempDir('agent-blueprint-remote-')
  const workbench = createMockWorkbench(baseDir)
  const port = 8900 + Math.floor(Math.random() * 500)
  const token = 'super-secret-token'

  try {
    await workbench.upsertMcpProfile({
      name: 'prod',
      description: 'Production',
      connections: [
        {
          name: 'secure-http',
          config: {
            transport: 'http',
            url: 'https://example.com/mcp',
            headers: {
              authorization: 'Bearer top-secret-value',
              'x-api-key': 'abcdef123456',
            },
          },
        },
      ],
    })

    await workbench.startRemote(port, token)

    const unauthorized = await requestJson(`http://localhost:${port}/health`)
    assert.equal(unauthorized.status, 401)

    const profiles = await requestJson(`http://localhost:${port}/mcp/profiles`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
    assert.equal(profiles.status, 200)
    const headers =
      profiles.body.profiles[0].connections[0].config.headers as Record<string, string>
    assert.notEqual(headers.authorization, 'Bearer top-secret-value')
    assert.match(headers.authorization, /\*+/)
    assert.notEqual(headers['x-api-key'], 'abcdef123456')

    const tooLarge = await fetch(`http://localhost:${port}/agents/message`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        to: 'nobody',
        message: 'x'.repeat(2048),
      }),
    })
    assert.equal(tooLarge.status, 413)
  } finally {
    await workbench.stopRemote()
    await workbench.shutdown()
    await removeDir(baseDir)
  }
})
