import type { McpToolInfo } from '../../types'
import type { McpTransport } from './stdio'

export class SseMcpTransport implements McpTransport {
  private requestId = 0
  private abortController: AbortController | null = null
  readonly events: string[] = []

  constructor(
    private readonly config: {
      url: string
      headers?: Record<string, string>
      timeoutMs?: number
    },
  ) {}

  private async request(method: string, params?: unknown): Promise<unknown> {
    const controller = new AbortController()
    const timer =
      this.config.timeoutMs && this.config.timeoutMs > 0
        ? setTimeout(() => controller.abort(), this.config.timeoutMs)
        : undefined
    const response = await fetch(this.config.url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...(this.config.headers ?? {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: ++this.requestId,
        method,
        params,
      }),
    })
    try {
      const payload = await response.json() as {
        result?: unknown
        error?: { message?: string }
      }
      if (payload.error) throw new Error(payload.error.message ?? 'Unknown MCP SSE error')
      return payload.result
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  async subscribe(): Promise<void> {
    this.abortController = new AbortController()
    const response = await fetch(this.config.url, {
      method: 'GET',
      headers: {
        accept: 'text/event-stream',
        ...(this.config.headers ?? {}),
      },
      signal: this.abortController.signal,
    })
    const reader = response.body?.getReader()
    if (!reader) return

    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += Buffer.from(value).toString('utf8')
      let idx = buffer.indexOf('\n\n')
      while (idx !== -1) {
        const rawEvent = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)
        const dataLines = rawEvent
          .split('\n')
          .filter(line => line.startsWith('data:'))
          .map(line => line.slice(5).trim())
        if (dataLines.length > 0) {
          this.events.push(dataLines.join('\n'))
        }
        idx = buffer.indexOf('\n\n')
      }
    }
  }

  async initialize(): Promise<unknown> {
    const result = await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'agent-blueprint', version: '0.1.0' },
    })
    void this.subscribe()
    return result
  }

  async listTools(): Promise<McpToolInfo[]> {
    const result = await this.request('tools/list', {}) as { tools?: McpToolInfo[] }
    return result.tools ?? []
  }

  async callTool(name: string, input: unknown): Promise<unknown> {
    return this.request('tools/call', {
      name,
      arguments: input ?? {},
    })
  }

  async close(): Promise<void> {
    this.abortController?.abort()
  }
}

export async function createSseTransport(config: {
  url: string
  headers?: Record<string, string>
  timeoutMs?: number
}): Promise<McpTransport> {
  return new SseMcpTransport(config)
}
