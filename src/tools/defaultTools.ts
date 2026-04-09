import { promises as fs } from 'fs'
import { spawn } from 'child_process'
import { dirname, isAbsolute, join, relative, resolve } from 'path'
import { z } from 'zod'
import { buildIsolatedExecutionPlan } from '../security/processIsolation'
import { AgentToolInputSchema } from './agentTool'
import { SendMessageToolInputSchema } from './sendMessageTool'
import {
  TaskCreateInputSchema,
  TaskGetInputSchema,
  TaskListInputSchema,
  TaskOutputInputSchema,
  TaskStopInputSchema,
  TaskUpdateInputSchema,
  createTask,
  getTask,
  getTaskOutput,
  listTasks,
  stopTask,
  updateTask,
} from './taskTools'
import { createTeam, deleteCurrentTeam, TeamCreateInputSchema } from './teamTools'
import type { ToolDefinition, ToolUseContext } from '../types'

const jsonObjectSchema = {
  type: 'object',
  additionalProperties: true,
} as const

const agentToolSchema = {
  type: 'object',
  properties: {
    description: { type: 'string' },
    prompt: { type: 'string' },
    subagent_type: { type: 'string' },
    model: { type: 'string' },
    run_in_background: { type: 'boolean' },
    name: { type: 'string' },
    team_name: { type: 'string' },
    mode: {
      type: 'string',
      enum: ['default', 'plan', 'acceptEdits', 'dontAsk', 'bubble'],
    },
    isolation: {
      type: 'string',
      enum: ['worktree', 'remote'],
    },
    cwd: { type: 'string' },
  },
  required: ['description', 'prompt'],
  additionalProperties: false,
} as const

const sendMessageToolSchema = {
  type: 'object',
  properties: {
    to: { type: 'string' },
    summary: { type: 'string' },
    message: {
      oneOf: [
        { type: 'string' },
        { type: 'object', additionalProperties: true },
      ],
    },
  },
  required: ['to', 'message'],
  additionalProperties: false,
} as const

const taskCreateToolSchema = {
  type: 'object',
  properties: {
    subject: { type: 'string' },
    description: { type: 'string' },
    activeForm: { type: 'string' },
    metadata: jsonObjectSchema,
  },
  required: ['subject', 'description'],
  additionalProperties: false,
} as const

const taskGetToolSchema = {
  type: 'object',
  properties: {
    taskId: { type: 'string' },
  },
  required: ['taskId'],
  additionalProperties: false,
} as const

const taskListToolSchema = {
  type: 'object',
  additionalProperties: false,
} as const

const taskOutputToolSchema = {
  type: 'object',
  properties: {
    task_id: { type: 'string' },
    block: { type: 'boolean' },
    timeout: { type: 'integer', minimum: 0, maximum: 600000 },
  },
  required: ['task_id'],
  additionalProperties: false,
} as const

const taskStopToolSchema = {
  type: 'object',
  properties: {
    task_id: { type: 'string' },
    shell_id: { type: 'string' },
  },
  additionalProperties: false,
} as const

const taskUpdateToolSchema = {
  type: 'object',
  properties: {
    taskId: { type: 'string' },
    subject: { type: 'string' },
    description: { type: 'string' },
    activeForm: { type: 'string' },
    status: {
      type: 'string',
      enum: ['pending', 'in_progress', 'completed', 'blocked', 'failed', 'deleted'],
    },
    addBlocks: { type: 'array', items: { type: 'string' } },
    addBlockedBy: { type: 'array', items: { type: 'string' } },
    owner: { type: 'string' },
    metadata: jsonObjectSchema,
  },
  required: ['taskId'],
  additionalProperties: false,
} as const

const teamCreateToolSchema = {
  type: 'object',
  properties: {
    team_name: { type: 'string' },
    description: { type: 'string' },
    agent_type: { type: 'string' },
  },
  required: ['team_name'],
  additionalProperties: false,
} as const

const readSchema = {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'Absolute or cwd-relative path to the file.' },
    startLine: { type: 'integer', minimum: 1 },
    endLine: { type: 'integer', minimum: 1 },
  },
  required: ['path'],
  additionalProperties: false,
} as const

const writeSchema = {
  type: 'object',
  properties: {
    path: { type: 'string' },
    content: { type: 'string' },
  },
  required: ['path', 'content'],
  additionalProperties: false,
} as const

