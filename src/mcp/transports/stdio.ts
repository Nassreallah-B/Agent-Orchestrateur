import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import type { McpToolInfo } from '../../types'
import { buildIsolatedExecutionPlan } from '../../security/processIsolation'
import {
  ContentLengthParser,
  encodeContentLengthMessage,
  type JsonRpcMessage,
  type JsonRpcNotification,
  type JsonRpcRequest,
} from '../protocol'

export type McpTransport = {
  initialize: () => Promise<unknown>
  listTools: () => Promise<McpToolInfo[]>
  callTool: (name: string, input: unknown) => Promise<unknown>
  close: () => Promise<void>
}

export class StdioMcpTransport implements McpTransport {
  private readonly child: ChildProcessWithoutNullStreams
  private readonly parser = new ContentLengthParser()
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void
      reject: (reason?: unknown) => void
      timer?: NodeJS.Timeout
    }
  >()
  private requestId = 0

  constructor(
    private readonly config: {
      command: string
      args?: string[]
      cwd?: string
      env?: NodeJS.ProcessEnv
      timeoutMs?: number
      security?: import('../../types').RuntimeSecurityOptions
      isolationProfile?: string
    },
  ) {
    const execution = buildIsolatedExecutionPlan({
      kind: 'mcp_stdio',
      cwd: config.cwd ?? process.cwd(),
      command: config.command,
      args: config.args ?? [],
      env: config.env,
      security: config.security,
      profileName: config.isolationProfile,
    })
    for (const warning of execution.warnings) {
      console.warn(`[mcp:stdio:isolation] ${warning}`)
    }
    this.child = spawn(execution.command, execution.args, {
      cwd: execution.cwd,
      env: execution.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })

    this.child.stdout.on('data', (chunk: Buffer) => {
      for (const message of this.parser.push(chunk)) {
        this.handleMessage(message)
      }
    })

    this.child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8').trim()
      if (text) {
        // Keep stderr available for debugging without crashing the client.
        console.error(`[mcp:stdio:stderr] ${text}`)
      }
    })

    this.child.on('exit', code => {
      for (const pending of this.pending.values()) {
        pending.reject(new Error(`MCP stdio process exited with code ${code ?? 'unknown'}`))
      }
      this.pending.clear()
    })
  }

  private handleMessage(message: JsonRpcMessage): void {
    if ('id' in message && 'result' in message) {
      const pending = this.pending.get(message.id)
      if (pending) {
        if (pending.timer) clearTimeout(pending.timer)
        pending.resolve(message.result)
        this.pending.delete(message.id)
      }
      return
    }

    if ('id' in message && 'error' in message) {
      if (message.id === null) return
      const pending = this.pending.get(message.id)
      if (pending) {
        if (pending.timer) clearTimeout(pending.timer)
        pending.reject(new Error(message.error.message))
        this.pending.delete(message.id)
      }
    }
  }

  private request(method: string, params?: unknown): Promise<unknown> {
    const id = ++this.requestId
    const message: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    }

    return new Promise((resolve, reject) => {
      const timer =
        this.config.timeoutMs && this.config.timeoutMs > 0
          ? setTimeout(() => {
              this.pending.delete(id)
              reject(new Error(`MCP stdio request timed out after ${this.config.timeoutMs}ms`))
            }, this.config.timeoutMs)
          : undefined
      this.pending.set(id, { resolve, reject, timer })
      this.child.stdin.write(encodeContentLengthMessage(message))
    })
  }

  private notify(method: string, params?: unknown): void {
    const message: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      params,
    }
    this.child.stdin.write(encodeContentLengthMessage(message))
  }

  async initialize(): Promise<unknown> {
    const result = await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'agent-blueprint',
        version: '0.1.0',
      },
    })
    this.notify('notifications/initialized', {})
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
    this.child.kill()
  }
}

export async function createStdioTransport(config: {
  command: string
  args?: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
  security?: import('../../types').RuntimeSecurityOptions
  isolationProfile?: string
}): Promise<McpTransport> {
  return new StdioMcpTransport(config)
}
