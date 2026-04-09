import type { McpToolInfo } from '../../types'
import type { McpTransport } from './stdio'

export class WsMcpTransport implements McpTransport {
  private requestId = 0
  private readonly socket: WebSocket
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void
      reject: (reason?: unknown) => void
      timer?: NodeJS.Timeout
    }
  >()

  constructor(private readonly config: { url: string; timeoutMs?: number }) {
    this.socket = new WebSocket(config.url)
    this.socket.addEventListener('message', event => {
      const payload = JSON.parse(String(event.data)) as {
        id?: number
        result?: unknown
        error?: { message?: string }
      }
      if (typeof payload.id !== 'number') return
      const pending = this.pending.get(payload.id)
      if (!pending) return
      if (payload.error) {
        pending.reject(new Error(payload.error.message ?? 'Unknown MCP WS error'))
      } else {
        pending.resolve(payload.result)
      }
      if (pending.timer) clearTimeout(pending.timer)
      this.pending.delete(payload.id)
    })
  }

  private async ensureOpen(): Promise<void> {
    if (this.socket.readyState === WebSocket.OPEN) return
    if (this.socket.readyState === WebSocket.CONNECTING) {
      await new Promise<void>((resolve, reject) => {
        const onOpen = () => {
          this.socket.removeEventListener('open', onOpen)
          this.socket.removeEventListener('error', onError)
          resolve()
        }
        const onError = (event: Event) => {
          this.socket.removeEventListener('open', onOpen)
          this.socket.removeEventListener('error', onError)
          reject(event)
        }
        this.socket.addEventListener('open', onOpen)
        this.socket.addEventListener('error', onError)
      })
      return
    }
    throw new Error('WebSocket transport is not open')
  }

  private async request(method: string, params?: unknown): Promise<unknown> {
    await this.ensureOpen()
    const id = ++this.requestId
    return new Promise((resolve, reject) => {
      const timer =
        this.config.timeoutMs && this.config.timeoutMs > 0
          ? setTimeout(() => {
              this.pending.delete(id)
              reject(new Error(`MCP WebSocket request timed out after ${this.config.timeoutMs}ms`))
            }, this.config.timeoutMs)
          : undefined
      this.pending.set(id, { resolve, reject, timer })
      this.socket.send(
        JSON.stringify({
          jsonrpc: '2.0',
          id,
          method,
          params,
        }),
      )
    })
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

  async close(): Promise<void> {
    this.socket.close()
  }
}

export async function createWsTransport(config: {
  url: string
  timeoutMs?: number
}): Promise<McpTransport> {
  return new WsMcpTransport(config)
}
