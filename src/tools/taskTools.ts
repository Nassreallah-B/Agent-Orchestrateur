import { z } from 'zod'
import type { AgentRuntime } from '../runtime'
import type { TaskRecord } from '../types'

export const TaskCreateInputSchema = z.strictObject({
  subject: z.string(),
  description: z.string(),
  activeForm: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const TaskGetInputSchema = z.strictObject({
  taskId: z.string(),
})

export const TaskListInputSchema = z.strictObject({})

export const TaskOutputInputSchema = z.strictObject({
  task_id: z.string(),
  block: z.boolean().default(true),
  timeout: z.number().min(0).max(600000).default(30000),
})

export const TaskStopInputSchema = z.strictObject({
  task_id: z.string().optional(),
  shell_id: z.string().optional(),
})

export const TaskUpdateInputSchema = z.strictObject({
  taskId: z.string(),
  subject: z.string().optional(),
  description: z.string().optional(),
  activeForm: z.string().optional(),
  status: z
    .enum(['pending', 'in_progress', 'completed', 'blocked', 'failed', 'deleted'])
    .optional(),
  addBlocks: z.array(z.string()).optional(),
  addBlockedBy: z.array(z.string()).optional(),
  owner: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export function createTask(
  runtime: AgentRuntime,
  input: z.infer<typeof TaskCreateInputSchema>,
): TaskRecord {
  const id = `task-${runtime.state.taskRecords.size + 1}`
  const task: TaskRecord = {
    id,
    subject: input.subject,
    description: input.description,
    status: 'pending',
    blocks: [],
    blockedBy: [],
    owner: undefined,
    metadata: input.metadata,
    activeForm: input.activeForm,
  }
  runtime.state.taskRecords.set(id, task)
  return task
}

export function getTask(
  runtime: AgentRuntime,
  taskId: string,
): TaskRecord | null {
  return runtime.state.taskRecords.get(taskId) ?? null
}

export function listTasks(runtime: AgentRuntime): TaskRecord[] {
  return Array.from(runtime.state.taskRecords.values())
}

export function getTaskOutput(
  runtime: AgentRuntime,
  taskId: string,
): { task_id: string; output: string } | null {
  const task = runtime.state.agentTasks.get(taskId)
  if (!task) return null
  return {
    task_id: task.id,
    output: task.output,
  }
}

export function stopTask(
  runtime: AgentRuntime,
  input: z.infer<typeof TaskStopInputSchema>,
): { success: boolean; task_id?: string; message: string } {
  const id = input.task_id ?? input.shell_id
  if (!id) {
    return { success: false, message: 'Missing task_id' }
  }

  const task = runtime.state.agentTasks.get(id)
  if (!task) {
    return { success: false, message: `No task found for '${id}'` }
  }

  task.status = 'stopped'
  task.updatedAt = Date.now()
  return {
    success: true,
    task_id: id,
    message: `Stopped task '${id}'`,
  }
}

export function updateTask(
  runtime: AgentRuntime,
  input: z.infer<typeof TaskUpdateInputSchema>,
): { success: boolean; taskId: string; updatedFields: string[] } {
  const task = runtime.state.taskRecords.get(input.taskId)
  if (!task) {
    return { success: false, taskId: input.taskId, updatedFields: [] }
  }

  const updatedFields: string[] = []

  if (input.subject !== undefined) {
    task.subject = input.subject
    updatedFields.push('subject')
  }
  if (input.description !== undefined) {
    task.description = input.description
    updatedFields.push('description')
  }
  if (input.activeForm !== undefined) {
    task.activeForm = input.activeForm
    updatedFields.push('activeForm')
  }
  if (input.status !== undefined && input.status !== 'deleted') {
    task.status = input.status
    updatedFields.push('status')
  }
  if (input.owner !== undefined) {
    task.owner = input.owner
    updatedFields.push('owner')
  }
  if (input.addBlocks?.length) {
    task.blocks.push(...input.addBlocks)
    updatedFields.push('blocks')
  }
  if (input.addBlockedBy?.length) {
    task.blockedBy.push(...input.addBlockedBy)
    updatedFields.push('blockedBy')
  }
  if (input.metadata !== undefined) {
    task.metadata = { ...(task.metadata ?? {}), ...input.metadata }
    updatedFields.push('metadata')
  }
  if (input.status === 'deleted') {
    runtime.state.taskRecords.delete(input.taskId)
    updatedFields.push('deleted')
  }

  return {
    success: true,
    taskId: input.taskId,
    updatedFields,
  }
}
