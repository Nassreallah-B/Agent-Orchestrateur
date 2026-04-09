export type ModelId = 'sonnet' | 'opus' | 'haiku' | 'inherit'
export type AgentColorName =
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'blue'
  | 'cyan'
  | 'pink'
  | 'gray'
export type PermissionMode =
  | 'default'
  | 'plan'
  | 'acceptEdits'
  | 'dontAsk'
  | 'bubble'
export type AgentMemoryScope = 'user' | 'project' | 'local'
export type IsolationMode = 'worktree' | 'remote'
export type EffortValue = 'low' | 'medium' | 'high' | number
export type AgentSource =
  | 'built-in'
  | 'plugin'
  | 'userSettings'
  | 'projectSettings'
  | 'policySettings'
  | 'flagSettings'

export type HookDefinition = {
  name: string
  event: string
  command: string
}

export type McpServerConfig = {
  transport: 'stdio' | 'http' | 'sse' | 'ws'
  command?: string
  args?: string[]
  cwd?: string
  url?: string
  headers?: Record<string, string>
  timeoutMs?: number
  retries?: number
  requestsPerMinute?: number
  isolationProfile?: string
}

export type AgentMcpServerSpec =
  | string
  | { [name: string]: McpServerConfig }

export type BaseAgentDefinition = {
  agentType: string
  whenToUse: string
  tools?: string[]
  disallowedTools?: string[]
  skills?: string[]
  mcpServers?: AgentMcpServerSpec[]
  hooks?: HookDefinition[]
  color?: AgentColorName
  model?: ModelId | string
  effort?: EffortValue
  permissionMode?: PermissionMode
  maxTurns?: number
  filename?: string
  baseDir?: string
  criticalSystemReminder_EXPERIMENTAL?: string
  requiredMcpServers?: string[]
  background?: boolean
  initialPrompt?: string
  memory?: AgentMemoryScope
  isolation?: IsolationMode
  pendingSnapshotUpdate?: { snapshotTimestamp: string }
  omitClaudeMd?: boolean
}

export type BuiltInAgentDefinition = BaseAgentDefinition & {
  source: 'built-in'
  baseDir: 'built-in'
  callback?: () => void
  getSystemPrompt: (params: {
    toolUseContext: Pick<ToolUseContext, 'options'>
  }) => string
}

export type CustomAgentDefinition = BaseAgentDefinition & {
  source: Exclude<AgentSource, 'built-in' | 'plugin'>
  getSystemPrompt: () => string
}

export type PluginAgentDefinition = BaseAgentDefinition & {
  source: 'plugin'
  plugin: string
  getSystemPrompt: () => string
}

export type AgentDefinition =
  | BuiltInAgentDefinition
  | CustomAgentDefinition
  | PluginAgentDefinition

export type AgentDefinitionsResult = {
  activeAgents: AgentDefinition[]
  allAgents: AgentDefinition[]
  failedFiles?: Array<{ path: string; error: string }>
  allowedAgentTypes?: string[]
}

export type ToolDefinition<Input = unknown, Output = unknown> = {
  name: string
  description: string
  inputSchema?: unknown
  call: (input: Input, context: ToolUseContext) => Promise<Output>
}

export type ToolRegistry = Map<string, ToolDefinition<any, any>>

export type MessageBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string }

export type ConversationMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: MessageBlock[]
}

export type TaskStatus =
  | 'pending'
  | 'running'
  | 'in_progress'
  | 'completed'
  | 'blocked'
  | 'failed'
  | 'stopped'

export type TaskType = 'local_agent' | 'remote_agent' | 'local_bash'

export type AgentTask = {
  id: string
  agentId: string
  type: TaskType
  agentType: string
  description: string
  prompt: string
  status: TaskStatus
  output: string
  result?: string
  error?: string
  createdAt: number
  updatedAt: number
  background?: boolean
  name?: string
  teamName?: string
  cwd: string
  model?: string
  messages: ConversationMessage[]
}

export type TaskRecord = {
  id: string
  subject: string
  description: string
  status: Exclude<TaskStatus, 'running' | 'stopped'>
  blocks: string[]
  blockedBy: string[]
  owner?: string
  metadata?: Record<string, unknown>
  activeForm?: string
}

export type TeamMember = {
  agentId: string
  name: string
  agentType?: string
  model?: string
  joinedAt: number
  cwd?: string
  isActive?: boolean
}

export type TeamRecord = {
  name: string
  description?: string
  createdAt: number
  leadAgentId: string
  members: TeamMember[]
}

export type PersistedRuntimeEvent = {
  type: string
  timestamp: number
  payload?: Record<string, unknown>
}

export type RuntimeSnapshot = {
  agentTasks: AgentTask[]
  taskRecords: TaskRecord[]
  teams: TeamRecord[]
  events?: PersistedRuntimeEvent[]
}

export type McpProfile = {
  name: string
  description?: string
  connections: Array<{
    name: string
    config: McpServerConfig
  }>
}

export type McpProfileStore = {
  activeProfile?: string | null
  profiles: McpProfile[]
}

