import { mkdir, open, readFile, rename, rm, writeFile } from 'fs/promises'
import { dirname, join } from 'path'

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms))
}

export async function withFileLock<T>(
  targetPath: string,
  fn: () => Promise<T>,
  options?: { retries?: number; retryDelayMs?: number },
): Promise<T> {
  const retries = options?.retries ?? 20
  const retryDelayMs = options?.retryDelayMs ?? 25
  const lockPath = `${targetPath}.lock`

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      await mkdir(dirname(targetPath), { recursive: true })
      const handle = await open(lockPath, 'wx')
      try {
        return await fn()
      } finally {
        await handle.close()
        await rm(lockPath, { force: true })
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code
      if (code !== 'EEXIST' || attempt === retries) {
        throw error
      }
      await sleep(retryDelayMs)
    }
  }

  throw new Error(`Could not acquire file lock for '${targetPath}'`)
}

export async function writeFileAtomic(
  targetPath: string,
  content: string,
): Promise<void> {
  await mkdir(dirname(targetPath), { recursive: true })
  const tempPath = join(
    dirname(targetPath),
    `.${Date.now()}-${Math.random().toString(16).slice(2)}-${targetPath.split(/[\\/]/).pop()}.tmp`,
  )
  await writeFile(tempPath, content, 'utf8')
  await rename(tempPath, targetPath)
}

export async function writeJsonAtomic(
  targetPath: string,
  value: unknown,
): Promise<void> {
  await withFileLock(targetPath, () =>
    writeFileAtomic(targetPath, JSON.stringify(value, null, 2)),
  )
}

export async function readJsonFile<T>(
  targetPath: string,
): Promise<T | null> {
  try {
    const raw = await readFile(targetPath, 'utf8')
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}
