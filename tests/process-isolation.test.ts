import test from 'node:test'
import assert from 'node:assert/strict'
import { buildIsolatedExecutionPlan } from '../src/security/processIsolation'

test('docker shell isolation wraps command in container', () => {
  const plan = buildIsolatedExecutionPlan({
    kind: 'shell',
    cwd: 'C:\\workspace\\project',
    command: 'node -e "console.log(42)"',
    security: {
      processIsolation: {
        detectedProviders: { docker: true },
        defaultShellProfile: 'docker-shell',
        profiles: {
          'docker-shell': {
            name: 'docker-shell',
            provider: 'docker',
            image: 'node:22-alpine',
            network: 'none',
            workspaceMountPath: '/workspace',
            workspaceReadOnly: false,
          },
        },
      },
    },
  })

  assert.equal(plan.command, 'docker')
  assert.equal(plan.isolated, true)
  assert.equal(plan.provider, 'docker')
  assert.ok(plan.args.includes('node:22-alpine'))
  assert.ok(plan.args.includes('sh'))
  assert.ok(plan.args.includes('-lc'))
})

test('docker stdio isolation remaps node command and workspace paths', () => {
  const plan = buildIsolatedExecutionPlan({
    kind: 'mcp_stdio',
    cwd: 'C:\\workspace\\project',
    command: 'C:\\Program Files\\nodejs\\node.exe',
    args: ['C:\\workspace\\project\\dist\\mcp\\demoServer.js', '--stdio'],
    security: {
      processIsolation: {
        detectedProviders: { docker: true },
        defaultMcpProfile: 'docker-stdio',
        profiles: {
          'docker-stdio': {
            name: 'docker-stdio',
            provider: 'docker',
            image: 'node:22-alpine',
            network: 'none',
            workspaceMountPath: '/workspace',
            workspaceReadOnly: false,
            hostFallback: 'warn',
          },
        },
      },
    },
  })

  assert.equal(plan.command, 'docker')
  assert.equal(plan.isolated, true)
  assert.ok(plan.args.includes('node'))
  assert.ok(plan.args.includes('/workspace/dist/mcp/demoServer.js'))
})