export type RuntimeOptions = {
  models: {
    defaultMain: string
    defaultSubagent: string
    aliases?: Record<string, string>
  }
  featureFlags?: Record<string, boolean>
  persistenceDir?: string
  maxToolRounds?: number
  provider?: {
    name: string
    baseUrl?: string
    model?: string
  }
  security?: RuntimeSecurityOptions
  logging?: LoggingOptions
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type ServiceResilienceOptions = {
  timeoutMs?: number
  maxRetries?: number
  baseDelayMs?: number
  maxDelayMs?: number
  requestsPerMinute?: number
  concurrency?: number
}

export type ShellSecurityOptions = {
  enabled?: boolean
  allowedCommands?: string[]
  blockedPatterns?: string[]
  maxTimeoutMs?: number
  maxStdoutBytes?: number
  maxStderrBytes?: number
  sanitizeEnv?: boolean
}

export type IsolationProvider = 'none' | 'docker' | 'firejail' | 'bubblewrap'

export type HostFallbackMode = 'error' | 'warn' | 'allow'

export type ProcessIsolationProfile = {
  name: string
  provider: IsolationProvider
  image?: string
  network?: 'none' | 'bridge' | 'host'
  workspaceMountPath?: string
  workspaceReadOnly?: boolean
  extraArgs?: string[]
  commandMap?: Record<string, string>
  hostFallback?: HostFallbackMode
  envAllowList?: string[]
}

export type ProcessIsolationOptions = {
  profiles?: Record<string, ProcessIsolationProfile>
  defaultShellProfile?: string
  defaultMcpProfile?: string
  detectedProviders?: Partial<Record<IsolationProvider, boolean>>
}

export type FilesystemSecurityOptions = {
  allowedRoots?: string[]
  denyPathPatterns?: string[]
  maxReadBytes?: number
  maxWriteBytes?: number
}

export type RemoteSecurityOptions = {
  requireToken?: boolean
  allowQueryTokenBootstrap?: boolean
  maxBodyBytes?: number
  requestsPerMinute?: number
  mutationRequestsPerMinute?: number
  trustedOrigins?: string[]
  sessionTtlMs?: number
}

export type QuotaOptions = {
  maxStoredTasks?: number
  maxConcurrentTasks?: number
  maxTeams?: number
}

export type RuntimeSecurityOptions = {
  shell?: ShellSecurityOptions
  filesystem?: FilesystemSecurityOptions
  remote?: RemoteSecurityOptions
  llm?: ServiceResilienceOptions
  processIsolation?: ProcessIsolationOptions
  mcp?: ServiceResilienceOptions & {
    allowedTransports?: Array<McpServerConfig['transport']>
  }
  quotas?: QuotaOptions
  redactKeys?: string[]
}

export type LoggingOptions = {
  level?: LogLevel
  console?: boolean
  filePath?: string
  auditFilePath?: string
}

export type ModelInvocationCallbacks = {
  onTextDelta?: (delta: string) => void
  onReasoningDelta?: (delta: string) => void
}

export type ModelInvocationInput = {
  model: string
  messages: ConversationMessage[]
  tools: Array<{ name: string; description: string; inputSchema?: unknown }>
  callbacks?: ModelInvocationCallbacks
}

export type ModelInvocationOutput = {
  text: string
  toolCalls?: Array<{ id?: string; name: string; input: unknown }>
}

export type ModelInvoker = (
  input: ModelInvocationInput,
) => Promise<ModelInvocationOutput>

export type RuntimeState = {
  agentDefinitions: AgentDefinitionsResult
  toolRegistry: ToolRegistry
  agentTasks: Map<string, AgentTask>
  taskRecords: Map<string, TaskRecord>
  teams: Map<string, TeamRecord>
}

export type ToolUseContext = {
  state: RuntimeState
  options: {
    cwd: string
    tools: Array<{ name: string; description: string; inputSchema?: unknown }>
    agentDefinitions: AgentDefinitionsResult
    security?: RuntimeSecurityOptions
  }
  runtime: {
    invokeModel: ModelInvoker
    generateId: () => string
    now: () => number
    spawnAgent: (input: {
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
    }) => Promise<AgentTask>
    continueAgent: (target: string, message: string) => Promise<AgentTask>
    waitForTask: (taskId: string, timeoutMs?: number) => Promise<AgentTask>
    createTeam: (input: {
      team_name: string
      description?: string
      agent_type?: string
    }) => TeamRecord
    deleteTeam: (name: string) => boolean
    findTask: (taskId: string) => AgentTask | undefined
    listMcpServers?: () => Array<{
      name: string
      transport: string
      initialized: boolean
      toolCount: number
    }>
    listMcpConnections?: () => Array<{
      name: string
      transport: string
      initialized: boolean
      tools: McpToolInfo[]
    }>
    refreshMcpTools?: (name: string) => Promise<McpToolInfo[]>
    callMcpTool?: (server: string, toolName: string, input: unknown) => Promise<unknown>
  }
}

export type McpToolInfo = {
  name: string
  description?: string
  inputSchema?: unknown
}

export function isBuiltInAgent(
  agent: AgentDefinition,
): agent is BuiltInAgentDefinition {
  return agent.source === 'built-in'
}

export function isCustomAgent(
  agent: AgentDefinition,
): agent is CustomAgentDefinition {
  return agent.source !== 'built-in' && agent.source !== 'plugin'
}

export function isPluginAgent(
  agent: AgentDefinition,
): agent is PluginAgentDefinition {
  return agent.source === 'plugin'
}
