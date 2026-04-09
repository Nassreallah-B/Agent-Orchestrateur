import type { McpServerConfig, McpToolInfo, RuntimeSecurityOptions } from '../types'
import { createHttpTransport } from './transports/http'
import { createSseTransport } from './transports/sse'
import { createStdioTransport, type McpTransport } from './transports/stdio'
import { createWsTransport } from './transports/ws'
import { ConcurrencyGate, TokenBucketRateLimiter } from '../utils/rateLimit'
import { withRetries } from '../utils/retry'

export type ActiveMcpConnection = {
  name: string
  config: McpServerConfig
  transport: McpTransport
  initialized: boolean
  tools: McpToolInfo[]
  info?: unknown
}

type ConnectionPolicy = {
  retries: number
  baseDelayMs: number
  maxDelayMs: number
  limiter: TokenBucketRateLimiter
  gate: ConcurrencyGate
}

export class RealMcpClient {
  private readonly connections = new Map<string, ActiveMcpConnection>()
  private readonly policies = new Map<string, ConnectionPolicy>()

  constructor(
    private readonly options?: {
      timeoutMs?: number
      maxRetries?: number
      baseDelayMs?: number
      maxDelayMs?: number
      requestsPerMinute?: number
      concurrency?: number
      allowedTransports?: Array<McpServerConfig['transport']>
      security?: RuntimeSecurityOptions
    },
  ) {}

  async connectNamed(name: string, config: McpServerConfig): Promise<ActiveMcpConnection> {
    if (this.connections.has(name)) {
      await this.disconnect(name)
    }
    this.validateTransport(config)
    const policy = this.createPolicy(config)
    const setup = await withRetries(
      {
        label: `mcp-connect:${name}`,
        retries: policy.retries,
        baseDelayMs: policy.baseDelayMs,
        maxDelayMs: policy.maxDelayMs,
        shouldRetry: error => /timeout|timed out|HTTP 408|HTTP 409|HTTP 429|HTTP 5\d\d|fetch failed|aborted|ECONN/i.test(error instanceof Error ? error.message : String(error)),
      },
      async () => {
        const activeTransport = await this.connectTransport(config)
        const info = await activeTransport.initialize()
        return {
          transport: activeTransport,
          info,
        }
      },
    )
    const { transport, info } = setup
    const tools = await this.callWithPolicy(policy, () => transport.listTools())
    const connection: ActiveMcpConnection = {
      name,
      config,
      transport,
      initialized: true,
      tools,
      info,
    }
    this.connections.set(name, connection)
    this.policies.set(name, policy)
    return connection
  }

  private validateTransport(config: McpServerConfig): void {
    const allowed = this.options?.allowedTransports
    if (allowed && !allowed.includes(config.transport)) {
      throw new Error(`MCP transport '${config.transport}' is not allowed by policy`)
    }
  }

  private createPolicy(config: McpServerConfig): ConnectionPolicy {
    const requestsPerMinute = Math.max(1, config.requestsPerMinute ?? this.options?.requestsPerMinute ?? 60)
    const concurrency = Math.max(1, this.options?.concurrency ?? 4)
    return {
      retries: Math.max(0, config.retries ?? this.options?.maxRetries ?? 1),
      baseDelayMs: this.options?.baseDelayMs ?? 250,
      maxDelayMs: this.options?.maxDelayMs ?? 2_000,
      limiter: new TokenBucketRateLimiter(requestsPerMinute),
      gate: new ConcurrencyGate(concurrency),
    }
  }

  private async callWithPolicy<T>(
    policy: ConnectionPolicy,
    fn: () => Promise<T>,
  ): Promise<T> {
    if (!policy.limiter.consume('global')) {
      throw new Error('MCP rate limit exceeded for this runtime')
    }
    return policy.gate.run(() =>
      withRetries(
        {
          label: 'mcp-operation',
          retries: policy.retries,
          baseDelayMs: policy.baseDelayMs,
          maxDelayMs: policy.maxDelayMs,
          shouldRetry: error =>
            /timeout|timed out|HTTP 408|HTTP 409|HTTP 429|HTTP 5\d\d|fetch failed|aborted|ECONN/i.test(
              error instanceof Error ? error.message : String(error),
            ),
        },
        async () => fn(),
      ),
    )
  }

  private async connectTransport(config: McpServerConfig): Promise<McpTransport> {
    const timeoutMs = config.timeoutMs ?? this.options?.timeoutMs
    switch (config.transport) {
      case 'stdio':
        if (!config.command) throw new Error('stdio transport requires a command')
        return createStdioTransport({
          command: config.command,
          args: config.args,
          cwd: config.cwd ?? process.cwd(),
          timeoutMs,
          security: this.options?.security,
          isolationProfile: config.isolationProfile,
        })
      case 'http':
        if (!config.url) throw new Error('http transport requires a url')
        return createHttpTransport({ url: config.url, headers: config.headers, timeoutMs })
      case 'sse':
        if (!config.url) throw new Error('sse transport requires a url')
        return createSseTransport({ url: config.url, headers: config.headers, timeoutMs })
      case 'ws':
        if (!config.url) throw new Error('ws transport requires a url')
        return createWsTransport({ url: config.url, timeoutMs })
      default:
        throw new Error(`Unsupported MCP transport: ${(config as McpServerConfig).transport}`)
    }
  }

  listConnections(): ActiveMcpConnection[] {
    return Array.from(this.connections.values())
  }

  getConnection(name: string): ActiveMcpConnection {
    const connection = this.connections.get(name)
    if (!connection) throw new Error(`Unknown MCP server '${name}'`)
    return connection
  }

  async refreshTools(name: string): Promise<McpToolInfo[]> {
    const connection = this.getConnection(name)
    const policy = this.policies.get(name)
    if (!policy) throw new Error(`Missing MCP policy for '${name}'`)
    connection.tools = await this.callWithPolicy(policy, () => connection.transport.listTools())
    return connection.tools
  }

  async callTool(name: string, toolName: string, input: unknown): Promise<unknown> {
    const connection = this.getConnection(name)
    const policy = this.policies.get(name)
    if (!policy) throw new Error(`Missing MCP policy for '${name}'`)
    return this.callWithPolicy(policy, () => connection.transport.callTool(toolName, input))
  }

  async disconnect(name: string): Promise<void> {
    const connection = this.getConnection(name)
    await connection.transport.close()
    this.connections.delete(name)
    this.policies.delete(name)
  }

  async disconnectAll(): Promise<void> {
    for (const name of Array.from(this.connections.keys())) {
      await this.disconnect(name)
    }
  }
}
