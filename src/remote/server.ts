import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { randomUUID, timingSafeEqual } from 'crypto'
import { z } from 'zod'
import { URL } from 'url'
import { runCoordinatedWorkflow } from '../coordinator/coordinatorRuntime'
import type { RuntimeEvent } from '../events'
import type { RealMcpClient } from '../mcp/client'
import { StructuredLogger, logError } from '../ops/logger'
import { sanitizeMcpProfiles, serializeError } from '../security/redaction'
import type { McpProfile, McpServerConfig } from '../types'
import { TokenBucketRateLimiter } from '../utils/rateLimit'
import { renderRemoteControlHtml } from './webUi'
import type { AgentRuntime } from '../runtime'

const COOKIE_NAME = 'agent_blueprint_session'

const spawnSchema = z.object({
  description: z.string().min(1),
  prompt: z.string().min(1),
  subagent_type: z.string().optional(),
  model: z.string().optional(),
  run_in_background: z.boolean().optional(),
  name: z.string().optional(),
  team_name: z.string().optional(),
  mode: z.string().optional(),
  isolation: z.enum(['worktree', 'remote']).optional(),
  cwd: z.string().optional(),
})

const messageSchema = z.object({
  to: z.string().min(1),
  message: z.union([z.string(), z.record(z.string(), z.unknown())]),
})

const orchestrateSchema = z.object({
  goal: z.string().min(1),
  aspects: z.array(z.string()).default([]),
  teamName: z.string().optional(),
  verify: z.boolean().optional(),
})

const teamCreateSchema = z.object({
  team_name: z.string().min(1),
  description: z.string().optional(),
  agent_type: z.string().optional(),
})

const mcpConfigSchema = z.object({
  transport: z.enum(['stdio', 'http', 'sse', 'ws']),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  cwd: z.string().optional(),
  url: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  timeoutMs: z.number().int().positive().optional(),
  retries: z.number().int().min(0).max(10).optional(),
  requestsPerMinute: z.number().int().positive().max(10_000).optional(),
  isolationProfile: z.string().optional(),
})

const mcpConnectSchema = z.object({
  name: z.string().min(1),
  config: mcpConfigSchema,
})

const mcpNameSchema = z.object({
  name: z.string().min(1),
})

const mcpProfileSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  connections: z
    .array(
      z.object({
        name: z.string().min(1),
        config: mcpConfigSchema,
      }),
    )
    .optional(),
})

const mcpCallSchema = z.object({
  server: z.string().min(1),
  tool: z.string().min(1),
  input: z.unknown().optional(),
})

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message)
  }
}

function parseCookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie
  if (!header) return {}
  return Object.fromEntries(
    header
      .split(';')
      .map(part => part.trim())
      .filter(Boolean)
      .map(part => {
        const [key, ...rest] = part.split('=')
        return [key, decodeURIComponent(rest.join('='))]
      }),
  )
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

async function readJsonBody(
  req: IncomingMessage,
  maxBytes: number,
): Promise<unknown> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.length
    if (bytes > maxBytes) {
      throw new HttpError(413, `Request body exceeds ${maxBytes} bytes`, 'body_too_large')
    }
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new HttpError(400, 'Invalid JSON body', 'invalid_json')
  }
}

function writeResponse(
  res: ServerResponse,
  status: number,
  body: string,
  contentType: string,
  requestId: string,
  extraHeaders?: Record<string, string | string[]>,
): void {
  res.writeHead(status, {
    'content-type': contentType,
    'cache-control': 'no-store',
    connection: 'close',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'x-request-id': requestId,
    ...extraHeaders,
  })
  res.end(body)
}

function writeJson(
  res: ServerResponse,
  status: number,
  data: unknown,
  requestId: string,
  extraHeaders?: Record<string, string | string[]>,
): void {
  writeResponse(
    res,
    status,
    JSON.stringify(data, null, 2),
    'application/json; charset=utf-8',
    requestId,
    extraHeaders,
  )
}

function writeHtml(
  res: ServerResponse,
  status: number,
  html: string,
  requestId: string,
  extraHeaders?: Record<string, string | string[]>,
): void {
  writeResponse(
    res,
    status,
    html,
    'text/html; charset=utf-8',
    requestId,
    extraHeaders,
  )
}

