import { randomBytes } from 'crypto'
import { existsSync } from 'fs'
import { join } from 'path'
import { Analytics, StructuredLoggerAnalyticsSink } from './analytics'
import { RealMcpClient } from './mcp/client'
import { StructuredLogger, logError } from './ops/logger'
import { loadMcpConnections, saveMcpConnections } from './persistence/mcp'
import { loadMcpProfileStore, saveMcpProfileStore } from './persistence/mcpProfiles'
import { RemoteControlServer } from './remote/server'
import { loadSessionSnapshot, saveSessionSnapshot } from './persistence/session'
import type { McpProfile, McpServerConfig, RuntimeSnapshot } from './types'
import type { AgentRuntime } from './runtime'

export class AgentWorkbench {
  readonly logger: StructuredLogger
  readonly analytics: Analytics
  readonly mcp: RealMcpClient
  remote?: RemoteControlServer
  private remoteToken?: string
  private readonly mcpProfiles = new Map<string, McpProfile>()
  private activeMcpProfile: string | null = null

  constructor(readonly runtime: AgentRuntime) {
    this.logger = new StructuredLogger(runtime.options.logging).child({
      component: 'workbench',
    })
    this.analytics = new Analytics([new StructuredLoggerAnalyticsSink(this.logger)])
    this.mcp = new RealMcpClient({
      timeoutMs: runtime.options.security?.mcp?.timeoutMs,
      maxRetries: runtime.options.security?.mcp?.maxRetries,
      baseDelayMs: runtime.options.security?.mcp?.baseDelayMs,
      maxDelayMs: runtime.options.security?.mcp?.maxDelayMs,
      requestsPerMinute: runtime.options.security?.mcp?.requestsPerMinute,
      concurrency: runtime.options.security?.mcp?.concurrency,
      allowedTransports: runtime.options.security?.mcp?.allowedTransports,
      security: runtime.options.security,
    })
    this.runtime.attachMcpBridge({
      listConnections: () =>
        this.mcp.listConnections().map(connection => ({
          name: connection.name,
          transport: connection.config.transport,
          initialized: connection.initialized,
          tools: connection.tools,
        })),
      listServers: () =>
        this.mcp.listConnections().map(connection => ({
          name: connection.name,
          transport: connection.config.transport,
          initialized: connection.initialized,
          toolCount: connection.tools.length,
        })),
      refreshTools: name => this.mcp.refreshTools(name),
      callTool: (server, toolName, input) =>
        this.mcp.callTool(server, toolName, input),
    })
  }

  private getPersistenceDir(): string | null {
    return this.runtime.options.persistenceDir ?? null
  }

  private async persistMcpConnections(baseDir?: string): Promise<void> {
    const dir = baseDir ?? this.getPersistenceDir()
    if (!dir) return
    await saveMcpConnections(
      dir,
      this.mcp.listConnections().map(connection => ({
        name: connection.name,
        config: connection.config,
      })),
    )
  }

  private async persistMcpProfiles(baseDir?: string): Promise<void> {
    const dir = baseDir ?? this.getPersistenceDir()
    if (!dir) return
    await saveMcpProfileStore(dir, {
      activeProfile: this.activeMcpProfile,
      profiles: this.listMcpProfiles(),
    })
  }

  private async persistRuntimeSnapshot(baseDir?: string): Promise<void> {
    const dir = baseDir ?? this.getPersistenceDir()
    if (!dir) return
    await saveSessionSnapshot(dir, this.runtime.snapshotState())
  }

  private async markMcpStateChanged(options?: {
    preserveActiveProfile?: boolean
  }): Promise<void> {
    if (!options?.preserveActiveProfile && this.activeMcpProfile) {
      this.activeMcpProfile = null
    }
    await this.persistMcpConnections()
    await this.persistMcpProfiles()
  }

  listMcpConnections() {
    return this.mcp.listConnections()
  }

  listMcpProfiles(): McpProfile[] {
    return Array.from(this.mcpProfiles.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    )
  }

  getActiveMcpProfile(): string | null {
    return this.activeMcpProfile
  }

  async connectMcp(
    name: string,
    config: McpServerConfig,
    options?: { preserveActiveProfile?: boolean },
  ) {
    const connection = await this.mcp.connectNamed(name, config)
    await this.markMcpStateChanged(options)
    this.runtime.events.emitEvent('mcp.connected', {
      name: connection.name,
      transport: connection.config.transport,
      toolCount: connection.tools.length,
    })
    await this.analytics.log('mcp.connected', {
      name: connection.name,
      transport: connection.config.transport,
      toolCount: connection.tools.length,
    })
    await this.logger.audit('mcp.connected', {
      name: connection.name,
      transport: connection.config.transport,
      toolCount: connection.tools.length,
    })
    await this.persistRuntimeSnapshot()
    return connection
  }

  async disconnectMcp(
    name: string,
    options?: { preserveActiveProfile?: boolean },
  ): Promise<void> {
    await this.mcp.disconnect(name)
    await this.markMcpStateChanged(options)
    this.runtime.events.emitEvent('mcp.disconnected', { name })
    await this.analytics.log('mcp.disconnected', { name })
    await this.logger.audit('mcp.disconnected', { name })
    await this.persistRuntimeSnapshot()
  }

