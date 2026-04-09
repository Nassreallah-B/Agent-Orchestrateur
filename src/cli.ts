import { join } from 'path'
import { AgentWorkbench } from './app'
import { getBuiltInAgents } from './builtins'
import { getCoordinatorAgents } from './coordinator/workerAgent'
import { resolveFeatureFlags } from './featureFlags'
import { createHuggingFaceInvoker, loadHuggingFaceConfigFromEnv } from './llm/huggingface'
import { mockModelInvoker } from './mockModel'
import { AgentRuntime } from './runtime'
import { detectAvailableIsolationProviders } from './security/processIsolation'
import { buildDefaultTools } from './tools/defaultTools'
import { startDemoMcpServer } from './mcp/demoServer'
import { startRepl } from './ui/repl'

function selectProvider() {
  const forceMock = process.argv.includes('--mock') || process.env.AGENT_BLUEPRINT_PROVIDER === 'mock'
  const preferHf =
    process.argv.includes('--huggingface') ||
    process.env.AGENT_BLUEPRINT_PROVIDER === 'huggingface' ||
    Boolean(process.env.HF_TOKEN || process.env.HF_BASE_URL || process.env.OPENAI_BASE_URL)

  if (!forceMock && preferHf) {
    const config = loadHuggingFaceConfigFromEnv()
    return {
      invokeModel: createHuggingFaceInvoker(config),
      provider: {
        name: 'huggingface-openai-compatible',
        baseUrl: config.baseUrl,
        model: config.model,
      },
      models: {
        defaultMain: config.model,
        defaultSubagent: config.model,
        aliases: {
          sonnet: config.model,
          haiku: config.model,
          opus: config.model,
          inherit: config.model,
        } as Record<string, string>,
      },
    }
  }

  return {
    invokeModel: mockModelInvoker,
    provider: {
      name: 'mock',
      model: 'mock',
    },
    models: {
      defaultMain: 'sonnet',
      defaultSubagent: 'haiku',
      aliases: {} as Record<string, string>,
    },
  }
}

