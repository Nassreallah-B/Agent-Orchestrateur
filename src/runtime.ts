import { randomUUID } from 'crypto'
import { FORK_AGENT, GENERAL_PURPOSE_AGENT, TEAM_LEAD_NAME } from './builtins'
import { RuntimeEventBus } from './events'
import { isFeatureEnabled } from './featureFlags'
import { loadAgentDefinitions } from './loaders'
import { loadSessionSnapshot, saveSessionSnapshot } from './persistence/session'
import { ConcurrencyGate, TokenBucketRateLimiter } from './utils/rateLimit'
import { withRetries } from './utils/retry'
import type {
  AgentDefinition,
  AgentTask,
  ConversationMessage,
  MessageBlock,
  McpToolInfo,
  ModelInvocationOutput,
  ModelInvoker,
  RuntimeOptions,
  RuntimeSnapshot,
  RuntimeState,
  TeamRecord,
  ToolDefinition,
  ToolRegistry,
  ToolUseContext,
} from './types'

export class AgentRuntime {
  public readonly state: RuntimeState
  public readonly options: RuntimeOptions
  public readonly events: RuntimeEventBus
  private readonly invokeModel: ModelInvoker
  private readonly modelLimiter: TokenBucketRateLimiter
  private readonly modelGate: ConcurrencyGate
  private mcpBridge?: {
    listConnections: () => Array<{
      name: string
      transport: string
      initialized: boolean
      tools: McpToolInfo[]
    }>
    listServers: () => Array<{
      name: string
      transport: string
      initialized: boolean
      toolCount: number
    }>
    refreshTools: (name: string) => Promise<any[]>
    callTool: (server: string, toolName: string, input: unknown) => Promise<unknown>
  }

  constructor(args: {
    invokeModel: ModelInvoker
    options?: Partial<RuntimeOptions>
    tools?: ToolDefinition[]
    agents?: AgentDefinition[]
  }) {
    this.invokeModel = args.invokeModel
    this.options = {
      featureFlags: {},
      persistenceDir: '.agent-blueprint-state',
      maxToolRounds: 8,
      ...args.options,
      models: {
        defaultMain: args.options?.models?.defaultMain ?? 'sonnet',
        defaultSubagent: args.options?.models?.defaultSubagent ?? 'haiku',
        aliases: args.options?.models?.aliases ?? {},
      },
    }
    this.events = new RuntimeEventBus()
    this.modelLimiter = new TokenBucketRateLimiter(
      this.options.security?.llm?.requestsPerMinute ?? 120,
    )
    this.modelGate = new ConcurrencyGate(
      Math.max(1, this.options.security?.llm?.concurrency ?? 4),
    )

    const toolRegistry: ToolRegistry = new Map()
    for (const tool of args.tools ?? []) {
      toolRegistry.set(tool.name, tool)
    }

    this.state = {
      agentDefinitions: loadAgentDefinitions({
        builtIn: args.agents,
      }),
      toolRegistry,
      agentTasks: new Map<string, AgentTask>(),
      taskRecords: new Map(),
      teams: new Map(),
    }
  }

  private emit(type: string, payload?: Record<string, unknown>): void {
    this.events.emitEvent(type, payload)
  }

  private getSecurity() {
    return this.options.security ?? {}
  }

  private getConcurrentTaskCount(): number {
    return Array.from(this.state.agentTasks.values()).filter(task =>
      ['running', 'in_progress', 'pending'].includes(task.status),
    ).length
  }

  private pruneStoredTasks(maxStoredTasks: number): void {
    const tasks = Array.from(this.state.agentTasks.values())
    if (tasks.length < maxStoredTasks) return

    const removable = tasks
      .filter(task => !['running', 'in_progress', 'pending'].includes(task.status))
      .sort((a, b) => a.updatedAt - b.updatedAt)

    while (this.state.agentTasks.size >= maxStoredTasks && removable.length > 0) {
      const task = removable.shift()
      if (!task) break
      this.state.agentTasks.delete(task.id)
    }

    if (this.state.agentTasks.size >= maxStoredTasks) {
      throw new Error(`Stored task quota exceeded (${maxStoredTasks})`)
    }
  }

  private enforceTaskQuota(): void {
    const quotas = this.getSecurity().quotas
    if (quotas?.maxConcurrentTasks) {
      const current = this.getConcurrentTaskCount()
      if (current >= quotas.maxConcurrentTasks) {
        throw new Error(`Concurrent task quota exceeded (${quotas.maxConcurrentTasks})`)
      }
    }
    if (quotas?.maxStoredTasks) {
      this.pruneStoredTasks(quotas.maxStoredTasks)
    }
  }

