import type {
  ConversationMessage,
  MessageBlock,
  ModelInvocationInput,
  ModelInvocationOutput,
  ModelInvoker,
} from '../types'
import { ConcurrencyGate, TokenBucketRateLimiter } from '../utils/rateLimit'
import { withRetries } from '../utils/retry'

export type HuggingFaceConfig = {
  apiKey?: string
  baseUrl: string
  model: string
  maxTokens: number
  temperature: number
  topP: number
  topK?: number
  enableThinking: boolean
  timeoutMs: number
  maxRetries: number
  retryBaseDelayMs: number
  retryMaxDelayMs: number
  requestsPerMinute: number
  concurrency: number
}

type OpenAIToolCall = {
  id?: string
  index?: number
  type?: string
  function?: {
    name?: string
    arguments?: string
  }
}

type OpenAIMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | null
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: {
      name: string
      arguments: string
    }
  }>
  tool_call_id?: string
}

type ChatCompletionPayload = {
  choices?: Array<{
    message?: {
      content?: unknown
      reasoning?: unknown
      tool_calls?: OpenAIToolCall[]
    }
  }>
}

type StreamChunkPayload = {
  choices?: Array<{
    delta?: {
      content?: unknown
      reasoning?: unknown
      reasoning_content?: unknown
      tool_calls?: OpenAIToolCall[]
    }
  }>
}

function readEnvBoolean(name: string, fallback: boolean): boolean {
  const value = process.env[name]
  if (value === undefined) return fallback
  return !['0', 'false', 'no', 'off'].includes(value.toLowerCase())
}

function readEnvNumber(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const value = Number(raw)
  return Number.isFinite(value) ? value : fallback
}

export function loadHuggingFaceConfigFromEnv(): HuggingFaceConfig {
  const baseUrl =
    process.env.HF_BASE_URL ??
    process.env.OPENAI_BASE_URL ??
    'https://router.huggingface.co/v1'

  const enableThinking = readEnvBoolean('HF_ENABLE_THINKING', false)

  return {
    apiKey:
      process.env.HF_TOKEN ??
      process.env.HUGGINGFACEHUB_API_TOKEN ??
      process.env.OPENAI_API_KEY,
    baseUrl,
    model: process.env.HF_MODEL ?? 'Qwen/Qwen3.5-397B-A17B',
    maxTokens: readEnvNumber('HF_MAX_TOKENS', 2048),
    temperature: enableThinking
      ? readEnvNumber('HF_TEMPERATURE', 0.6)
      : readEnvNumber('HF_TEMPERATURE', 0.7),
    topP: enableThinking
      ? readEnvNumber('HF_TOP_P', 0.95)
      : readEnvNumber('HF_TOP_P', 0.8),
    topK: readEnvNumber('HF_TOP_K', 20),
    enableThinking,
    timeoutMs: readEnvNumber('HF_TIMEOUT_MS', 120000),
    maxRetries: readEnvNumber('HF_MAX_RETRIES', 2),
    retryBaseDelayMs: readEnvNumber('HF_RETRY_BASE_DELAY_MS', 500),
    retryMaxDelayMs: readEnvNumber('HF_RETRY_MAX_DELAY_MS', 5000),
    requestsPerMinute: readEnvNumber('HF_REQUESTS_PER_MINUTE', 60),
    concurrency: readEnvNumber('HF_MAX_CONCURRENCY', 4),
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
}

function textBlocks(content: MessageBlock[]): string {
  return content
    .filter((block): block is Extract<MessageBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('\n')
}

function toOpenAIMessages(messages: ConversationMessage[]): OpenAIMessage[] {
  const converted: OpenAIMessage[] = []

  for (const message of messages) {
    if (message.role === 'tool') {
      for (const block of message.content) {
        if (block.type !== 'tool_result') continue
        converted.push({
          role: 'tool',
          tool_call_id: block.tool_use_id,
          content: block.content,
        })
      }
      continue
    }

    if (message.role === 'assistant') {
      const content = textBlocks(message.content)
      const toolCalls = message.content
        .filter((block): block is Extract<MessageBlock, { type: 'tool_use' }> => block.type === 'tool_use')
        .map(block => ({
          id: block.id,
          type: 'function' as const,
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input ?? {}),
          },
        }))

      converted.push({
        role: 'assistant',
        content: content || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      })
      continue
    }

    converted.push({
      role: message.role,
      content: textBlocks(message.content),
    })
  }

  return converted
}

function safeJsonParse(value: string | undefined): unknown {
  if (!value) return {}
  try {
    return JSON.parse(value)
  } catch {
    return { raw: value }
  }
}

function normalizeTextContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map(item => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object' && 'text' in item) {
          return String((item as { text?: unknown }).text ?? '')
        }
        return ''
      })
      .join('')
  }
  if (content == null) return ''
  return JSON.stringify(content)
}

function normalizeToolCalls(
  toolCalls: OpenAIToolCall[] | undefined,
): Array<{ id?: string; name: string; input: unknown }> {
  return (toolCalls ?? [])
    .filter(call => call.function?.name)
    .map(call => ({
      id: call.id,
      name: String(call.function?.name),
      input: safeJsonParse(call.function?.arguments),
    }))
}

async function parseJsonCompletionResponse(
  response: Response,
  input: ModelInvocationInput,
): Promise<ModelInvocationOutput> {
  const payload = (await response.json()) as ChatCompletionPayload
  const message = payload.choices?.[0]?.message
  const text = normalizeTextContent(message?.content)
  if (text) {
    input.callbacks?.onTextDelta?.(text)
  }
  const reasoning = normalizeTextContent(message?.reasoning)
  if (reasoning) {
    input.callbacks?.onReasoningDelta?.(reasoning)
  }
  return {
    text,
    toolCalls: normalizeToolCalls(message?.tool_calls),
  }
}

