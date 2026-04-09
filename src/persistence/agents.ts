import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import type { AgentTask } from '../types'

const FILE_NAME = 'agents.json'

export async function saveAgentTasks(baseDir: string, tasks: AgentTask[]): Promise<void> {
  await mkdir(baseDir, { recursive: true })
  await writeFile(join(baseDir, FILE_NAME), JSON.stringify(tasks, null, 2), 'utf8')
}

export async function loadAgentTasks(baseDir: string): Promise<AgentTask[]> {
  try {
    const raw = await readFile(join(baseDir, FILE_NAME), 'utf8')
    return JSON.parse(raw) as AgentTask[]
  } catch {
    return []
  }
}
