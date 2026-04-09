import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import type { TeamRecord } from '../types'

const FILE_NAME = 'teams.json'

export async function saveTeams(baseDir: string, teams: TeamRecord[]): Promise<void> {
  await mkdir(baseDir, { recursive: true })
  await writeFile(join(baseDir, FILE_NAME), JSON.stringify(teams, null, 2), 'utf8')
}

export async function loadTeams(baseDir: string): Promise<TeamRecord[]> {
  try {
    const raw = await readFile(join(baseDir, FILE_NAME), 'utf8')
    return JSON.parse(raw) as TeamRecord[]
  } catch {
    return []
  }
}
