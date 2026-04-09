import type { AgentTask } from '../types'

export function formatAgentTask(task: AgentTask): string {
  const name = task.name ? ` (${task.name})` : ''
  return [
    `Agent task: ${task.id}`,
    `Type: ${task.agentType}${name}`,
    `Status: ${task.status}`,
    `Description: ${task.description}`,
    task.result ? `Result: ${task.result}` : undefined,
  ]
    .filter(Boolean)
    .join('\n')
}
