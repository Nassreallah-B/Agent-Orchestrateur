import type {
  AgentDefinition,
  BuiltInAgentDefinition,
  ToolUseContext,
} from './types'

export const TEAM_LEAD_NAME = 'team-lead'
export const WORKER_AGENT_TYPE = 'worker'
export const FORK_SUBAGENT_TYPE = 'fork'
export const CLAUDE_CODE_GUIDE_AGENT_TYPE = 'claude-code-guide'

function generalPurposePrompt(): string {
  return [
    'You are a general-purpose agent for a coding assistant.',
    'Search broadly, analyze multiple files, and complete the task end-to-end.',
    'Do not gold-plate. Do not leave the work half-done.',
  ].join('\n')
}

function explorePrompt(): string {
  return [
    'You are a read-only code exploration agent.',
    'Find files, search for patterns, and report findings quickly.',
    'Do not modify files.',
  ].join('\n')
}

function planPrompt(): string {
  return [
    'You are a read-only planning agent.',
    'Explore the codebase and produce an implementation plan.',
    'List critical files and execution order.',
  ].join('\n')
}

function verificationPrompt(): string {
  return [
    'You are a verification specialist.',
    'Your job is to test and try to break the implementation.',
    'End with VERDICT: PASS, VERDICT: FAIL, or VERDICT: PARTIAL.',
  ].join('\n')
}

function guidePrompt(): string {
  return [
    'You are a product and documentation guide agent.',
    'Answer questions about the CLI, SDK, API, settings, hooks, skills, and MCP.',
    'Prioritize official documentation and concrete guidance.',
  ].join('\n')
}

function statuslinePrompt(): string {
  return [
    'You are a status line setup agent.',
    'Create or update the user status line configuration.',
    'Preserve existing settings when possible.',
  ].join('\n')
}

export const GENERAL_PURPOSE_AGENT: BuiltInAgentDefinition = {
  agentType: 'general-purpose',
  whenToUse:
    'General-purpose agent for multi-step code search, analysis, and execution.',
  tools: ['*'],
  source: 'built-in',
  baseDir: 'built-in',
  getSystemPrompt: () => generalPurposePrompt(),
}

export const EXPLORE_AGENT: BuiltInAgentDefinition = {
  agentType: 'Explore',
  whenToUse:
    'Fast read-only agent specialized for searching codebases and answering codebase questions.',
  source: 'built-in',
  baseDir: 'built-in',
  disallowedTools: ['Agent', 'Edit', 'Write', 'NotebookEdit', 'ExitPlanMode'],
  model: 'haiku',
  omitClaudeMd: true,
  getSystemPrompt: () => explorePrompt(),
}

export const PLAN_AGENT: BuiltInAgentDefinition = {
  agentType: 'Plan',
  whenToUse:
    'Read-only software architect agent for implementation plans and critical files.',
  source: 'built-in',
  baseDir: 'built-in',
  model: 'inherit',
  omitClaudeMd: true,
  disallowedTools: ['Agent', 'Edit', 'Write', 'NotebookEdit', 'ExitPlanMode'],
  getSystemPrompt: () => planPrompt(),
}

export const VERIFICATION_AGENT: BuiltInAgentDefinition = {
  agentType: 'verification',
  whenToUse:
    'Verification agent for builds, tests, linters, regressions, and adversarial checks.',
  source: 'built-in',
  baseDir: 'built-in',
  color: 'red',
  background: true,
  model: 'inherit',
  disallowedTools: ['Agent', 'Edit', 'Write', 'NotebookEdit', 'ExitPlanMode'],
  criticalSystemReminder_EXPERIMENTAL:
    'Verification-only task. End with VERDICT: PASS, FAIL, or PARTIAL.',
  getSystemPrompt: () => verificationPrompt(),
}

export const CLAUDE_CODE_GUIDE_AGENT: BuiltInAgentDefinition = {
  agentType: CLAUDE_CODE_GUIDE_AGENT_TYPE,
  whenToUse:
    'Guide agent for CLI, SDK, API, docs, hooks, skills, plugins, and settings.',
  source: 'built-in',
  baseDir: 'built-in',
  model: 'haiku',
  permissionMode: 'dontAsk',
  tools: ['Read', 'WebFetch', 'WebSearch'],
  getSystemPrompt: (_params: {
    toolUseContext: Pick<ToolUseContext, 'options'>
  }) => guidePrompt(),
}

export const STATUSLINE_SETUP_AGENT: BuiltInAgentDefinition = {
  agentType: 'statusline-setup',
  whenToUse: 'Configure the user status line setting.',
  source: 'built-in',
  baseDir: 'built-in',
  model: 'sonnet',
  color: 'orange',
  tools: ['Read', 'Edit'],
  getSystemPrompt: () => statuslinePrompt(),
}

export const FORK_AGENT: BuiltInAgentDefinition = {
  agentType: FORK_SUBAGENT_TYPE,
  whenToUse:
    'Implicit fork that inherits full parent context when subagent_type is omitted.',
  tools: ['*'],
  maxTurns: 200,
  model: 'inherit',
  permissionMode: 'bubble',
  source: 'built-in',
  baseDir: 'built-in',
  getSystemPrompt: () => '',
}

export function getBuiltInAgents(options?: {
  enableExplorePlan?: boolean
  includeGuide?: boolean
  includeVerification?: boolean
}): AgentDefinition[] {
  const agents: AgentDefinition[] = [
    GENERAL_PURPOSE_AGENT,
    STATUSLINE_SETUP_AGENT,
  ]

  if (options?.enableExplorePlan ?? true) {
    agents.push(EXPLORE_AGENT, PLAN_AGENT)
  }

  if (options?.includeGuide ?? true) {
    agents.push(CLAUDE_CODE_GUIDE_AGENT)
  }

  if (options?.includeVerification ?? true) {
    agents.push(VERIFICATION_AGENT)
  }

  return agents
}