export class RemoteControlServer {
  private server = createServer(this.handleRequest.bind(this))
  private readonly sseClients = new Set<ServerResponse>()
  private readonly logger: StructuredLogger
  private readonly requestLimiter: TokenBucketRateLimiter
  private readonly mutationLimiter: TokenBucketRateLimiter
  private readonly remoteSecurity: {
    requireToken: boolean
    allowQueryTokenBootstrap: boolean
    maxBodyBytes: number
    trustedOrigins: string[]
    sessionTtlMs: number
  }
  private boundEventHandler: ((event: RuntimeEvent) => void) | null = null

  constructor(
    private readonly runtime: AgentRuntime,
    private readonly mcpClient: RealMcpClient,
    private readonly token?: string,
    private readonly controls?: {
      connectMcp?: (name: string, config: McpServerConfig) => Promise<{
        name: string
        config: McpServerConfig
        tools: unknown[]
      }>
      disconnectMcp?: (name: string) => Promise<void>
      listMcpConnections?: () => Array<{
        name: string
        config: McpServerConfig
        initialized: boolean
        tools: unknown[]
      }>
      refreshMcpTools?: (name: string) => Promise<unknown[]>
      callMcpTool?: (server: string, tool: string, input: unknown) => Promise<unknown>
      listMcpProfiles?: () => McpProfile[]
      getActiveMcpProfile?: () => string | null
      saveCurrentAsMcpProfile?: (name: string, description?: string) => Promise<McpProfile>
      upsertMcpProfile?: (profile: McpProfile) => Promise<McpProfile>
      activateMcpProfile?: (name: string) => Promise<unknown>
      deactivateMcpProfile?: (name?: string) => Promise<unknown>
      deleteMcpProfile?: (name: string) => Promise<boolean>
    },
  ) {
    const remoteSecurity = runtime.options.security?.remote
    this.remoteSecurity = {
      requireToken: remoteSecurity?.requireToken ?? true,
      allowQueryTokenBootstrap: remoteSecurity?.allowQueryTokenBootstrap ?? true,
      maxBodyBytes: remoteSecurity?.maxBodyBytes ?? 64 * 1024,
      trustedOrigins: remoteSecurity?.trustedOrigins ?? [],
      sessionTtlMs: remoteSecurity?.sessionTtlMs ?? 12 * 60 * 60 * 1000,
    }
    this.logger = new StructuredLogger(runtime.options.logging).child({
      component: 'remote-server',
    })
    this.requestLimiter = new TokenBucketRateLimiter(
      remoteSecurity?.requestsPerMinute ?? 240,
    )
    this.mutationLimiter = new TokenBucketRateLimiter(
      remoteSecurity?.mutationRequestsPerMinute ?? 60,
    )
  }

  private isAuthorized(req: IncomingMessage, url: URL): boolean {
    const token = this.token
    if (!token) return !this.remoteSecurity.requireToken

    const auth = req.headers.authorization?.replace(/^Bearer\s+/i, '').trim()
    const cookieToken = parseCookies(req)[COOKIE_NAME]
    const queryToken = this.remoteSecurity.allowQueryTokenBootstrap
      ? url.searchParams.get('token') ?? undefined
      : undefined

    return [auth, cookieToken, queryToken].some(
      (candidate): candidate is string =>
        typeof candidate === 'string' && safeEqual(candidate, token),
    )
  }

  private requestKey(req: IncomingMessage): string {
    return req.socket?.remoteAddress ?? 'local'
  }

  private assertOriginAllowed(req: IncomingMessage): void {
    const allowedOrigins = this.remoteSecurity.trustedOrigins
    if (allowedOrigins.length === 0) return
    const origin = req.headers.origin
    if (!origin) return
    if (!allowedOrigins.includes(origin)) {
      throw new HttpError(403, 'Origin is not allowed', 'forbidden_origin')
    }
  }

  private assertRateLimit(req: IncomingMessage, pathname: string, method: string): void {
    const key = `${this.requestKey(req)}:${pathname}`
    if (!this.requestLimiter.consume(key)) {
      throw new HttpError(429, 'Remote request rate limit exceeded', 'rate_limited')
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      if (!this.mutationLimiter.consume(this.requestKey(req))) {
        throw new HttpError(429, 'Remote mutation rate limit exceeded', 'mutation_rate_limited')
      }
    }
  }

  private getCookieHeader(): string {
    const maxAge = Math.max(60, Math.floor(this.remoteSecurity.sessionTtlMs / 1000))
    return `${COOKIE_NAME}=${encodeURIComponent(this.token ?? '')}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${maxAge}`
  }

