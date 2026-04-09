import type { TaskRecord } from '../types'

export function formatTaskList(tasks: TaskRecord[]): string {
  if (tasks.length === 0) return 'No tasks found.'
  return tasks
    .map(task => `#${task.id} [${task.status}] ${task.subject}`)
    .join('\n')
}
