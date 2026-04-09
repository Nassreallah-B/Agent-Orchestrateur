import { basename, relative, resolve } from 'path'
import { spawnSync } from 'child_process'
import type {
  ProcessIsolationOptions,
  ProcessIsolationProfile,
  RuntimeSecurityOptions,
} from '../types'

export type IsolatedExecutionPlan = {
  command: string
  args: string[]
  cwd: string
  env?: NodeJS.ProcessEnv
  isolated: boolean
  provider: ProcessIsolationProfile['provider']
  profileName?: string
  warnings: string[]
}

type ShellIsolationRequest = {
  kind: 'shell'
  cwd: string
  command: string
  env?: NodeJS.ProcessEnv
  security?: RuntimeSecurityOptions
  profileName?: string
}

type StdioIsolationRequest = {
  kind: 'mcp_stdio'
  cwd: string
  command: string
  args?: string[]
  env?: NodeJS.ProcessEnv
  security?: RuntimeSecurityOptions
  profileName?: string
}

export type IsolationRequest = ShellIsolationRequest | StdioIsolationRequest

const PROVIDER_BINARY: Record<Exclude<ProcessIsolationProfile['provider'], 'none'>, string> = {
  docker: 'docker',
  firejail: 'firejail',
  bubblewrap: 'bwrap',
}

const PROVIDER_PROBE_ARGS: Record<Exclude<ProcessIsolationProfile['provider'], 'none'>, string[]> = {
  docker: ['info', '--format', '{{json .ServerVersion}}'],
  firejail: ['--version'],
  bubblewrap: ['--version'],
}

const DEFAULT_COMMAND_MAP: Record<string, string> = {
  node: 'node',
  'node.exe': 'node',
  python: 'python',
  'python.exe': 'python',
  bash: 'bash',
  'bash.exe': 'bash',
  sh: 'sh',
}

export function detectAvailableIsolationProviders(): Partial<Record<ProcessIsolationProfile['provider'], boolean>> {
  const result: Partial<Record<ProcessIsolationProfile['provider'], boolean>> = {
    none: true,
  }

  for (const [provider, binary] of Object.entries(PROVIDER_BINARY)) {
    const probe = spawnSync(binary, PROVIDER_PROBE_ARGS[provider as keyof typeof PROVIDER_BINARY], {
      stdio: 'ignore',
      shell: false,
      windowsHide: true,
    })
    result[provider as keyof typeof PROVIDER_BINARY] = probe.status === 0
  }

  return result
}

function getProcessIsolationConfig(security?: RuntimeSecurityOptions): ProcessIsolationOptions {
  return security?.processIsolation ?? {}
}

function getProfile(
  security: RuntimeSecurityOptions | undefined,
  profileName: string | undefined,
  fallbackName: string | undefined,
): ProcessIsolationProfile | undefined {
  const config = getProcessIsolationConfig(security)
  const resolvedName = profileName ?? fallbackName
  if (!resolvedName) return undefined
  return config.profiles?.[resolvedName]
}

function detectProviderAvailable(
  security: RuntimeSecurityOptions | undefined,
  provider: ProcessIsolationProfile['provider'],
): boolean {
  if (provider === 'none') return true
  const detected = getProcessIsolationConfig(security).detectedProviders?.[provider]
  if (typeof detected === 'boolean') return detected
  const binary = PROVIDER_BINARY[provider]
  const probe = spawnSync(binary, PROVIDER_PROBE_ARGS[provider], {
    stdio: 'ignore',
    shell: false,
    windowsHide: true,
  })
  return probe.status === 0
}

function resolveShellPlan(request: ShellIsolationRequest): IsolatedExecutionPlan {
  const security = request.security
  const profile = getProfile(
    security,
    request.profileName,
    security?.processIsolation?.defaultShellProfile,
  )

  if (!profile || profile.provider === 'none') {
    if (process.platform === 'win32') {
      return {
        command: 'cmd.exe',
        args: ['/d', '/s', '/c', request.command],
        cwd: request.cwd,
        env: request.env,
        isolated: false,
        provider: 'none',
        profileName: profile?.name,
        warnings: [],
      }
    }
    return {
      command: 'sh',
      args: ['-lc', request.command],
      cwd: request.cwd,
      env: request.env,
      isolated: false,
      provider: 'none',
      profileName: profile?.name,
      warnings: [],
    }
  }

  if (profile.provider === 'docker') {
    if (!detectProviderAvailable(security, 'docker')) {
      throw new Error(`Isolation provider 'docker' is not available`)
    }
    const mountPath = profile.workspaceMountPath ?? '/workspace'
    const image = profile.image ?? 'node:22-alpine'
    const dockerArgs = [
      'run',
      '--rm',
      '--init',
      '-i',
      '--workdir',
      mountPath,
      '--mount',
      `type=bind,src=${request.cwd},dst=${mountPath}${profile.workspaceReadOnly ? ',readonly' : ''}`,
      '--network',
      profile.network ?? 'none',
      ...(profile.extraArgs ?? []),
      image,
      'sh',
      '-lc',
      request.command,
    ]

    return {
      command: 'docker',
      args: dockerArgs,
      cwd: request.cwd,
      env: request.env,
      isolated: true,
      provider: 'docker',
      profileName: profile.name,
      warnings: [],
    }
  }

  throw new Error(`Unsupported shell isolation provider '${profile.provider}'`)
}

