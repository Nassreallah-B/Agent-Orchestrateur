import { join } from 'path'
import { tmpdir } from 'os'
import { mkdtemp, rm } from 'fs/promises'
import { AgentWorkbench } from '../src/app'
import { getBuiltInAgents } from '../src/builtins'
import { getCoordinatorAgents } from '../src/coordinator/workerAgent'
import { resolveFeatureFlags } from '../src/featureFlags'
import { mockModelInvoker } from '../src/mockModel'
import { AgentRuntime } from '../src/runtime'
import { buildDefaultTools } from '../src/tools/defaultTools'

export async function createTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix))
}

export async function removeDir(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true })
}

export function createMockWorkbench(baseDir: string): AgentWorkbench {
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

  const runtime = new AgentRuntime({
    invokeModel: mockModelInvoker,
    options: {
      persistenceDir: baseDir,
      featureFlags,
      maxToolRounds: 6,
      models: {
        defaultMain: 'sonnet',
        defaultSubagent: 'haiku',
        aliases: {},
      },
      provider: {
        name: 'mock',
        model: 'mock',
      },
      security: {
        shell: {
          enabled: true,
          sanitizeEnv: true,
          maxTimeoutMs: 10_000,
          maxStdoutBytes: 8_000,
          maxStderrBytes: 4_000,
        },
        filesystem: {
          allowedRoots: [baseDir],
          maxReadBytes: 128 * 1024,
          maxWriteBytes: 128 * 1024,
        },
        remote: {
          requireToken: true,
          allowQueryTokenBootstrap: true,
          maxBodyBytes: 512,
          requestsPerMinute: 240,
          mutationRequestsPerMinute: 120,
          sessionTtlMs: 60_000,
        },
        llm: {
          requestsPerMinute: 120,
          concurrency: 4,
          maxRetries: 1,
          baseDelayMs: 10,
          maxDelayMs: 50,
        },
        mcp: {
          requestsPerMinute: 120,
          concurrency: 4,
          maxRetries: 1,
          baseDelayMs: 10,
          maxDelayMs: 50,
          timeoutMs: 10_000,
          allowedTransports: ['stdio', 'http', 'sse', 'ws'],
        },
        quotas: {
          maxStoredTasks: 100,
          maxConcurrentTasks: 10,
          maxTeams: 10,
        },
      },
      logging: {
        console: false,
        filePath: join(baseDir, 'runtime.log'),
        auditFilePath: join(baseDir, 'audit.log'),
      },
    },
    tools: buildDefaultTools(),
    agents: [...builtIns, ...getCoordinatorAgents()],
  })

  return new AgentWorkbench(runtime)
}
