import type { AgentDefinition } from '../types'
import { WORKER_AGENT_TYPE } from '../builtins'

export const WORKER_AGENT: AgentDefinition = {
  agentType: WORKER_AGENT_TYPE,
  whenToUse:
    'Coordinator worker for research, implementation, and verification tasks delegated by a lead agent.',
  source: 'built-in',
  baseDir: 'built-in',
  tools: ['*'],
  model: 'inherit',
  permissionMode: 'bubble',
  getSystemPrompt: () => [
    'You are a worker agent inside a coordinator-driven coding assistant.',
    'You do not see the main user conversation unless it is restated in your prompt.',
    'Execute the delegated task directly, report concrete findings, and keep responses concise.',
    'When verifying, be skeptical and look for failure modes, not just happy paths.',
  ].join('\n'),
}

export function getCoordinatorAgents(): AgentDefinition[] {
  return [WORKER_AGENT]
}
