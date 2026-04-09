import type { AgentRuntime } from '../runtime'
import type { AgentTask, TeamRecord, TaskRecord } from '../types'

function pad(value: string, width: number): string {
  return value.length >= width ? value.slice(0, width) : value + ' '.repeat(width - value.length)
}

export function renderDashboard(runtime: AgentRuntime): string {
  const agents = Array.from(runtime.state.agentTasks.values()) as AgentTask[]
  const teams = Array.from(runtime.state.teams.values()) as TeamRecord[]
  const tasks = Array.from(runtime.state.taskRecords.values()) as TaskRecord[]

  const running = agents.filter(agent => ['running', 'in_progress'].includes(agent.status)).length
  const completed = agents.filter(agent => agent.status === 'completed').length
  const failed = agents.filter(agent => agent.status === 'failed').length

  const lines: string[] = []
  lines.push('=== Dashboard ===')
  lines.push(
    `Provider: ${runtime.options.provider?.name ?? 'unknown'} · main=${runtime.options.models.defaultMain} · sub=${runtime.options.models.defaultSubagent}`,
  )
  lines.push(`Agents: total=${agents.length} running=${running} completed=${completed} failed=${failed}`)
  lines.push(`Teams: ${teams.length}`)
  lines.push(`Task records: ${tasks.length}`)
  lines.push(`Tools: ${runtime.listToolDefinitions().length}`)
  lines.push('')
  lines.push(pad('Agent', 24) + pad('Type', 18) + pad('Status', 14) + 'Description')
  lines.push('-'.repeat(90))
  for (const agent of agents.slice(-10)) {
    lines.push(
      pad(agent.name ?? agent.agentId, 24) +
        pad(agent.agentType, 18) +
        pad(agent.status, 14) +
        agent.description,
    )
  }
  if (agents.length === 0) {
    lines.push('No agents yet.')
  }
  return lines.join('\n')
}
