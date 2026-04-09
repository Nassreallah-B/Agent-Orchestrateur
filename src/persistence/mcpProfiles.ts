import { join } from 'path'
import type { McpProfileStore } from '../types'
import { readJsonFile, writeJsonAtomic } from '../utils/atomic'

const FILE_NAME = 'mcp-profiles.json'

export async function saveMcpProfileStore(
  baseDir: string,
  store: McpProfileStore,
): Promise<void> {
  await writeJsonAtomic(join(baseDir, FILE_NAME), store)
}

export async function loadMcpProfileStore(
  baseDir: string,
): Promise<McpProfileStore> {
  const parsed = await readJsonFile<McpProfileStore>(join(baseDir, FILE_NAME))
  return {
    activeProfile: parsed?.activeProfile ?? null,
    profiles: Array.isArray(parsed?.profiles) ? parsed!.profiles : [],
  }
}