  private enforceTeamQuota(): void {
    const maxTeams = this.getSecurity().quotas?.maxTeams
    if (!maxTeams) return
    if (this.state.teams.size >= maxTeams) {
      throw new Error(`Team quota exceeded (${maxTeams})`)
    }
  }

  attachMcpBridge(bridge: {
    listConnections: () => Array<{
      name: string
      transport: string
      initialized: boolean
      tools: McpToolInfo[]
    }>
    listServers: () => Array<{
      name: string
      transport: string
      initialized: boolean
      toolCount: number
    }>
    refreshTools: (name: string) => Promise<any[]>
    callTool: (server: string, toolName: string, input: unknown) => Promise<unknown>
  }): void {
    this.mcpBridge = bridge
  }

  private async autosave(): Promise<void> {
    if (!this.options.persistenceDir) return
    await saveSessionSnapshot(this.options.persistenceDir, this.snapshotState())
  }

  private normalizeModelAlias(model?: string): string {
    if (!model || model === 'inherit') {
      return this.options.models.defaultMain
    }
    return this.options.models.aliases?.[model] ?? model
  }

  private sanitizeToolNameFragment(value: string): string {
    const normalized = value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
    return normalized || 'tool'
  }

  private buildDynamicMcpTools(): ToolDefinition[] {
    if (!this.mcpBridge) return []

    const definitions: ToolDefinition[] = []
    const seenNames = new Map<string, number>()

    for (const connection of this.mcpBridge.listConnections()) {
      for (const tool of connection.tools) {
        const baseName = `mcp_${this.sanitizeToolNameFragment(connection.name)}_${this.sanitizeToolNameFragment(tool.name)}`
        const seen = seenNames.get(baseName) ?? 0
        seenNames.set(baseName, seen + 1)
        const runtimeName = seen === 0 ? baseName : `${baseName}_${seen + 1}`

        definitions.push({
          name: runtimeName,
          description:
            tool.description ||
            `Call MCP tool '${tool.name}' on server '${connection.name}'.`,
          inputSchema:
            tool.inputSchema ??
            ({
              type: 'object',
              additionalProperties: true,
            } as const),
          call: input =>
            this.mcpBridge!.callTool(connection.name, tool.name, input),
        })
      }
    }

    return definitions
  }

  private resolveToolsForAgent(agent: AgentDefinition): ToolDefinition[] {
    const merged = new Map<string, ToolDefinition>()
    for (const tool of Array.from(this.state.toolRegistry.values())) {
      merged.set(tool.name, tool)
    }
    for (const tool of this.buildDynamicMcpTools()) {
      merged.set(tool.name, tool)
    }

    const allTools = Array.from(merged.values())
    const disallowed = new Set(agent.disallowedTools ?? [])
    const allowed = agent.tools

    if (!allowed || allowed.includes('*')) {
      return allTools.filter(tool => !disallowed.has(tool.name))
    }

    const allowedSet = new Set(allowed)
    return allTools.filter(tool => allowedSet.has(tool.name) && !disallowed.has(tool.name))
  }

  listAgents(): AgentDefinition[] {
    return this.state.agentDefinitions.activeAgents
  }

  getAgent(agentType?: string): AgentDefinition {
    if (!agentType) return GENERAL_PURPOSE_AGENT
    const found = this.state.agentDefinitions.activeAgents.find(
      (a: AgentDefinition) => a.agentType === agentType,
    )
    if (!found) {
      throw new Error(`Unknown agent type: ${agentType}`)
    }
    return found
  }

  listToolDefinitions(agentType?: string): ToolDefinition[] {
    const agent = agentType ? this.getAgent(agentType) : GENERAL_PURPOSE_AGENT
    return this.resolveToolsForAgent(agent)
  }