  async restoreMcpProfiles(baseDir?: string): Promise<{
    profiles: string[]
    activeProfile: string | null
  }> {
    const dir = baseDir ?? this.getPersistenceDir()
    if (!dir) return { profiles: [], activeProfile: null }

    const store = await loadMcpProfileStore(dir)
    this.mcpProfiles.clear()
    for (const profile of store.profiles) {
      this.mcpProfiles.set(profile.name, profile)
    }
    this.activeMcpProfile = store.activeProfile ?? null
    await this.persistRuntimeSnapshot()
    return {
      profiles: this.listMcpProfiles().map(profile => profile.name),
      activeProfile: this.activeMcpProfile,
    }
  }

  async saveCurrentAsMcpProfile(
    name: string,
    description?: string,
  ): Promise<McpProfile> {
    const profile: McpProfile = {
      name,
      description,
      connections: this.mcp.listConnections().map(connection => ({
        name: connection.name,
        config: connection.config,
      })),
    }
    this.mcpProfiles.set(name, profile)
    await this.persistMcpProfiles()
    this.runtime.events.emitEvent('mcp.profile.saved', {
      name,
      description,
      connectionCount: profile.connections.length,
    })
    await this.analytics.log('mcp.profile.saved', {
      name,
      connectionCount: profile.connections.length,
    })
    await this.persistRuntimeSnapshot()
    return profile
  }

  async upsertMcpProfile(profile: McpProfile): Promise<McpProfile> {
    this.mcpProfiles.set(profile.name, profile)
    await this.persistMcpProfiles()
    this.runtime.events.emitEvent('mcp.profile.saved', {
      name: profile.name,
      description: profile.description,
      connectionCount: profile.connections.length,
    })
    await this.analytics.log('mcp.profile.saved', {
      name: profile.name,
      connectionCount: profile.connections.length,
    })
    await this.persistRuntimeSnapshot()
    return profile
  }

  async deleteMcpProfile(name: string): Promise<boolean> {
    const deleted = this.mcpProfiles.delete(name)
    if (!deleted) return false
    if (this.activeMcpProfile === name) {
      this.activeMcpProfile = null
    }
    await this.persistMcpProfiles()
    this.runtime.events.emitEvent('mcp.profile.deleted', { name })
    await this.analytics.log('mcp.profile.deleted', { name })
    await this.persistRuntimeSnapshot()
    return true
  }

