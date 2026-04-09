import { z } from 'zod'
import type { AgentRuntime } from '../runtime'

export const StructuredMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('shutdown_request'),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal('shutdown_response'),
    request_id: z.string(),
    approve: z.union([z.boolean(), z.literal('true'), z.literal('false')]),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal('plan_approval_response'),
    request_id: z.string(),
    approve: z.union([z.boolean(), z.literal('true'), z.literal('false')]),
    feedback: z.string().optional(),
  }),
])

export const SendMessageToolInputSchema = z.object({
  to: z.string().describe('Recipient agent ID, name, or broadcast target'),
  summary: z
    .string()
    .optional()
    .describe('A short preview shown in the UI'),
  message: z.union([
    z.string().describe('Plain text message content'),
    StructuredMessageSchema,
  ]),
})

export type SendMessageToolInput = z.infer<typeof SendMessageToolInputSchema>

export type SendMessageToolOutput = {
  success: boolean
  message: string
}

export async function runSendMessageTool(
  runtime: AgentRuntime,
  input: SendMessageToolInput,
): Promise<SendMessageToolOutput> {
  const payload =
    typeof input.message === 'string'
      ? input.message
      : JSON.stringify(input.message)

  await runtime.continueAgent(input.to, payload)

  return {
    success: true,
    message: `Message sent to agent '${input.to}'`,
  }
}