  createContext(
    cwd: string,
    agent?: AgentDefinition,
    resolvedTools?: ToolDefinition[],
  ): ToolUseContext {
    const tools =
      resolvedTools ??
      (agent
        ? this.resolveToolsForAgent(agent)
        : (Array.from(this.state.toolRegistry.values()) as ToolDefinition[]))

    return {
      state: this.state,
      options: {
        cwd,
        tools: tools.map((t: ToolDefinition) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
        agentDefinitions: this.state.agentDefinitions,
        security: this.options.security,
      },
      runtime: {
        invokeModel: this.invokeModel,
        generateId: () => randomUUID(),
        now: () => Date.now(),
        spawnAgent: input => this.spawnAgent(input),
        continueAgent: (target, message) => this.continueAgent(target, message),
        waitForTask: (taskId, timeoutMs) => this.waitForTask(taskId, timeoutMs),
        createTeam: input => this.createTeam(input),
        deleteTeam: name => this.deleteTeam(name),
        findTask: taskId => this.findTask(taskId),
        listMcpServers: this.mcpBridge ? () => this.mcpBridge!.listServers() : undefined,
        listMcpConnections: this.mcpBridge
          ? () => this.mcpBridge!.listConnections()
          : undefined,
        refreshMcpTools: this.mcpBridge
          ? name => this.mcpBridge!.refreshTools(name)
          : undefined,
        callMcpTool: this.mcpBridge
          ? (server, toolName, input) =>
              this.mcpBridge!.callTool(server, toolName, input)
          : undefined,
      },
    }
  }

  private resolveSpawnedAgent(input: {
    subagent_type?: string
    fork?: boolean
  }): AgentDefinition {
    if (input.subagent_type) {
      return this.getAgent(input.subagent_type)
    }

    if (input.fork || isFeatureEnabled(this.options.featureFlags, 'forkSubagent')) {
      return FORK_AGENT
    }

    return GENERAL_PURPOSE_AGENT
  }

  private buildInitialMessages(
    agent: AgentDefinition,
    prompt: string,
    context: ToolUseContext,
  ): ConversationMessage[] {
    const systemPrompt =
      agent.source === 'built-in'
        ? agent.getSystemPrompt({ toolUseContext: context })
        : agent.getSystemPrompt()

    return [
      {
        role: 'system',
        content: [{ type: 'text', text: systemPrompt }],
      },
      {
        role: 'user',
        content: [{ type: 'text', text: prompt }],
      },
    ]
  }

  private formatToolError(error: unknown): string {
    return JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    )
  }

  private formatToolResult(value: unknown): string {
    if (typeof value === 'string') return value
    return JSON.stringify({ ok: true, result: value }, null, 2)
  }

  private previewText(value: string, max = 800): string {
    return value.length > max ? `${value.slice(0, max)}\n...[truncated]` : value
  }

  private async executeToolCall(
    name: string,
    input: unknown,
    context: ToolUseContext,
    availableTools: ToolDefinition[],
  ): Promise<string> {
    const tool = availableTools.find(candidate => candidate.name === name)
    if (!tool) {
      throw new Error(`Unknown tool '${name}'`)
    }
    const result = await tool.call(input, context)
    return this.formatToolResult(result)
  }

  private findAgentDefinitionByTask(task: AgentTask): AgentDefinition {
    return (
      this.state.agentDefinitions.allAgents.find(agent => agent.agentType === task.agentType) ??
      GENERAL_PURPOSE_AGENT
    )
  }

  private async markTaskFailed(task: AgentTask, error: unknown): Promise<void> {
    task.status = 'failed'
    task.error = error instanceof Error ? error.message : String(error)
    task.updatedAt = Date.now()
    this.emit('agent.failed', {
      taskId: task.id,
      agentId: task.agentId,
      agentType: task.agentType,
      error: task.error,
    })
    await this.autosave()
  }

  private buildAssistantMessage(response: ModelInvocationOutput): ConversationMessage {
    const blocks: MessageBlock[] = []
    if (response.text) {
      blocks.push({ type: 'text', text: response.text })
    }
    for (const toolCall of response.toolCalls ?? []) {
      blocks.push({
        type: 'tool_use',
        id: toolCall.id ?? randomUUID(),
        name: toolCall.name,
        input: toolCall.input,
      })
    }
    return {
      role: 'assistant',
      content: blocks,
    }
  }