async function main(): Promise<void> {
  if (process.argv.includes('--mcp-demo-server')) {
    startDemoMcpServer()
    return
  }

  const featureFlags = resolveFeatureFlags({
    forkSubagent: false,
    explorePlanAgents: true,
    verificationAgent: true,
    coordinatorMode: true,
    analytics: true,
    mcp: true,
    persistence: true,
    remoteControl: true,
  })

  const builtIns = getBuiltInAgents({
    enableExplorePlan: featureFlags.explorePlanAgents,
    includeGuide: true,
    includeVerification: featureFlags.verificationAgent,
  })

  const provider = selectProvider()
  const persistenceDir = '.agent-blueprint-state'
  const detectedIsolationProviders = detectAvailableIsolationProviders()
  const dockerImage = process.env.AGENT_BLUEPRINT_DOCKER_IMAGE ?? 'node:22-alpine'
  const defaultShellIsolationProfile = detectedIsolationProviders.docker
    ? 'docker-shell'
    : undefined
  const defaultMcpIsolationProfile = detectedIsolationProviders.docker
    ? 'docker-stdio'
    : undefined
  const runtime = new AgentRuntime({
    invokeModel: provider.invokeModel,
    options: {
      featureFlags,
      persistenceDir,
      models: provider.models,
      provider: provider.provider,
      maxToolRounds: 10,
      security: {
        shell: {
          enabled: true,
          maxTimeoutMs: 30_000,
          maxStdoutBytes: 16_000,
          maxStderrBytes: 8_000,
          sanitizeEnv: true,
        },
        filesystem: {
          allowedRoots: [process.cwd()],
          maxReadBytes: 256 * 1024,
          maxWriteBytes: 256 * 1024,
          denyPathPatterns: ['[\\\\/]\\.git[\\\\/]', '[\\\\/]node_modules[\\\\/].*\\.bin[\\\\/]'],
        },
        remote: {
          requireToken: true,
          allowQueryTokenBootstrap: true,
          maxBodyBytes: 64 * 1024,
          requestsPerMinute: 240,
          mutationRequestsPerMinute: 60,
          trustedOrigins: [],
          sessionTtlMs: 12 * 60 * 60 * 1000,
        },
        llm: {
          timeoutMs: 120_000,
          maxRetries: 2,
          baseDelayMs: 500,
          maxDelayMs: 5_000,
          requestsPerMinute: 60,
          concurrency: 4,
        },
        mcp: {
          timeoutMs: 30_000,
          maxRetries: 2,
          baseDelayMs: 250,
          maxDelayMs: 2_000,
          requestsPerMinute: 120,
          concurrency: 4,
          allowedTransports: ['stdio', 'http', 'sse', 'ws'],
        },
        processIsolation: {
          detectedProviders: detectedIsolationProviders,
          defaultShellProfile: defaultShellIsolationProfile,
          defaultMcpProfile: defaultMcpIsolationProfile,
          profiles: detectedIsolationProviders.docker
            ? {
                'docker-shell': {
                  name: 'docker-shell',
                  provider: 'docker',
                  image: dockerImage,
                  network: 'none',
                  workspaceMountPath: '/workspace',
                  workspaceReadOnly: false,
                  hostFallback: 'error',
                },
                'docker-stdio': {
                  name: 'docker-stdio',
                  provider: 'docker',
                  image: dockerImage,
                  network: 'none',
                  workspaceMountPath: '/workspace',
                  workspaceReadOnly: false,
                  hostFallback: 'warn',
                  envAllowList: ['PATH', 'HOME', 'HF_TOKEN', 'OPENAI_API_KEY'],
                },
              }
            : {},
        },
        quotas: {
          maxStoredTasks: 500,
          maxConcurrentTasks: 24,
          maxTeams: 32,
        },
        redactKeys: ['authorization', 'token', 'secret', 'password', 'api[-_]?key'],
      },
      logging: {
        level: process.env.AGENT_BLUEPRINT_LOG_LEVEL === 'debug' ? 'debug' : 'info',
        console: true,
        filePath: join(persistenceDir, 'logs', 'runtime.log'),
        auditFilePath: join(persistenceDir, 'logs', 'audit.log'),
      },
    },
    tools: buildDefaultTools(),
    agents: featureFlags.coordinatorMode
      ? [...builtIns, ...getCoordinatorAgents()]
      : builtIns,
  })

  await runtime.restoreFromPersistence()

  if (!runtime.state.teams.has('default')) {
    runtime.createTeam({
      team_name: 'default',
      description: 'Default demo team',
    })
  }

  console.log(
    `[provider] ${provider.provider.name} model=${provider.provider.model ?? runtime.options.models.defaultMain}`,
  )
  const isolation = runtime.options.security?.processIsolation
  const detected = isolation?.detectedProviders
    ? Object.entries(isolation.detectedProviders)
        .filter(([, available]) => available)
        .map(([name]) => name)
    : []
  console.log(
    `[isolation] providers=${detected.join(', ') || 'none'} shell=${isolation?.defaultShellProfile ?? 'none'} mcp=${isolation?.defaultMcpProfile ?? 'none'}`,
  )

  const workbench = new AgentWorkbench(runtime)
  const restoredProfiles = await workbench.restoreMcpProfiles()
  if (restoredProfiles.profiles.length > 0) {
    console.log(
      `[mcp] profiles ${restoredProfiles.profiles.join(', ')}${
        restoredProfiles.activeProfile
          ? ` (active=${restoredProfiles.activeProfile})`
          : ''
      }`,
    )
  }
  const restoredMcp = await workbench.restoreMcpConnections()
  if (restoredMcp.restored.length > 0) {
    console.log(`[mcp] restored ${restoredMcp.restored.join(', ')}`)
  }
  if (restoredMcp.failed.length > 0) {
    console.log(
      `[mcp] restore failed ${restoredMcp.failed
        .map(entry => `${entry.name}: ${entry.error}`)
        .join('; ')}`,
    )
  }
  try {
    await startRepl(workbench)
  } finally {
    await workbench.shutdown()
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
