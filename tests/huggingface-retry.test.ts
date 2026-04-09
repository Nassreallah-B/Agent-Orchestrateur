import test from 'node:test'
import assert from 'node:assert/strict'
import { createHuggingFaceInvoker } from '../src/llm/huggingface'

test('huggingface invoker retries transient failures', async () => {
  const originalFetch = globalThis.fetch
  let calls = 0

  globalThis.fetch = (async () => {
    calls += 1
    if (calls === 1) {
      return new Response('rate limited', { status: 429 })
    }
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: 'OK',
            },
          },
        ],
      }),
      {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      },
    )
  }) as typeof fetch

  try {
    const invoke = createHuggingFaceInvoker({
      apiKey: 'test',
      baseUrl: 'https://router.huggingface.co/v1',
      model: 'Qwen/Qwen3.5-397B-A17B',
      maxRetries: 1,
      retryBaseDelayMs: 1,
      retryMaxDelayMs: 5,
      requestsPerMinute: 1_000,
      concurrency: 2,
      timeoutMs: 5_000,
      maxTokens: 128,
      temperature: 0.1,
      topP: 1,
      topK: 20,
      enableThinking: false,
    })

    const result = await invoke({
      model: 'Qwen/Qwen3.5-397B-A17B',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'say ok' }] }],
      tools: [],
    })

    assert.equal(result.text, 'OK')
    assert.equal(calls, 2)
  } finally {
    globalThis.fetch = originalFetch
  }
})
