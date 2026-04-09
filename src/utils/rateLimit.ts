type BucketState = {
  tokens: number
  lastRefill: number
}

export class TokenBucketRateLimiter {
  private readonly state = new Map<string, BucketState>()
  private readonly capacity: number
  private readonly refillPerMs: number

  constructor(requestsPerMinute: number) {
    this.capacity = Math.max(1, requestsPerMinute)
    this.refillPerMs = this.capacity / 60_000
  }

  consume(key: string, cost = 1): boolean {
    const now = Date.now()
    const current = this.state.get(key) ?? {
      tokens: this.capacity,
      lastRefill: now,
    }
    const elapsed = Math.max(0, now - current.lastRefill)
    const tokens = Math.min(this.capacity, current.tokens + elapsed * this.refillPerMs)
    const next: BucketState = {
      tokens,
      lastRefill: now,
    }

    if (next.tokens < cost) {
      this.state.set(key, next)
      return false
    }

    next.tokens -= cost
    this.state.set(key, next)
    return true
  }
}

export class ConcurrencyGate {
  private active = 0

  constructor(private readonly maxConcurrency: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.maxConcurrency) {
      throw new Error(`Concurrency limit exceeded (${this.maxConcurrency})`)
    }
    this.active += 1
    try {
      return await fn()
    } finally {
      this.active -= 1
    }
  }
}