function rewritePathForContainer(hostPath: string, cwd: string, mountPath: string): string {
  const resolvedHostPath = resolve(hostPath)
  const resolvedCwd = resolve(cwd)
  const rel = relative(resolvedCwd, resolvedHostPath)
  if (rel && !rel.startsWith('..') && !rel.includes(':')) {
    return `${mountPath}/${rel.replace(/\\/g, '/')}`
  }
  if (resolvedHostPath === resolvedCwd) {
    return mountPath
  }
  return hostPath
}

function mapCommandForContainer(
  command: string,
  profile: ProcessIsolationProfile,
): string | null {
  const key = basename(command).toLowerCase()
  return profile.commandMap?.[key] ?? DEFAULT_COMMAND_MAP[key] ?? null
}

function resolveStdioPlan(request: StdioIsolationRequest): IsolatedExecutionPlan {
  const security = request.security
  const profile = getProfile(
    security,
    request.profileName,
    security?.processIsolation?.defaultMcpProfile,
  )

  if (!profile || profile.provider === 'none') {
    return {
      command: request.command,
      args: request.args ?? [],
      cwd: request.cwd,
      env: request.env,
      isolated: false,
      provider: 'none',
      profileName: profile?.name,
      warnings: [],
    }
  }

  if (profile.provider === 'docker') {
    if (!detectProviderAvailable(security, 'docker')) {
      throw new Error(`Isolation provider 'docker' is not available`)
    }

    const mappedCommand = mapCommandForContainer(request.command, profile)
    if (!mappedCommand) {
      const fallback = profile.hostFallback ?? 'error'
      if (fallback === 'allow' || fallback === 'warn') {
        return {
          command: request.command,
          args: request.args ?? [],
          cwd: request.cwd,
          env: request.env,
          isolated: false,
          provider: 'none',
          profileName: profile.name,
          warnings: [`MCP stdio command '${request.command}' could not be mapped into Docker`],
        }
      }
      throw new Error(`MCP stdio command '${request.command}' cannot run inside Docker without a command mapping`)
    }

    const mountPath = profile.workspaceMountPath ?? '/workspace'
    const image = profile.image ?? 'node:22-alpine'
    const mappedArgs = (request.args ?? []).map(arg => rewritePathForContainer(arg, request.cwd, mountPath))
    const envAllowList = profile.envAllowList ?? []
    const envArgs = envAllowList.flatMap(name => {
      const value = request.env?.[name] ?? process.env[name]
      return value !== undefined ? ['-e', `${name}=${value}`] : []
    })
    const dockerArgs = [
      'run',
      '--rm',
      '--init',
      '-i',
      '--workdir',
      mountPath,
      '--mount',
      `type=bind,src=${request.cwd},dst=${mountPath}${profile.workspaceReadOnly ? ',readonly' : ''}`,
      '--network',
      profile.network ?? 'none',
      ...envArgs,
      ...(profile.extraArgs ?? []),
      image,
      mappedCommand,
      ...mappedArgs,
    ]

    return {
      command: 'docker',
      args: dockerArgs,
      cwd: request.cwd,
      env: request.env,
      isolated: true,
      provider: 'docker',
      profileName: profile.name,
      warnings: [],
    }
  }

  if (profile.provider === 'firejail') {
    if (!detectProviderAvailable(security, 'firejail')) {
      throw new Error(`Isolation provider 'firejail' is not available`)
    }
    return {
      command: 'firejail',
      args: [
        '--quiet',
        '--private-tmp',
        '--whitelist=' + request.cwd,
        ...(profile.network === 'none' ? ['--net=none'] : []),
        ...(profile.extraArgs ?? []),
        request.command,
        ...(request.args ?? []),
      ],
      cwd: request.cwd,
      env: request.env,
      isolated: true,
      provider: 'firejail',
      profileName: profile.name,
      warnings: [],
    }
  }

  if (profile.provider === 'bubblewrap') {
    if (!detectProviderAvailable(security, 'bubblewrap')) {
      throw new Error(`Isolation provider 'bubblewrap' is not available`)
    }
    return {
      command: 'bwrap',
      args: [
        '--bind',
        request.cwd,
        '/workspace',
        '--chdir',
        '/workspace',
        '--proc',
        '/proc',
        '--dev',
        '/dev',
        '--unshare-all',
        ...(profile.network === 'host' ? ['--share-net'] : []),
        ...(profile.extraArgs ?? []),
        request.command,
        ...(request.args ?? []),
      ],
      cwd: request.cwd,
      env: request.env,
      isolated: true,
      provider: 'bubblewrap',
      profileName: profile.name,
      warnings: [],
    }
  }

  throw new Error(`Unsupported MCP stdio isolation provider '${profile.provider}'`)
}

export function buildIsolatedExecutionPlan(
  request: IsolationRequest,
): IsolatedExecutionPlan {
  return request.kind === 'shell'
    ? resolveShellPlan(request)
    : resolveStdioPlan(request)
}
