import type { AnalyticsEvent } from './events'
import type { StructuredLogger } from '../ops/logger'

export type AnalyticsSink = {
  handle: (event: AnalyticsEvent) => void | Promise<void>
}

export class Analytics {
  private readonly sinks: AnalyticsSink[]

  constructor(sinks: AnalyticsSink[] = []) {
    this.sinks = sinks
  }

  async log(name: string, payload?: Record<string, unknown>): Promise<void> {
    const event: AnalyticsEvent = {
      name,
      timestamp: Date.now(),
      payload,
    }

    for (const sink of this.sinks) {
      await sink.handle(event)
    }
  }
}

export class ConsoleAnalyticsSink implements AnalyticsSink {
  handle(event: AnalyticsEvent): void {
    console.log(`[analytics] ${event.name}`, event.payload ?? {})
  }
}

export class StructuredLoggerAnalyticsSink implements AnalyticsSink {
  constructor(private readonly logger: StructuredLogger) {}

  async handle(event: AnalyticsEvent): Promise<void> {
    await this.logger.info(`analytics:${event.name}`, {
      timestamp: event.timestamp,
      payload: event.payload,
    })
  }
}