  private async executeTask(task: AgentTask): Promise<void> {
    const agent = this.findAgentDefinitionByTask(task)
    const availableTools = this.resolveToolsForAgent(agent)
    const context = this.createContext(task.cwd, agent, availableTools)
    const maxRounds = Math.max(1, Math.min(agent.maxTurns ?? this.options.maxToolRounds ?? 8, 24))

    try {
      task.status = task.background ? 'running' : 'in_progress'
      for (let round = 0; round < maxRounds; round += 1) {
        let streamedText = ''
        const response = await this.invokeModelWithPolicy({
          model: this.normalizeModelAlias(task.model),
          messages: task.messages,
          tools: context.options.tools,
          callbacks: {
            onTextDelta: delta => {
              streamedText += delta
              task.output = streamedText
              task.updatedAt = Date.now()
              this.emit('agent.output.delta', {
                taskId: task.id,
                agentId: task.agentId,
                agentType: task.agentType,
                round: round + 1,
                delta,
                output: streamedText,
              })
            },
            onReasoningDelta: delta => {
              this.emit('agent.reasoning.delta', {
                taskId: task.id,
                agentId: task.agentId,
                agentType: task.agentType,
                round: round + 1,
                delta,
              })
            },
          },
        })

        const normalizedResponse =
          streamedText && !response.text
            ? {
                ...response,
                text: streamedText,
              }
            : response

        const assistantMessage = this.buildAssistantMessage(normalizedResponse)
        if (assistantMessage.content.length > 0) {
          task.messages.push(assistantMessage)
        }

        const toolCalls = assistantMessage.content.filter(
          (block): block is Extract<MessageBlock, { type: 'tool_use' }> => block.type === 'tool_use',
        )

        if (toolCalls.length === 0) {
          task.output = normalizedResponse.text
          task.result = normalizedResponse.text
          task.status = 'completed'
          task.updatedAt = Date.now()
          this.emit('agent.completed', {
            taskId: task.id,
            agentId: task.agentId,
            agentType: task.agentType,
            description: task.description,
          })
          await this.autosave()
          return
        }

        for (const toolCall of toolCalls) {
          this.emit('tool.called', {
            taskId: task.id,
            agentId: task.agentId,
            tool: toolCall.name,
            inputPreview: this.previewText(JSON.stringify(toolCall.input ?? {}, null, 2)),
          })

          let resultText: string
          try {
            resultText = await this.executeToolCall(
              toolCall.name,
              toolCall.input,
              context,
              availableTools,
            )
            this.emit('tool.completed', {
              taskId: task.id,
              agentId: task.agentId,
              tool: toolCall.name,
              resultPreview: this.previewText(resultText),
            })
          } catch (error) {
            resultText = this.formatToolError(error)
            this.emit('tool.failed', {
              taskId: task.id,
              agentId: task.agentId,
              tool: toolCall.name,
              error: error instanceof Error ? error.message : String(error),
              resultPreview: this.previewText(resultText),
            })
          }

          task.messages.push({
            role: 'tool',
            content: [
              {
                type: 'tool_result',
                tool_use_id: toolCall.id,
                content: resultText,
              },
            ],
          })
        }

        task.updatedAt = Date.now()
        await this.autosave()
      }

      throw new Error(`Max tool rounds exceeded (${maxRounds})`)
    } catch (error) {
      await this.markTaskFailed(task, error)
      throw error
    }
  }

  private async invokeModelWithPolicy(input: Parameters<ModelInvoker>[0]): Promise<ModelInvocationOutput> {
    if (!this.modelLimiter.consume('global')) {
      throw new Error('Runtime LLM rate limit exceeded')
    }

    const llmSecurity = this.options.security?.llm
    return this.modelGate.run(() =>
      withRetries(
        {
          label: 'runtime-model-invocation',
          retries: Math.max(0, llmSecurity?.maxRetries ?? 0),
          baseDelayMs: llmSecurity?.baseDelayMs ?? 250,
          maxDelayMs: llmSecurity?.maxDelayMs ?? 2_000,
          shouldRetry: error =>
            /timeout|timed out|HTTP 408|HTTP 409|HTTP 429|HTTP 5\d\d|fetch failed|aborted|ECONN/i.test(
              error instanceof Error ? error.message : String(error),
            ),
        },
        async () => this.invokeModel(input),
      ),
    )
  }

  async spawnAgent(input: {
    description: string
    prompt: string
    subagent_type?: string
    model?: string
    run_in_background?: boolean
    name?: string
    team_name?: string
    mode?: string
    isolation?: 'worktree' | 'remote'
    cwd?: string
    fork?: boolean
  }): Promise<AgentTask> {
    this.enforceTaskQuota()
    const cwd = input.cwd ?? process.cwd()
    const selectedAgent = this.resolveSpawnedAgent(input)
    const context = this.createContext(cwd, selectedAgent)
    const taskId = randomUUID()
    const agentId = input.name ?? randomUUID()
    const now = Date.now()
    const messages = this.buildInitialMessages(selectedAgent, input.prompt, context)

    const task: AgentTask = {
      id: taskId,
      agentId,
      type: 'local_agent',
      agentType: selectedAgent.agentType,
      description: input.description,
      prompt: input.prompt,
      status: input.run_in_background ? 'running' : 'in_progress',
      output: '',
      createdAt: now,
      updatedAt: now,
      background: input.run_in_background,
      name: input.name,
      teamName: input.team_name,
      cwd,
      model: input.model ?? String(selectedAgent.model ?? this.options.models.defaultSubagent),
      messages,
    }

    this.state.agentTasks.set(taskId, task)
    this.emit('agent.spawned', {
      taskId,
      agentId,
      agentType: selectedAgent.agentType,
      description: input.description,
      background: Boolean(input.run_in_background),
    })
    await this.autosave()

    if (input.run_in_background) {
      void this.executeTask(task).catch(() => {})
    } else {
      await this.executeTask(task)
    }

    return task
  }

