import type { ModelInvocationInput, ModelInvocationOutput, ModelInvoker } from './types'

function getLastUserText(input: ModelInvocationInput): string {
  const userMessages = input.messages.filter(
    (message: ModelInvocationInput['messages'][number]) => message.role === 'user',
  )
  const last = userMessages[userMessages.length - 1]
  if (!last) return ''
  return last.content
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map(block => block.text)
    .join('\n')
}

export const mockModelInvoker: ModelInvoker = async (
  input: ModelInvocationInput,
): Promise<ModelInvocationOutput> => {
  const lastUserText = getLastUserText(input)
  const firstSystem = input.messages.find(
    (message: ModelInvocationInput['messages'][number]) => message.role === 'system',
  )
  const systemText =
    firstSystem?.content
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map(block => block.text)
      .join('\n') ?? ''

  let role = 'agent'
  if (systemText.includes('read-only code exploration')) role = 'Explore'
  if (systemText.includes('read-only planning')) role = 'Plan'
  if (systemText.includes('verification specialist')) role = 'verification'
  if (systemText.includes('documentation guide')) role = 'claude-code-guide'
  if (systemText.includes('status line setup')) role = 'statusline-setup'
  if (systemText.includes('worker agent')) role = 'worker'

  const text = [
      `[mock:${role}]`,
      `model=${input.model}`,
      `tools=${input.tools.map((tool: { name: string }) => tool.name).join(', ') || 'none'}`,
      `request=${lastUserText || 'empty'}`,
      role === 'verification' ? 'VERDICT: PASS' : 'completed',
    ].join('\n')

  input.callbacks?.onTextDelta?.(text)

  return {
    text,
  }
}
