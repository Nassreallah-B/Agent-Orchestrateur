import { z } from 'zod'
import type { AgentRuntime } from '../runtime'
import { TEAM_LEAD_NAME } from '../builtins'

export const TeamCreateInputSchema = z.strictObject({
  team_name: z.string(),
  description: z.string().optional(),
  agent_type: z.string().optional(),
})

export const TeamDeleteInputSchema = z.strictObject({})

export function createTeam(
  runtime: AgentRuntime,
  input: z.infer<typeof TeamCreateInputSchema>,
) {
  return runtime.createTeam(input)
}

export function deleteCurrentTeam(runtime: AgentRuntime, teamName: string) {
  const deleted = runtime.deleteTeam(teamName)
  return {
    success: deleted,
    message: deleted
      ? `Cleaned up team '${teamName}'`
      : `No team '${teamName}' found`,
  }
}

export function makeLeadAgentId(teamName: string): string {
  return `${TEAM_LEAD_NAME}@${teamName}`
}