  async activateMcpProfile(name: string): Promise<{
    name: string
    connected: string[]
    failed: Array<{ name: string; error: string }>
  }> {
    const profile = this.mcpProfiles.get(name)
    if (!profile) {
      throw new Error(`Unknown MCP profile '${name}'`)
    }

    for (const connection of this.mcp.listConnections()) {
      await this.disconnectMcp(connection.name, { preserveActiveProfile: true })
    }

    const connected: string[] = []
    const failed: Array<{ name: string; error: string }> = []
    for (const connection of profile.connections) {
      try {
        await this.connectMcp(connection.name, connection.config, {
          preserveActiveProfile: true,
        })
        connected.push(connection.name)
      } catch (error) {
        failed.push({
          name: connection.name,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    this.activeMcpProfile = name
    await this.persistMcpProfiles()
    this.runtime.events.emitEvent('mcp.profile.activated', {
      name,
      connected,
      failed,
    })
    await this.analytics.log('mcp.profile.activated', {
      name,
      connected,
      failedCount: failed.length,
    })
    await this.persistRuntimeSnapshot()
    return { name, connected, failed }
  }

  async deactivateMcpProfile(name?: string): Promise<{
    name: string | null
    disconnected: string[]
  }> {
    const target = name ?? this.activeMcpProfile
    if (!target) {
      return { name: null, disconnected: [] }
    }

    const profile = this.mcpProfiles.get(target)
    const disconnected: string[] = []
    for (const connection of profile?.connections ?? []) {
      if (!this.mcp.listConnections().some(active => active.name === connection.name)) {
        continue
      }
      await this.disconnectMcp(connection.name, { preserveActiveProfile: true })
      disconnected.push(connection.name)
    }

    if (this.activeMcpProfile === target) {
      this.activeMcpProfile = null
    }
    await this.persistMcpProfiles()
    this.runtime.events.emitEvent('mcp.profile.deactivated', {
      name: target,
      disconnected,
    })
    await this.analytics.log('mcp.profile.deactivated', {
      name: target,
      disconnectedCount: disconnected.length,
    })
    await this.persistRuntimeSnapshot()
    return { name: target, disconnected }
  }

  async restoreMcpConnections(baseDir?: string): Promise<{
    restored: string[]
    failed: Array<{ name: string; error: string }>
  }> {
    const dir = baseDir ?? this.getPersistenceDir()
    if (!dir) return { restored: [], failed: [] }

    let configs = await loadMcpConnections(dir)
    if (configs.length === 0 && this.activeMcpProfile) {
      const active = this.mcpProfiles.get(this.activeMcpProfile)
      if (active) {
        configs = active.connections
      }
    }
    const restored: string[] = []
    const failed: Array<{ name: string; error: string }> = []

    for (const entry of configs) {
      try {
        await this.mcp.connectNamed(entry.name, entry.config)
        restored.push(entry.name)
      } catch (error) {
        failed.push({
          name: entry.name,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    if (restored.length > 0) {
      this.runtime.events.emitEvent('mcp.restored', {
        restored,
      })
    }
    if (failed.length > 0) {
      this.runtime.events.emitEvent('mcp.restore.failed', {
        failed,
      })
    }

    await this.markMcpStateChanged({ preserveActiveProfile: true })
    await this.persistRuntimeSnapshot()
    return { restored, failed }
  }

  async startRemote(port = 8787, token?: string): Promise<void> {
    if (this.remote) return
    const remoteToken =
      token ??
      (this.runtime.options.security?.remote?.requireToken ?? true
        ? randomBytes(24).toString('hex')
        : undefined)
    this.remoteToken = remoteToken
    this.remote = new RemoteControlServer(this.runtime, this.mcp, remoteToken, {
      connectMcp: (name, config) => this.connectMcp(name, config),
      disconnectMcp: name => this.disconnectMcp(name),
      listMcpConnections: () => this.listMcpConnections(),
      refreshMcpTools: name => this.mcp.refreshTools(name),
      callMcpTool: (server, tool, input) => this.mcp.callTool(server, tool, input),
      listMcpProfiles: () => this.listMcpProfiles(),
      getActiveMcpProfile: () => this.getActiveMcpProfile(),
      saveCurrentAsMcpProfile: (name, description) =>
        this.saveCurrentAsMcpProfile(name, description),
      upsertMcpProfile: profile => this.upsertMcpProfile(profile),
      activateMcpProfile: name => this.activateMcpProfile(name),
      deactivateMcpProfile: name => this.deactivateMcpProfile(name),
      deleteMcpProfile: name => this.deleteMcpProfile(name),
    })
    await this.remote.start(port)
    await this.analytics.log('remote.started', { port, tokenGenerated: !token && Boolean(remoteToken) })
    await this.logger.audit('remote.started', {
      port,
      tokenGenerated: !token && Boolean(remoteToken),
    })
    await this.persistRuntimeSnapshot()
  }

  async stopRemote(): Promise<void> {
    if (!this.remote) return
    await this.remote.stop()
    this.remote = undefined
    this.remoteToken = undefined
    await this.analytics.log('remote.stopped')
    await this.logger.audit('remote.stopped')
    await this.persistRuntimeSnapshot()
  }

  async shutdown(): Promise<void> {
    await this.persistMcpConnections()
    await this.persistMcpProfiles()
    await this.persistRuntimeSnapshot()
    await this.stopRemote()
    await this.mcp.disconnectAll()
    await this.analytics.log('workbench.stopped')
  }

  async saveSession(dir?: string): Promise<void> {
    const target = dir ?? this.runtime.options.persistenceDir ?? '.agent-blueprint-state'
    await saveSessionSnapshot(target, this.runtime.snapshotState())
    await this.persistMcpConnections(target)
    await this.persistMcpProfiles(target)
    await this.analytics.log('session.saved', { dir: target })
    await this.logger.audit('session.saved', { dir: target })
  }

  async loadSession(dir?: string): Promise<boolean> {
    const target = dir ?? this.runtime.options.persistenceDir ?? '.agent-blueprint-state'
    const snapshot = await loadSessionSnapshot(target)
    if (!snapshot) return false
    this.runtime.loadSnapshot(snapshot)
    await this.restoreMcpProfiles(target)
    await this.mcp.disconnectAll()
    await this.restoreMcpConnections(target)
    await this.analytics.log('session.loaded', { dir: target })
    await this.logger.audit('session.loaded', { dir: target })
    return true
  }

  getRecentEvents(limit = 20) {
    return this.runtime.events.recent(limit)
  }

  getSnapshot(): RuntimeSnapshot {
    return this.runtime.snapshotState()
  }

  getRemoteToken(): string | undefined {
    return this.remoteToken
  }

  async connectDemoMcp(name = 'demo'): Promise<void> {
    const compiledPath = join(process.cwd(), 'dist', 'mcp', 'demoServer.js')
    if (existsSync(compiledPath)) {
      await this.connectMcp(name, {
        transport: 'stdio',
        command: process.execPath,
        args: [compiledPath, '--stdio'],
      })
    } else if (process.platform === 'win32') {
      await this.connectMcp(name, {
        transport: 'stdio',
        command: 'cmd.exe',
        args: ['/d', '/s', '/c', 'npx tsx src/mcp/demoServer.ts --stdio'],
      })
    } else {
      await this.connectMcp(name, {
        transport: 'stdio',
        command: 'sh',
        args: ['-lc', 'npx tsx src/mcp/demoServer.ts --stdio'],
      })
    }
    await this.analytics.log('mcp.demo.connected', { name })
  }
}