  async continueAgent(target: string, message: string): Promise<AgentTask> {
    const task = (Array.from(this.state.agentTasks.values()) as AgentTask[]).find(
      (candidate: AgentTask) => candidate.agentId === target || candidate.name === target,
    )

    if (!task) {
      throw new Error(`No agent found for '${target}'`)
    }

    task.messages.push({
      role: 'user',
      content: [{ type: 'text', text: message }],
    })
    task.status = task.background ? 'running' : 'in_progress'
    task.updatedAt = Date.now()
    this.emit('agent.continued', {
      taskId: task.id,
      agentId: task.agentId,
      agentType: task.agentType,
    })
    await this.autosave()

    if (task.background) {
      void this.executeTask(task).catch(() => {})
    } else {
      await this.executeTask(task)
    }

    return task
  }

  async waitForTask(taskId: string, timeoutMs = 30000): Promise<AgentTask> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const task = this.state.agentTasks.get(taskId)
      if (!task) {
        throw new Error(`Task '${taskId}' not found`)
      }
      if (!['running', 'in_progress', 'pending'].includes(task.status)) {
        return task
      }
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    const task = this.state.agentTasks.get(taskId)
    if (!task) {
      throw new Error(`Task '${taskId}' not found after wait`)
    }
    return task
  }

  findTask(taskId: string): AgentTask | undefined {
    return this.state.agentTasks.get(taskId)
  }

  createTeam(input: {
    team_name: string
    description?: string
    agent_type?: string
  }): TeamRecord {
    if (!this.state.teams.has(input.team_name)) {
      this.enforceTeamQuota()
    }
    const leadAgentId = `${TEAM_LEAD_NAME}@${input.team_name}`
    const team: TeamRecord = {
      name: input.team_name,
      description: input.description,
      createdAt: Date.now(),
      leadAgentId,
      members: [
        {
          agentId: leadAgentId,
          name: TEAM_LEAD_NAME,
          agentType: input.agent_type ?? TEAM_LEAD_NAME,
          joinedAt: Date.now(),
          isActive: true,
        },
      ],
    }

    this.state.teams.set(team.name, team)
    this.emit('team.created', {
      teamName: team.name,
      leadAgentId,
    })
    void this.autosave()
    return team
  }

  deleteTeam(name: string): boolean {
    const deleted = this.state.teams.delete(name)
    if (deleted) {
      this.emit('team.deleted', { teamName: name })
      void this.autosave()
    }
    return deleted
  }

  snapshotState(): RuntimeSnapshot {
    return {
      agentTasks: Array.from(this.state.agentTasks.values()),
      taskRecords: Array.from(this.state.taskRecords.values()),
      teams: Array.from(this.state.teams.values()),
      events: this.events.snapshot(),
    }
  }

  async restoreFromPersistence(): Promise<boolean> {
    if (!this.options.persistenceDir) return false
    const snapshot = await loadSessionSnapshot(this.options.persistenceDir)
    if (!snapshot) return false
    this.loadSnapshot(snapshot)
    return true
  }

  loadSnapshot(snapshot: RuntimeSnapshot): void {
    this.state.agentTasks.clear()
    this.state.taskRecords.clear()
    this.state.teams.clear()
    this.events.loadHistory(snapshot.events ?? [])
    for (const task of snapshot.agentTasks) this.state.agentTasks.set(task.id, task)
    for (const task of snapshot.taskRecords) this.state.taskRecords.set(task.id, task)
    for (const team of snapshot.teams) this.state.teams.set(team.name, team)
    this.emit('runtime.restored', {
      agentTasks: snapshot.agentTasks.length,
      taskRecords: snapshot.taskRecords.length,
      teams: snapshot.teams.length,
    })
  }
}
