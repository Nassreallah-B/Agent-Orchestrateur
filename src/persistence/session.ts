import { join } from 'path'
import type { RuntimeSnapshot } from '../types'
import { readJsonFile, writeJsonAtomic } from '../utils/atomic'

const FILE_NAME = 'session.json'

export async function saveSessionSnapshot(
  baseDir: string,
  snapshot: RuntimeSnapshot,
): Promise<void> {
  await writeJsonAtomic(join(baseDir, FILE_NAME), snapshot)
}

export async function loadSessionSnapshot(
  baseDir: string,
): Promise<RuntimeSnapshot | null> {
  return readJsonFile<RuntimeSnapshot>(join(baseDir, FILE_NAME))
}
