import { EventEmitter } from 'events'
import type { PersistedRuntimeEvent } from './types'

export type RuntimeEvent = PersistedRuntimeEvent

export class RuntimeEventBus extends EventEmitter {
  private readonly history: RuntimeEvent[] = []
  private readonly maxHistory: number

  constructor(maxHistory = 1000) {
    super()
    this.maxHistory = maxHistory
  }

  emitEvent(type: string, payload?: Record<string, unknown>): RuntimeEvent {
    const event: RuntimeEvent = {
      type,
      timestamp: Date.now(),
      payload,
    }
    this.history.push(event)
    if (this.history.length > this.maxHistory) {
      this.history.shift()
    }
    this.emit('event', event)
    return event
  }

  recent(limit = 50): RuntimeEvent[] {
    return this.history.slice(-limit)
  }

  snapshot(limit = this.maxHistory): RuntimeEvent[] {
    return this.recent(limit)
  }

  loadHistory(events: RuntimeEvent[]): void {
    this.history.length = 0
    for (const event of events.slice(-this.maxHistory)) {
      this.history.push(event)
    }
  }
}
