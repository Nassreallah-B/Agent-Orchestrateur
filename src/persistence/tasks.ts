import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import type { TaskRecord } from '../types'

const FILE_NAME = 'tasks.json'

export async function saveTaskRecords(baseDir: string, tasks: TaskRecord[]): Promise<void> {
  await mkdir(baseDir, { recursive: true })
  await writeFile(join(baseDir, FILE_NAME), JSON.stringify(tasks, null, 2), 'utf8')
}

export async function loadTaskRecords(baseDir: string): Promise<TaskRecord[]> {
  try {
    const raw = await readFile(join(baseDir, FILE_NAME), 'utf8')
    return JSON.parse(raw) as TaskRecord[]
  } catch {
    return []
  }
}