const editSchema = {
  type: 'object',
  properties: {
    path: { type: 'string' },
    oldText: { type: 'string' },
    newText: { type: 'string' },
    replaceAll: { type: 'boolean' },
  },
  required: ['path', 'oldText', 'newText'],
  additionalProperties: false,
} as const

const listFilesSchema = {
  type: 'object',
  properties: {
    path: { type: 'string' },
    pattern: { type: 'string' },
    depth: { type: 'integer', minimum: 0, maximum: 8 },
  },
  additionalProperties: false,
} as const

const searchSchema = {
  type: 'object',
  properties: {
    path: { type: 'string' },
    pattern: { type: 'string' },
    isRegex: { type: 'boolean' },
    caseSensitive: { type: 'boolean' },
    maxResults: { type: 'integer', minimum: 1, maximum: 200 },
  },
  required: ['pattern'],
  additionalProperties: false,
} as const

const shellSchema = {
  type: 'object',
  properties: {
    command: { type: 'string' },
    cwd: { type: 'string' },
    timeoutMs: { type: 'integer', minimum: 100, maximum: 600000 },
  },
  required: ['command'],
  additionalProperties: false,
} as const

const webFetchSchema = {
  type: 'object',
  properties: {
    url: { type: 'string' },
    method: { type: 'string' },
    body: { type: 'string' },
    headers: { type: 'object', additionalProperties: { type: 'string' } },
  },
  required: ['url'],
  additionalProperties: false,
} as const

const webSearchSchema = {
  type: 'object',
  properties: {
    query: { type: 'string' },
    limit: { type: 'integer', minimum: 1, maximum: 10 },
  },
  required: ['query'],
  additionalProperties: false,
} as const

const teamDeleteSchema = {
  type: 'object',
  properties: {
    team_name: { type: 'string' },
  },
  additionalProperties: false,
} as const

const readInput = z.object({
  path: z.string(),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
})

const writeInput = z.object({
  path: z.string(),
  content: z.string(),
})

const editInput = z.object({
  path: z.string(),
  oldText: z.string(),
  newText: z.string(),
  replaceAll: z.boolean().optional(),
})

const listFilesInput = z.object({
  path: z.string().optional(),
  pattern: z.string().optional(),
  depth: z.number().int().min(0).max(8).optional(),
})

const searchInput = z.object({
  path: z.string().optional(),
  pattern: z.string(),
  isRegex: z.boolean().optional(),
  caseSensitive: z.boolean().optional(),
  maxResults: z.number().int().min(1).max(200).optional(),
})

const shellInput = z.object({
  command: z.string(),
  cwd: z.string().optional(),
  timeoutMs: z.number().int().min(100).max(600000).optional(),
})

const webFetchInput = z.object({
  url: z.string().url(),
  method: z.string().optional(),
  body: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
})

const webSearchInput = z.object({
  query: z.string(),
  limit: z.number().int().min(1).max(10).optional(),
})

const teamDeleteInput = z.object({
  team_name: z.string().optional(),
})

function resolvePath(cwd: string, target: string): string {
  return isAbsolute(target) ? target : resolve(cwd, target)
}

function normalizeRoots(context: ToolUseContext): string[] {
  const configured = context.options.security?.filesystem?.allowedRoots
  if (configured && configured.length > 0) {
    return configured.map(root => resolve(root))
  }
  return [resolve(context.options.cwd)]
}

function assertPathAllowed(
  fullPath: string,
  context: ToolUseContext,
): void {
  const allowedRoots = normalizeRoots(context)
  const normalized = resolve(fullPath)
  const withinRoot = allowedRoots.some(root => {
    const normalizedRoot = resolve(root)
    return normalized === normalizedRoot || normalized.startsWith(`${normalizedRoot}\\`) || normalized.startsWith(`${normalizedRoot}/`)
  })

  if (!withinRoot) {
    throw new Error(`Path '${normalized}' is outside the allowed workspace roots`)
  }

  const denyPatterns = context.options.security?.filesystem?.denyPathPatterns ?? []
  for (const pattern of denyPatterns) {
    if (new RegExp(pattern, 'i').test(normalized)) {
      throw new Error(`Path '${normalized}' is blocked by filesystem policy`)
    }
  }
}

