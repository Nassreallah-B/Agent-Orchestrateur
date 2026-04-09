export type RetryOptions = {
  label: string
  retries: number
  baseDelayMs?: number
  maxDelayMs?: number
  shouldRetry?: (error: unknown, attempt: number) => boolean
  onRetry?: (error: unknown, attempt: number, nextDelayMs: number) => void | Promise<void>
}

export async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms))
}

export async function withRetries<T>(
  options: RetryOptions,
  fn: (attempt: number) => Promise<T>,
): Promise<T> {
  const retries = Math.max(0, options.retries)
  const baseDelayMs = options.baseDelayMs ?? 250
  const maxDelayMs = options.maxDelayMs ?? 5_000

  let attempt = 0
  let lastError: unknown
  while (attempt <= retries) {
    try {
      return await fn(attempt)
    } catch (error) {
      lastError = error
      const shouldRetry = attempt < retries && (options.shouldRetry?.(error, attempt) ?? true)
      if (!shouldRetry) break
      const nextDelayMs = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs)
      await options.onRetry?.(error, attempt + 1, nextDelayMs)
      await sleep(nextDelayMs)
      attempt += 1
    }
  }

  throw lastError ?? new Error(`${options.label} failed`)
}
