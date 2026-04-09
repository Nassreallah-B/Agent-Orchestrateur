import type { McpProfile, McpServerConfig } from '../types'

const DEFAULT_SENSITIVE_KEY_PATTERN =
  /(authorization|token|secret|password|api[-_]?key|cookie|session|bearer)/i

function truncate(value: string, visible = 4): string {
  if (value.length <= visible) return '*'.repeat(value.length || 4)
  return `${'*'.repeat(Math.max(8, value.length - visible))}${value.slice(-visible)}`
}

export function isSensitiveKey(
  key: string,
  extraPatterns: string[] = [],
): boolean {
  return (
    DEFAULT_SENSITIVE_KEY_PATTERN.test(key) ||
    extraPatterns.some(pattern => new RegExp(pattern, 'i').test(key))
  )
}

export function redactSecret(value: string): string {
  return truncate(value.trim())
}

export function redactValue(
  value: unknown,
  key?: string,
  extraPatterns: string[] = [],
): unknown {
  if (typeof value === 'string') {
    if (key && isSensitiveKey(key, extraPatterns)) {
      return redactSecret(value)
    }
    return value
  }

  if (Array.isArray(value)) {
    return value.map(item => redactValue(item, key, extraPatterns))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
        entryKey,
        redactValue(entryValue, entryKey, extraPatterns),
      ]),
    )
  }

  return value
}

function sanitizeArgs(args?: string[], extraPatterns: string[] = []): string[] | undefined {
  if (!args) return args
  return args.map((arg, index) => {
    const previous = index > 0 ? args[index - 1] : ''
    if (isSensitiveKey(previous, extraPatterns)) {
      return redactSecret(arg)
    }
    if (/^(--?(token|secret|password|api[-_]?key))=/i.test(arg)) {
      const [prefix, value] = arg.split('=', 2)
      return `${prefix}=${redactSecret(value ?? '')}`
    }
    return arg
  })
}

export function sanitizeMcpServerConfig(
  config: McpServerConfig,
  extraPatterns: string[] = [],
): McpServerConfig {
  return {
    ...config,
    headers: config.headers
      ? (redactValue(config.headers, undefined, extraPatterns) as Record<string, string>)
      : undefined,
    args: sanitizeArgs(config.args, extraPatterns),
  }
}

export function sanitizeMcpProfiles(
  profiles: McpProfile[],
  extraPatterns: string[] = [],
): McpProfile[] {
  return profiles.map(profile => ({
    ...profile,
    connections: profile.connections.map(connection => ({
      ...connection,
      config: sanitizeMcpServerConfig(connection.config, extraPatterns),
    })),
  }))
}

export function serializeError(error: unknown): {
  name?: string
  message: string
  stack?: string
} {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    }
  }
  return {
    message: String(error),
  }
}