function sanitizeShellEnv(): NodeJS.ProcessEnv {
  const keep = new Set([
    'PATH',
    'PATHEXT',
    'SystemRoot',
    'SYSTEMROOT',
    'WINDIR',
    'windir',
    'TEMP',
    'TMP',
    'USERPROFILE',
    'HOMEDRIVE',
    'HOMEPATH',
    'HOME',
    'OS',
    'ComSpec',
    'COMSPEC',
    'NUMBER_OF_PROCESSORS',
    'PROCESSOR_ARCHITECTURE',
    'APPDATA',
    'LOCALAPPDATA',
    'ProgramData',
    'ProgramFiles',
    'ProgramFiles(x86)',
    'ProgramW6432',
    'TERM',
    'CI',
    'npm_config_cache',
  ])
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => keep.has(key)),
  )
}

function enforceShellPolicy(command: string, context: ToolUseContext): void {
  const shellSecurity = context.options.security?.shell
  if (shellSecurity?.enabled === false) {
    throw new Error('Shell tool is disabled by security policy')
  }

  const defaultBlockedPatterns = [
    '\\brm\\s+-rf\\b',
    '\\bdel\\s+/s\\b',
    '\\bformat\\b',
    '\\bshutdown\\b',
    '\\bschtasks\\b.*\\/(create|change)\\b',
    '\\breg\\s+add\\b',
    '\\bcurl\\b.*\\|',
    '\\bwget\\b.*\\|',
    'Invoke-WebRequest.*iex',
    'powershell(?:\\.exe)?\\b.*-enc(?:odedcommand)?\\b',
    '\\bcertutil\\b.*-urlcache\\b',
  ]
  const blockedPatterns = shellSecurity?.blockedPatterns ?? defaultBlockedPatterns
  for (const pattern of blockedPatterns) {
    if (new RegExp(pattern, 'i').test(command)) {
      throw new Error(`Shell command blocked by policy: ${pattern}`)
    }
  }

  const allowedCommands = shellSecurity?.allowedCommands
  if (allowedCommands && allowedCommands.length > 0) {
    const firstToken = command.trim().split(/\s+/)[0]?.toLowerCase()
    const allowed = allowedCommands.some(candidate => candidate.toLowerCase() === firstToken)
    if (!allowed) {
      throw new Error(`Shell command '${firstToken ?? 'unknown'}' is not in the allowlist`)
    }
  }
}

function truncate(value: string, max = 12000): string {
  return value.length > max ? `${value.slice(0, max)}\n...[truncated]` : value
}

