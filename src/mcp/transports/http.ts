import type { McpToolInfo } from '../../types'
import type { McpTransport } from './stdio'

export class HttpMcpTransport implements McpTransport {
  private requestId = 0
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
      if (payload.error) {
        throw new Error(payload.error.message ?? 'Unknown MCP HTTP error')
      }
      return payload.result
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  async initialize(): Promise<unknown> {
    const result = await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'agent-blueprint', version: '0.1.0' },
    })
    await this.request('notifications/initialized', {})
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

  async close(): Promise<void> {}
}

export async function createHttpTransport(config: {
  url: string
  headers?: Record<string, string>
  timeoutMs?: number
}): Promise<McpTransport> {
  return new HttpMcpTransport(config)
}
