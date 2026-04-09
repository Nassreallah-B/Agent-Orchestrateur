import {
  getBuiltInAgents,
} from './builtins'
import type {
  AgentDefinition,
  AgentDefinitionsResult,
  CustomAgentDefinition,
  PluginAgentDefinition,
} from './types'

export function getActiveAgentsFromList(
  allAgents: AgentDefinition[],
): AgentDefinition[] {
  const builtInAgents = allAgents.filter(a => a.source === 'built-in')
  const pluginAgents = allAgents.filter(a => a.source === 'plugin')
  const userAgents = allAgents.filter(a => a.source === 'userSettings')
  const projectAgents = allAgents.filter(a => a.source === 'projectSettings')
  const managedAgents = allAgents.filter(a => a.source === 'policySettings')
  const flagAgents = allAgents.filter(a => a.source === 'flagSettings')

  const groups = [
    builtInAgents,
    pluginAgents,
    userAgents,
    projectAgents,
    flagAgents,
    managedAgents,
  ]

  const map = new Map<string, AgentDefinition>()
  for (const group of groups) {
    for (const agent of group) {
      map.set(agent.agentType, agent)
    }
  }
  return Array.from(map.values())
}

export function loadAgentDefinitions(input?: {
  builtIn?: AgentDefinition[]
  pluginAgents?: PluginAgentDefinition[]
  customAgents?: CustomAgentDefinition[]
}): AgentDefinitionsResult {
  const builtIn = input?.builtIn ?? getBuiltInAgents()
  const pluginAgents = input?.pluginAgents ?? []
  const customAgents = input?.customAgents ?? []

  const allAgents = [...builtIn, ...pluginAgents, ...customAgents]
  const activeAgents = getActiveAgentsFromList(allAgents)

  return {
    activeAgents,
    allAgents,
  }
}

export function parseAgentsFromJson(
  json: Record<string, any>,
  source: CustomAgentDefinition['source'] = 'flagSettings',
): CustomAgentDefinition[] {
  return Object.entries(json).map(([agentType, value]) => ({
    agentType,
    whenToUse: String(value.description ?? ''),
    tools: Array.isArray(value.tools) ? value.tools : undefined,
    disallowedTools: Array.isArray(value.disallowedTools)
      ? value.disallowedTools
      : undefined,
    skills: Array.isArray(value.skills) ? value.skills : undefined,
    color: value.color,
    model: value.model,
    effort: value.effort,
    permissionMode: value.permissionMode,
    maxTurns: value.maxTurns,
    background: value.background,
    memory: value.memory,
    isolation: value.isolation,
    initialPrompt: value.initialPrompt,
    source,
    getSystemPrompt: () => String(value.prompt ?? ''),
  }))
}

export function parseAgentFromMarkdown(
  frontmatter: Record<string, unknown>,
  body: string,
  source: CustomAgentDefinition['source'] = 'projectSettings',
): CustomAgentDefinition | null {
  if (!frontmatter.name || !frontmatter.description) {
    return null
  }

  return {
    agentType: String(frontmatter.name),
    whenToUse: String(frontmatter.description),
    tools: Array.isArray(frontmatter.tools)
      ? frontmatter.tools.map(String)
      : undefined,
    disallowedTools: Array.isArray(frontmatter.disallowedTools)
      ? frontmatter.disallowedTools.map(String)
      : undefined,
    skills: Array.isArray(frontmatter.skills)
      ? frontmatter.skills.map(String)
      : undefined,
    color: frontmatter.color as any,
    model: frontmatter.model as any,
    effort: frontmatter.effort as any,
    permissionMode: frontmatter.permissionMode as any,
    maxTurns:
      typeof frontmatter.maxTurns === 'number'
        ? frontmatter.maxTurns
        : undefined,
    background:
      typeof frontmatter.background === 'boolean'
        ? frontmatter.background
        : undefined,
    memory: frontmatter.memory as any,
    isolation: frontmatter.isolation as any,
    initialPrompt:
      typeof frontmatter.initialPrompt === 'string'
        ? frontmatter.initialPrompt
        : undefined,
    source,
    getSystemPrompt: () => body.trim(),
  }
}
