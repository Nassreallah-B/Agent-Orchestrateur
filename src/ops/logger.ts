import { appendFile, mkdir } from 'fs/promises'
import { dirname } from 'path'
import type { LogLevel, LoggingOptions } from '../types'
import { redactValue, serializeError } from '../security/redaction'

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

type LogEntry = {
  timestamp: string
  level: LogLevel
  message: string
  fields?: Record<string, unknown>
}

export class StructuredLogger {
  private readonly minLevel: number

  constructor(private readonly options: LoggingOptions = {}) {
    this.minLevel = LEVEL_ORDER[options.level ?? 'info']
  }

  child(fields: Record<string, unknown>): StructuredLogger {
    return new StructuredLoggerWithContext(this, fields)
  }

  async debug(message: string, fields?: Record<string, unknown>): Promise<void> {
    await this.write('debug', message, fields)
  }

  async info(message: string, fields?: Record<string, unknown>): Promise<void> {
    await this.write('info', message, fields)
  }

  async warn(message: string, fields?: Record<string, unknown>): Promise<void> {
    await this.write('warn', message, fields)
  }

  async error(message: string, fields?: Record<string, unknown>): Promise<void> {
    await this.write('error', message, fields)
  }

  async audit(action: string, fields?: Record<string, unknown>): Promise<void> {
    const payload = this.buildPayload('info', `audit:${action}`, fields)
    const line = `${JSON.stringify(payload)}\n`
    if (this.options.console !== false) {
      console.log(line.trim())
    }
    if (this.options.auditFilePath) {
      await mkdir(dirname(this.options.auditFilePath), { recursive: true })
      await appendFile(this.options.auditFilePath, line, 'utf8')
    }
  }

  private buildPayload(
    level: LogLevel,
    message: string,
    fields?: Record<string, unknown>,
  ): LogEntry {
    return {
      timestamp: new Date().toISOString(),
      level,
      message,
      fields: fields ? (redactValue(fields) as Record<string, unknown>) : undefined,
    }
  }

  private async write(
    level: LogLevel,
    message: string,
    fields?: Record<string, unknown>,
  ): Promise<void> {
    if (LEVEL_ORDER[level] < this.minLevel) return
    const payload = this.buildPayload(level, message, fields)
    const line = `${JSON.stringify(payload)}\n`

    if (this.options.console !== false) {
      const target = level === 'error' ? console.error : console.log
      target(line.trim())
    }

    if (this.options.filePath) {
      await mkdir(dirname(this.options.filePath), { recursive: true })
      await appendFile(this.options.filePath, line, 'utf8')
    }
  }
}

class StructuredLoggerWithContext extends StructuredLogger {
  constructor(
    private readonly parent: StructuredLogger,
    private readonly context: Record<string, unknown>,
  ) {
    super()
  }

  override async debug(message: string, fields?: Record<string, unknown>): Promise<void> {
    await this.parent.debug(message, { ...this.context, ...fields })
  }

  override async info(message: string, fields?: Record<string, unknown>): Promise<void> {
    await this.parent.info(message, { ...this.context, ...fields })
  }

  override async warn(message: string, fields?: Record<string, unknown>): Promise<void> {
    await this.parent.warn(message, { ...this.context, ...fields })
  }

  override async error(message: string, fields?: Record<string, unknown>): Promise<void> {
    await this.parent.error(message, { ...this.context, ...fields })
  }

  override async audit(action: string, fields?: Record<string, unknown>): Promise<void> {
    await this.parent.audit(action, { ...this.context, ...fields })
  }
}

export async function logError(
  logger: StructuredLogger,
  message: string,
  error: unknown,
  fields?: Record<string, unknown>,
): Promise<void> {
  await logger.error(message, {
    ...fields,
    error: serializeError(error),
  })
}
