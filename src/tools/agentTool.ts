import { z } from 'zod'
import type { AgentRuntime } from '../runtime'
import type { AgentTask } from '../types'

export const AgentToolInputSchema = z.object({
  description: z.string().describe('A short (3-5 word) description of the task'),
  prompt: z.string().describe('The task for the agent to perform'),
  subagent_type: z
    .string()
    .optional()
    .describe('The type of specialized agent to use for this task'),
  model: z
    .enum(['sonnet', 'opus', 'haiku'])
    .optional()
    .describe('Optional model override for this agent'),
  run_in_background: z
    .boolean()
    .optional()
    .describe('Set to true to run this agent in the background'),
  name: z
    .string()
    .optional()
    .describe('Name for the spawned agent'),
  team_name: z
    .string()
    .optional()
    .describe('Team name for spawning'),
  mode: z
    .enum(['default', 'plan', 'acceptEdits', 'dontAsk', 'bubble'])
    .optional()
    .describe('Permission mode for the spawned agent'),
  isolation: z
    .enum(['worktree', 'remote'])
    .optional()
    .describe('Isolation mode for the spawned agent'),
  cwd: z
    .string()
    .optional()
    .describe('Absolute path to run the agent in'),
})

export type AgentToolInput = z.infer<typeof AgentToolInputSchema>

export const AgentToolSyncOutputSchema = z.object({
  status: z.literal('completed'),
  prompt: z.string(),
  result: z.string(),
})

export const AgentToolAsyncOutputSchema = z.object({
  status: z.literal('async_launched'),
  agentId: z.string(),
  description: z.string(),
  prompt: z.string(),
  outputFile: z.string(),
  canReadOutputFile: z.boolean().optional(),
})

export const AgentToolOutputSchema = z.union([
  AgentToolSyncOutputSchema,
  AgentToolAsyncOutputSchema,
])

export type AgentToolOutput = z.infer<typeof AgentToolOutputSchema>

export async function runAgentTool(
  runtime: AgentRuntime,
  input: AgentToolInput,
): Promise<AgentToolOutput> {
  const task: AgentTask = await runtime.spawnAgent(input)

  if (input.run_in_background) {
    return {
      status: 'async_launched',
      agentId: task.agentId,
      description: task.description,
      prompt: task.prompt,
      outputFile: `memory://tasks/${task.id}`,
      canReadOutputFile: true,
    }
  }

  return {
    status: 'completed',
    prompt: task.prompt,
    result: task.result ?? '',
  }
}