async function parseStreamingCompletionResponse(
  response: Response,
  input: ModelInvocationInput,
): Promise<ModelInvocationOutput> {
  if (!response.body) {
    return parseJsonCompletionResponse(response, input)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  const toolCalls = new Map<number, { id?: string; name?: string; arguments: string }>()

  const processEvent = (rawEvent: string): void => {
    const lines = rawEvent
      .split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trim())

    if (lines.length === 0) return
    const data = lines.join('\n')
    if (!data || data === '[DONE]') return

    const payload = JSON.parse(data) as StreamChunkPayload
    for (const choice of payload.choices ?? []) {
      const delta = choice.delta
      if (!delta) continue

      const textDelta = normalizeTextContent(delta.content)
      if (textDelta) {
        text += textDelta
        input.callbacks?.onTextDelta?.(textDelta)
      }

      const reasoningDelta =
        normalizeTextContent(delta.reasoning) ||
        normalizeTextContent(delta.reasoning_content)
      if (reasoningDelta) {
        input.callbacks?.onReasoningDelta?.(reasoningDelta)
      }

      for (const toolCall of delta.tool_calls ?? []) {
        const index = toolCall.index ?? 0
        const entry = toolCalls.get(index) ?? { arguments: '' }
        if (toolCall.id) entry.id = toolCall.id
        if (toolCall.function?.name) entry.name = toolCall.function.name
        if (toolCall.function?.arguments) {
          entry.arguments += toolCall.function.arguments
        }
        toolCalls.set(index, entry)
      }
    }
  }

  const flushBuffer = (): void => {
    let match = buffer.match(/\r?\n\r?\n/)
    while (match?.index !== undefined) {
      const splitIndex = match.index
      const separatorLength = match[0].length
      const event = buffer.slice(0, splitIndex)
      buffer = buffer.slice(splitIndex + separatorLength)
      processEvent(event)
      match = buffer.match(/\r?\n\r?\n/)
    }
  }

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    flushBuffer()
  }

  buffer += decoder.decode()
  if (buffer.trim()) {
    processEvent(buffer)
  }

  return {
    text,
    toolCalls: Array.from(toolCalls.values())
      .filter(toolCall => toolCall.name)
      .map(toolCall => ({
        id: toolCall.id,
        name: String(toolCall.name),
        input: safeJsonParse(toolCall.arguments),
      })),
  }
}

export function createHuggingFaceInvoker(config?: Partial<HuggingFaceConfig>): ModelInvoker {
  const resolved = {
    ...loadHuggingFaceConfigFromEnv(),
    ...config,
  }
  const baseUrl = normalizeBaseUrl(resolved.baseUrl)
  const limiter = new TokenBucketRateLimiter(resolved.requestsPerMinute)
  const gate = new ConcurrencyGate(Math.max(1, resolved.concurrency))

  return async (input: ModelInvocationInput): Promise<ModelInvocationOutput> => {
    const shouldStream = Boolean(
      input.callbacks?.onTextDelta || input.callbacks?.onReasoningDelta,
    )
    if (!limiter.consume('global')) {
      throw new Error('Hugging Face rate limit exceeded for this runtime')
    }

    return gate.run(() =>
      withRetries(
        {
          label: 'huggingface-chat-completion',
          retries: shouldStream ? 0 : Math.max(0, resolved.maxRetries),
          baseDelayMs: resolved.retryBaseDelayMs,
          maxDelayMs: resolved.retryMaxDelayMs,
          shouldRetry: error => {
            const message = error instanceof Error ? error.message : String(error)
            return /HTTP 408|HTTP 409|HTTP 429|HTTP 5\d\d|timed out|aborted|fetch failed/i.test(message)
          },
        },
        async () => {
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), resolved.timeoutMs)

          try {
            const response = await fetch(`${baseUrl}/chat/completions`, {
              method: 'POST',
              signal: controller.signal,
              headers: {
                'content-type': 'application/json',
                ...(resolved.apiKey ? { authorization: `Bearer ${resolved.apiKey}` } : {}),
              },
              body: JSON.stringify({
                model: input.model || resolved.model,
                messages: toOpenAIMessages(input.messages),
                tools: input.tools.map(tool => ({
                  type: 'function',
                  function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.inputSchema ?? { type: 'object', additionalProperties: true },
                  },
                })),
                ...(input.tools.length > 0 ? { tool_choice: 'auto' } : {}),
                max_tokens: resolved.maxTokens,
                temperature: resolved.temperature,
                top_p: resolved.topP,
                extra_body: {
                  ...(resolved.topK ? { top_k: resolved.topK } : {}),
                  ...(!resolved.enableThinking
                    ? { chat_template_kwargs: { enable_thinking: false } }
                    : {}),
                },
                stream: shouldStream,
              }),
            })

            if (!response.ok) {
              const body = await response.text()
              throw new Error(`Hugging Face request failed with HTTP ${response.status}: ${body}`)
            }

            const contentType = response.headers.get('content-type') ?? ''
            if (shouldStream && contentType.includes('text/event-stream')) {
              return parseStreamingCompletionResponse(response, input)
            }

            return parseJsonCompletionResponse(response, input)
          } finally {
            clearTimeout(timer)
          }
        },
      ),
    )
  }
}