async function runProcess(args: {
  command: string
  execArgs: string[]
  cwd: string
  env?: NodeJS.ProcessEnv
  timeoutMs: number
  maxBufferBytes: number
}): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(args.command, args.execArgs, {
      cwd: args.cwd,
      env: args.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (
      callback: () => void,
    ): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      callback()
    }

    const timer = setTimeout(() => {
      child.kill()
      finish(() =>
        rejectPromise(new Error(`Process timed out after ${args.timeoutMs}ms`)),
      )
    }, args.timeoutMs)

    child.stdout.on('data', chunk => {
      stdout += chunk.toString('utf8')
      if (Buffer.byteLength(stdout, 'utf8') > args.maxBufferBytes) {
        child.kill()
        finish(() => rejectPromise(new Error(`stdout exceeded ${args.maxBufferBytes} bytes`)))
      }
    })

    child.stderr.on('data', chunk => {
      stderr += chunk.toString('utf8')
      if (Buffer.byteLength(stderr, 'utf8') > args.maxBufferBytes) {
        child.kill()
        finish(() => rejectPromise(new Error(`stderr exceeded ${args.maxBufferBytes} bytes`)))
      }
    })

    child.on('error', error => {
      finish(() => rejectPromise(error))
    })

    child.on('exit', code => {
      finish(() => {
        if (code && code !== 0) {
          rejectPromise(
            new Error(`Process exited with code ${code}: ${truncate(stderr || stdout, 1000)}`),
          )
          return
        }
        resolvePromise({
          stdout,
          stderr,
          exitCode: code,
        })
      })
    })
  })
}

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`, 'i')
}

async function walk(dir: string, depth: number, files: string[] = []): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (depth > 0 && !['node_modules', '.git', 'dist'].includes(entry.name)) {
        await walk(fullPath, depth - 1, files)
      }
      continue
    }
    files.push(fullPath)
  }
  return files
}

async function tryReadText(path: string): Promise<string | null> {
  try {
    return await fs.readFile(path, 'utf8')
  } catch {
    return null
  }
}

async function duckDuckGoSearch(query: string, limit: number): Promise<Array<Record<string, string>>> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  const response = await fetch(url, {
    headers: {
      'user-agent': 'agent-blueprint/0.1',
    },
  })
  if (!response.ok) {
    throw new Error(`WebSearch failed with HTTP ${response.status}`)
  }
  const html = await response.text()
  const regex = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gms
  const results: Array<Record<string, string>> = []
  for (const match of html.matchAll(regex)) {
    const href = match[1]
    const title = match[2].replace(/<[^>]+>/g, '').trim()
    results.push({ title, url: href })
    if (results.length >= limit) break
  }
  return results
}

function toolDescription(name: string, summary: string): string {
  return `${name}: ${summary}`
}

async function runReadTool(input: unknown, context: ToolUseContext) {
  const parsed = readInput.parse(input)
  const fullPath = resolvePath(context.options.cwd, parsed.path)
  assertPathAllowed(fullPath, context)
  const stat = await fs.stat(fullPath)
  const maxReadBytes = context.options.security?.filesystem?.maxReadBytes ?? 256 * 1024
  if (stat.size > maxReadBytes) {
    throw new Error(`Read exceeds maxReadBytes (${maxReadBytes})`)
  }
  const content = await fs.readFile(fullPath, 'utf8')
  const lines = content.split(/\r?\n/)
  const start = parsed.startLine ? parsed.startLine - 1 : 0
  const end = parsed.endLine ? parsed.endLine : lines.length
  const slice = lines.slice(start, end)
  return {
    path: fullPath,
    content: slice.join('\n'),
    totalLines: lines.length,
    startLine: start + 1,
    endLine: start + slice.length,
  }
}

async function runWriteTool(input: unknown, context: ToolUseContext) {
  const parsed = writeInput.parse(input)
  const fullPath = resolvePath(context.options.cwd, parsed.path)
  assertPathAllowed(fullPath, context)
  const maxWriteBytes = context.options.security?.filesystem?.maxWriteBytes ?? 256 * 1024
  if (Buffer.byteLength(parsed.content, 'utf8') > maxWriteBytes) {
    throw new Error(`Write exceeds maxWriteBytes (${maxWriteBytes})`)
  }
  await fs.mkdir(dirname(fullPath), { recursive: true })
  await fs.writeFile(fullPath, parsed.content, 'utf8')
  return {
    path: fullPath,
    bytesWritten: Buffer.byteLength(parsed.content, 'utf8'),
  }
}

async function runEditTool(input: unknown, context: ToolUseContext) {
  const parsed = editInput.parse(input)
  const fullPath = resolvePath(context.options.cwd, parsed.path)
  assertPathAllowed(fullPath, context)
  const original = await fs.readFile(fullPath, 'utf8')
  if (!original.includes(parsed.oldText)) {
    throw new Error('oldText was not found in the target file')
  }

  const updated = parsed.replaceAll
    ? original.split(parsed.oldText).join(parsed.newText)
    : original.replace(parsed.oldText, parsed.newText)

  const maxWriteBytes = context.options.security?.filesystem?.maxWriteBytes ?? 256 * 1024
  if (Buffer.byteLength(updated, 'utf8') > maxWriteBytes) {
    throw new Error(`Edit exceeds maxWriteBytes (${maxWriteBytes})`)
  }

  await fs.writeFile(fullPath, updated, 'utf8')
  return {
    path: fullPath,
    replacedOccurrences: parsed.replaceAll
      ? original.split(parsed.oldText).length - 1
      : 1,
  }
}

async function runListFilesTool(input: unknown, context: ToolUseContext) {
  const parsed = listFilesInput.parse(input)
  const baseDir = resolvePath(context.options.cwd, parsed.path ?? '.')
  assertPathAllowed(baseDir, context)
  const depth = parsed.depth ?? 3
  const files = await walk(baseDir, depth)
  const matcher = parsed.pattern ? wildcardToRegExp(parsed.pattern) : null
  const filtered = matcher
    ? files.filter(path => matcher.test(relative(baseDir, path).replace(/\\/g, '/')))
    : files

  return {
    baseDir,
    count: filtered.length,
    files: filtered.slice(0, 200).map(path => relative(baseDir, path).replace(/\\/g, '/')),
  }
}

async function runSearchTool(input: unknown, context: ToolUseContext) {
  const parsed = searchInput.parse(input)
  const baseDir = resolvePath(context.options.cwd, parsed.path ?? '.')
  assertPathAllowed(baseDir, context)
  const files = await walk(baseDir, 4)
  const flags = parsed.caseSensitive ? 'g' : 'gi'
  const regex = parsed.isRegex
    ? new RegExp(parsed.pattern, flags)
    : new RegExp(parsed.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags)
  const maxResults = parsed.maxResults ?? 50
  const results: Array<Record<string, unknown>> = []

  for (const path of files) {
    const content = await tryReadText(path)
    if (!content) continue
    const lines = content.split(/\r?\n/)
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      if (!regex.test(line)) continue
      results.push({
        path: relative(baseDir, path).replace(/\\/g, '/'),
        line: index + 1,
        preview: line.trim(),
      })
      if (results.length >= maxResults) {
        return { baseDir, count: results.length, results }
      }
      regex.lastIndex = 0
    }
  }

  return { baseDir, count: results.length, results }
}

async function runShellTool(input: unknown, context: ToolUseContext) {
  const parsed = shellInput.parse(input)
  const cwd = parsed.cwd ? resolvePath(context.options.cwd, parsed.cwd) : context.options.cwd
  assertPathAllowed(cwd, context)
  enforceShellPolicy(parsed.command, context)
  const shellSecurity = context.options.security?.shell
  const timeout = Math.min(
    parsed.timeoutMs ?? 30000,
    shellSecurity?.maxTimeoutMs ?? 30000,
  )
  const maxBufferBytes = Math.max(
    shellSecurity?.maxStdoutBytes ?? 128 * 1024,
    shellSecurity?.maxStderrBytes ?? 64 * 1024,
  )
  const execution = buildIsolatedExecutionPlan({
    kind: 'shell',
    cwd,
    command: parsed.command,
    env: shellSecurity?.sanitizeEnv === false ? process.env : sanitizeShellEnv(),
    security: context.options.security,
  })
  const result = await runProcess({
    command: execution.command,
    execArgs: execution.args,
    cwd: execution.cwd,
    env: execution.env,
    timeoutMs: timeout,
    maxBufferBytes,
  })
  return {
    cwd,
    stdout: truncate(result.stdout, shellSecurity?.maxStdoutBytes ?? 8_000),
    stderr: truncate(result.stderr, shellSecurity?.maxStderrBytes ?? 4_000),
    isolated: execution.isolated,
    isolationProvider: execution.provider,
    isolationProfile: execution.profileName,
    warnings: execution.warnings,
  }
}

async function runWebFetchTool(input: unknown) {
  const parsed = webFetchInput.parse(input)
  const response = await fetch(parsed.url, {
    method: parsed.method ?? 'GET',
    body: parsed.body,
    headers: parsed.headers,
  })
  const text = truncate(await response.text(), 20000)
  return {
    url: parsed.url,
    status: response.status,
    ok: response.ok,
    contentType: response.headers.get('content-type'),
    body: text,
  }
}

async function runWebSearchTool(input: unknown) {
  const parsed = webSearchInput.parse(input)
  return {
    query: parsed.query,
    results: await duckDuckGoSearch(parsed.query, parsed.limit ?? 5),
  }
}

export function buildDefaultTools(): ToolDefinition[] {
  return [
    {
      name: 'Agent',
      description: toolDescription('Agent', 'Spawn a specialized sub-agent.'),
      inputSchema: agentToolSchema,
      async call(input, context) {
        const parsed = AgentToolInputSchema.parse(input)
        const task = await context.runtime.spawnAgent(parsed)
        if (parsed.run_in_background) {
          return {
            status: 'async_launched',
            agentId: task.agentId,
            description: task.description,
            prompt: task.prompt,
            outputFile: `memory://tasks/${task.id}`,
            canReadOutputFile: true,
          }
        }
        return {
          status: 'completed',
          prompt: task.prompt,
          result: task.result ?? '',
        }
      },
    },
    {
      name: 'SendMessage',
      description: toolDescription('SendMessage', 'Send a follow-up message to an existing agent.'),
      inputSchema: sendMessageToolSchema,
      async call(input, context) {
        const parsed = SendMessageToolInputSchema.parse(input)
        const payload = typeof parsed.message === 'string' ? parsed.message : JSON.stringify(parsed.message)
        await context.runtime.continueAgent(parsed.to, payload)
        return {
          success: true,
          message: `Message sent to agent '${parsed.to}'`,
        }
      },
    },
    {
      name: 'TaskCreate',
      description: toolDescription('TaskCreate', 'Create a structured task record.'),
      inputSchema: taskCreateToolSchema,
      async call(input, context) {
        return createTask({ state: context.state } as never, TaskCreateInputSchema.parse(input))
      },
    },
    {
      name: 'TaskGet',
      description: toolDescription('TaskGet', 'Get a structured task record by id.'),
      inputSchema: taskGetToolSchema,
      async call(input, context) {
        const parsed = TaskGetInputSchema.parse(input)
        return getTask({ state: context.state } as never, parsed.taskId)
      },
    },
    {
      name: 'TaskList',
      description: toolDescription('TaskList', 'List structured task records.'),
      inputSchema: taskListToolSchema,
      async call(input, context) {
        TaskListInputSchema.parse(input ?? {})
        return listTasks({ state: context.state } as never)
      },
    },
    {
      name: 'TaskOutput',
      description: toolDescription('TaskOutput', 'Read the output of an agent task, optionally waiting for completion.'),
      inputSchema: taskOutputToolSchema,
      async call(input, context) {
        const parsed = TaskOutputInputSchema.parse(input)
        if (parsed.block) {
          await context.runtime.waitForTask(parsed.task_id, parsed.timeout)
        }
        return getTaskOutput({ state: context.state } as never, parsed.task_id)
      },
    },
    {
      name: 'TaskStop',
      description: toolDescription('TaskStop', 'Stop a running agent task.'),
      inputSchema: taskStopToolSchema,
      async call(input, context) {
        return stopTask({ state: context.state } as never, TaskStopInputSchema.parse(input))
      },
    },
    {
      name: 'TaskUpdate',
      description: toolDescription('TaskUpdate', 'Update metadata and status for a structured task record.'),
      inputSchema: taskUpdateToolSchema,
      async call(input, context) {
        return updateTask({ state: context.state } as never, TaskUpdateInputSchema.parse(input))
      },
    },
    {
      name: 'TeamCreate',
      description: toolDescription('TeamCreate', 'Create a logical multi-agent team.'),
      inputSchema: teamCreateToolSchema,
      async call(input, context) {
        return createTeam({
          createTeam: context.runtime.createTeam,
        } as never, TeamCreateInputSchema.parse(input))
      },
    },
    {
      name: 'TeamDelete',
      description: toolDescription('TeamDelete', 'Delete a logical team. Defaults to the default team if omitted.'),
      inputSchema: teamDeleteSchema,
      async call(input, context) {
        const parsed = teamDeleteInput.parse(input ?? {})
        return deleteCurrentTeam(
          { deleteTeam: context.runtime.deleteTeam } as never,
          parsed.team_name ?? 'default',
        )
      },
    },
    {
      name: 'Read',
      description: toolDescription('Read', 'Read a file from disk, optionally by line range.'),
      inputSchema: readSchema,
      call: runReadTool,
    },
    {
      name: 'Write',
      description: toolDescription('Write', 'Write a complete file to disk.'),
      inputSchema: writeSchema,
      call: runWriteTool,
    },
    {
      name: 'Edit',
      description: toolDescription('Edit', 'Replace text inside an existing file.'),
      inputSchema: editSchema,
      call: runEditTool,
    },
    {
      name: 'ListFiles',
      description: toolDescription('ListFiles', 'List files recursively from a directory.'),
      inputSchema: listFilesSchema,
      call: runListFilesTool,
    },
    {
      name: 'Search',
      description: toolDescription('Search', 'Search text across files in the workspace.'),
      inputSchema: searchSchema,
      call: runSearchTool,
    },
    {
      name: 'Shell',
      description: toolDescription('Shell', 'Run a local shell command in the workspace.'),
      inputSchema: shellSchema,
      call: runShellTool,
    },
    {
      name: 'WebFetch',
      description: toolDescription('WebFetch', 'Fetch a web page or JSON API over HTTP.'),
      inputSchema: webFetchSchema,
      call: runWebFetchTool,
    },
    {
      name: 'WebSearch',
      description: toolDescription('WebSearch', 'Search the public web for recent documentation or references.'),
      inputSchema: webSearchSchema,
      call: runWebSearchTool,
    },
  ]
}