  private async parseBody<T>(
    req: IncomingMessage,
    schema: z.ZodSchema<T>,
  ): Promise<T> {
    const contentType = req.headers['content-type'] ?? ''
    if (!contentType.includes('application/json')) {
      throw new HttpError(415, 'Expected application/json request body', 'unsupported_media_type')
    }
    const body = await readJsonBody(req, this.remoteSecurity.maxBodyBytes)
    try {
      return schema.parse(body)
    } catch (error) {
      throw new HttpError(
        400,
        error instanceof z.ZodError ? error.issues.map(issue => issue.message).join('; ') : 'Invalid request body',
        'invalid_body',
      )
    }
  }

  private broadcastEvent(event: RuntimeEvent): void {
    const payload = `data: ${JSON.stringify(event)}\n\n`
    for (const client of this.sseClients) {
      client.write(payload)
    }
  }

  async start(port = 8787): Promise<void> {
    if (this.boundEventHandler) return
    this.boundEventHandler = (event: RuntimeEvent) => this.broadcastEvent(event)
    this.runtime.events.on('event', this.boundEventHandler)
    this.server.keepAliveTimeout = 1_000
    this.server.requestTimeout = 30_000
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(port, () => resolve())
    })
    await this.logger.info('remote server started', { port })
  }

  async stop(): Promise<void> {
    if (this.boundEventHandler) {
      this.runtime.events.off('event', this.boundEventHandler)
      this.boundEventHandler = null
    }
    for (const client of this.sseClients) {
      client.end()
    }
    this.sseClients.clear()
    this.server.closeAllConnections?.()
    this.server.closeIdleConnections?.()
    await new Promise<void>((resolve, reject) => {
      this.server.close(error => (error ? reject(error) : resolve()))
    })
    await this.logger.info('remote server stopped')
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const requestId = randomUUID()
    const method = req.method ?? 'GET'
    const url = new URL(req.url ?? '/', 'http://localhost')
    const pathname = url.pathname

    try {
      this.assertOriginAllowed(req)
      this.assertRateLimit(req, pathname, method)

      if (pathname === '/favicon.ico' && method === 'GET') {
        res.writeHead(204, { 'x-request-id': requestId })
        res.end()
        return
      }

      if (!this.isAuthorized(req, url)) {
        await this.logger.audit('remote.auth.failed', {
          requestId,
          pathname,
          method,
          ip: this.requestKey(req),
        })
        throw new HttpError(401, 'Unauthorized', 'unauthorized')
      }

      if (pathname === '/' && method === 'GET') {
        writeHtml(res, 200, renderRemoteControlHtml(), requestId, this.token ? {
          'set-cookie': this.getCookieHeader(),
        } : undefined)
        return
      }

      if (pathname === '/health' && method === 'GET') {
        writeJson(res, 200, { ok: true }, requestId)
        return
      }

      if (pathname === '/config' && method === 'GET') {
        writeJson(
          res,
          200,
          {
            provider: this.runtime.options.provider,
            models: this.runtime.options.models,
            featureFlags: this.runtime.options.featureFlags ?? {},
            tools: this.runtime.listToolDefinitions().map(tool => tool.name),
            agents: this.runtime.listAgents().map(agent => agent.agentType),
            processIsolation: this.runtime.options.security?.processIsolation ?? {},
            remoteSecurity: {
              requireToken: this.remoteSecurity.requireToken,
              allowQueryTokenBootstrap: this.remoteSecurity.allowQueryTokenBootstrap,
              trustedOrigins: this.remoteSecurity.trustedOrigins,
            },
          },
          requestId,
        )
        return
      }

      if (pathname === '/events' && method === 'GET') {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
          'x-request-id': requestId,
        })
        this.sseClients.add(res)
        for (const event of this.runtime.events.recent(50)) {
          res.write(`data: ${JSON.stringify(event)}\n\n`)
        }
        req.on('close', () => this.sseClients.delete(res))
        return
      }

      if (pathname === '/state' && method === 'GET') {
        writeJson(res, 200, this.runtime.snapshotState(), requestId)
        return
      }

      if (pathname === '/agents' && method === 'GET') {
        writeJson(res, 200, Array.from(this.runtime.state.agentTasks.values()), requestId)
        return
      }

      if (pathname === '/tasks' && method === 'GET') {
        writeJson(
          res,
          200,
          {
            taskRecords: Array.from(this.runtime.state.taskRecords.values()),
            agentTasks: Array.from(this.runtime.state.agentTasks.values()),
          },
          requestId,
        )
        return
      }

      if (pathname === '/teams' && method === 'GET') {
        writeJson(res, 200, Array.from(this.runtime.state.teams.values()), requestId)
        return
      }

      if (pathname === '/agents/spawn' && method === 'POST') {
        const body = await this.parseBody(req, spawnSchema)
        const task = await this.runtime.spawnAgent(body)
        await this.logger.audit('remote.agent.spawn', {
          requestId,
          ip: this.requestKey(req),
          agentType: body.subagent_type,
          background: body.run_in_background,
        })
        writeJson(res, 200, task, requestId)
        return
      }

      if (pathname === '/agents/message' && method === 'POST') {
        const body = await this.parseBody(req, messageSchema)
        const payload =
          typeof body.message === 'string' ? body.message : JSON.stringify(body.message)
        const task = await this.runtime.continueAgent(body.to, payload)
        await this.logger.audit('remote.agent.message', {
          requestId,
          ip: this.requestKey(req),
          target: body.to,
        })
        writeJson(res, 200, task, requestId)
        return
      }

      if (pathname === '/orchestrate' && method === 'POST') {
        const body = await this.parseBody(req, orchestrateSchema)
        const result = await runCoordinatedWorkflow(this.runtime, {
          goal: body.goal,
          aspects: body.aspects ?? [],
          teamName: body.teamName,
          verify: body.verify,
        })
        await this.logger.audit('remote.orchestrate', {
          requestId,
          ip: this.requestKey(req),
          goal: body.goal,
          aspects: (body.aspects ?? []).length,
        })
        writeJson(res, 200, result, requestId)
        return
      }

      if (pathname === '/teams' && method === 'POST') {
        const body = await this.parseBody(req, teamCreateSchema)
        const team = this.runtime.createTeam(body)
        await this.logger.audit('remote.team.create', {
          requestId,
          ip: this.requestKey(req),
          teamName: body.team_name,
        })
        writeJson(res, 200, team, requestId)
        return
      }

      if (pathname.startsWith('/teams/') && method === 'DELETE') {
        const teamName = decodeURIComponent(pathname.slice('/teams/'.length))
        const success = this.runtime.deleteTeam(teamName)
        await this.logger.audit('remote.team.delete', {
          requestId,
          ip: this.requestKey(req),
          teamName,
          success,
        })
        writeJson(res, 200, { success }, requestId)
        return
      }

      if (pathname === '/mcp/servers' && method === 'GET') {
        const listConnections =
          this.controls?.listMcpConnections ?? (() => this.mcpClient.listConnections())
        writeJson(
          res,
          200,
          listConnections().map(connection => ({
            name: connection.name,
            transport: connection.config.transport,
            isolationProfile: connection.config.isolationProfile ?? null,
            initialized: connection.initialized,
            toolCount: connection.tools.length,
          })),
          requestId,
        )
        return
      }

      if (pathname === '/mcp/profiles' && method === 'GET') {
        const listProfiles = this.controls?.listMcpProfiles ?? (() => [])
        const activeProfile = this.controls?.getActiveMcpProfile?.() ?? null
        writeJson(
          res,
          200,
          {
            activeProfile,
            profiles: sanitizeMcpProfiles(
              listProfiles(),
              this.runtime.options.security?.redactKeys,
            ),
          },
          requestId,
        )
        return
      }

      if (pathname === '/mcp/connect' && method === 'POST') {
        const body = await this.parseBody(req, mcpConnectSchema)
        const connect =
          this.controls?.connectMcp ??
          ((name: string, config: McpServerConfig) =>
            this.mcpClient.connectNamed(name, config))
        const connection = await connect(body.name, body.config)
        await this.logger.audit('remote.mcp.connect', {
          requestId,
          ip: this.requestKey(req),
          name: body.name,
          transport: body.config.transport,
        })
        writeJson(
          res,
          200,
          {
            name: connection.name,
            transport: connection.config.transport,
            tools: connection.tools,
          },
          requestId,
        )
        return
      }

      if (pathname === '/mcp/disconnect' && method === 'POST') {
        const body = await this.parseBody(req, mcpNameSchema)
        const disconnect =
          this.controls?.disconnectMcp ??
          ((name: string) => this.mcpClient.disconnect(name))
        await disconnect(body.name)
        await this.logger.audit('remote.mcp.disconnect', {
          requestId,
          ip: this.requestKey(req),
          name: body.name,
        })
        writeJson(res, 200, { success: true, name: body.name }, requestId)
        return
      }

      if (pathname === '/mcp/profiles' && method === 'POST') {
        const body = await this.parseBody(req, mcpProfileSchema)
        const profile =
          body.connections && this.controls?.upsertMcpProfile
            ? await this.controls.upsertMcpProfile({
                name: body.name,
                description: body.description,
                connections: body.connections,
              })
            : this.controls?.saveCurrentAsMcpProfile
              ? await this.controls.saveCurrentAsMcpProfile(body.name, body.description)
              : null

        if (!profile) {
          throw new HttpError(400, 'MCP profile controls are not available', 'mcp_profiles_unavailable')
        }

        await this.logger.audit('remote.mcp.profile.save', {
          requestId,
          ip: this.requestKey(req),
          name: body.name,
        })
        writeJson(
          res,
          200,
          sanitizeMcpProfiles([profile], this.runtime.options.security?.redactKeys)[0],
          requestId,
        )
        return
      }

      if (pathname === '/mcp/profiles/activate' && method === 'POST') {
        const body = await this.parseBody(req, mcpNameSchema)
        if (!this.controls?.activateMcpProfile) {
          throw new HttpError(400, 'MCP profile controls are not available', 'mcp_profiles_unavailable')
        }
        const result = await this.controls.activateMcpProfile(body.name)
        await this.logger.audit('remote.mcp.profile.activate', {
          requestId,
          ip: this.requestKey(req),
          name: body.name,
        })
        writeJson(res, 200, result, requestId)
        return
      }

      if (pathname === '/mcp/profiles/deactivate' && method === 'POST') {
        const body = await this.parseBody(req, mcpNameSchema.partial())
        if (!this.controls?.deactivateMcpProfile) {
          throw new HttpError(400, 'MCP profile controls are not available', 'mcp_profiles_unavailable')
        }
        const result = await this.controls.deactivateMcpProfile(body.name)
        await this.logger.audit('remote.mcp.profile.deactivate', {
          requestId,
          ip: this.requestKey(req),
          name: body.name ?? null,
        })
        writeJson(res, 200, result, requestId)
        return
      }

      if (pathname.startsWith('/mcp/profiles/') && method === 'DELETE') {
        const name = decodeURIComponent(pathname.slice('/mcp/profiles/'.length))
        if (!this.controls?.deleteMcpProfile) {
          throw new HttpError(400, 'MCP profile controls are not available', 'mcp_profiles_unavailable')
        }
        const success = await this.controls.deleteMcpProfile(name)
        await this.logger.audit('remote.mcp.profile.delete', {
          requestId,
          ip: this.requestKey(req),
          name,
          success,
        })
        writeJson(res, 200, { success, name }, requestId)
        return
      }

      if (pathname === '/mcp/tools' && method === 'GET') {
        const serverName = url.searchParams.get('server')
        if (!serverName) {
          throw new HttpError(400, 'Missing server query parameter', 'missing_server')
        }
        const refreshTools =
          this.controls?.refreshMcpTools ??
          ((name: string) => this.mcpClient.refreshTools(name))
        writeJson(res, 200, await refreshTools(serverName), requestId)
        return
      }

      if (pathname === '/mcp/call' && method === 'POST') {
        const body = await this.parseBody(req, mcpCallSchema)
        const callTool =
          this.controls?.callMcpTool ??
          ((server: string, tool: string, input: unknown) =>
            this.mcpClient.callTool(server, tool, input))
        const result = await callTool(body.server, body.tool, body.input)
        await this.logger.audit('remote.mcp.call', {
          requestId,
          ip: this.requestKey(req),
          server: body.server,
          tool: body.tool,
        })
        writeJson(res, 200, result, requestId)
        return
      }

      throw new HttpError(404, 'Not found', 'not_found')
    } catch (error) {
      const httpError =
        error instanceof HttpError
          ? error
          : new HttpError(500, error instanceof Error ? error.message : String(error), 'internal_error')

      if (httpError.status >= 500) {
        await logError(this.logger, 'remote request failed', error, {
          requestId,
          pathname,
          method,
          ip: this.requestKey(req),
        })
      } else {
        await this.logger.warn('remote request rejected', {
          requestId,
          pathname,
          method,
          status: httpError.status,
          code: httpError.code,
          ip: this.requestKey(req),
        })
      }

      writeJson(
        res,
        httpError.status,
        {
          error: httpError.message,
          code: httpError.code,
          requestId,
          details: httpError.status >= 500 ? serializeError(error) : undefined,
        },
        requestId,
      )
    }
  }
}
