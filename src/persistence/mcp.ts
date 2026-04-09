import { join } from 'path'
import type { McpServerConfig } from '../types'
import { readJsonFile, writeJsonAtomic } from '../utils/atomic'

const FILE_NAME = 'mcp-connections.json'

export type PersistedMcpConnection = {
  name: string
  config: McpServerConfig
}

export async function saveMcpConnections(
  baseDir: string,
  connections: PersistedMcpConnection[],
): Promise<void> {
  await writeJsonAtomic(join(baseDir, FILE_NAME), connections)
}

export async function loadMcpConnections(
  baseDir: string,
): Promise<PersistedMcpConnection[]> {
  const parsed = await readJsonFile<PersistedMcpConnection[]>(join(baseDir, FILE_NAME))
  return Array.isArray(parsed) ? parsed : []
}
