import { createInterface } from 'readline/promises'
import { stdin as input, stdout as output } from 'process'
import { runCoordinatedWorkflow } from '../coordinator/coordinatorRuntime'
import type { RuntimeEvent } from '../events'
import type { McpServerConfig, TeamRecord } from '../types'
import type { AgentWorkbench } from '../app'
import { formatAgentTask } from './agentUi'
import { renderDashboard } from './dashboard'
import { formatTaskList } from './taskUi'

function splitCommandPayload(line: string): [string, string] {
  const idx = line.indexOf('::')
  if (idx === -1) return [line.trim(), '']
  return [line.slice(0, idx).trim(), line.slice(idx + 2).trim()]
}

function parseAspects(raw: string): string[] {
  return raw
    .split('|')
    .map(part => part.trim())
    .filter(Boolean)
}

function parseJson(raw: string): unknown {
  if (!raw.trim()) return {}
  return JSON.parse(raw)
}

async function withLiveStreaming<T>(
  workbench: AgentWorkbench,
  execute: () => Promise<T>,
): Promise<T> {
  let lastStreamKey = ''
  let hasOpenLine = false
  const handler = (event: RuntimeEvent): void => {
    if (event.type === 'agent.output.delta') {
      const taskId = String(event.payload?.taskId ?? '')
      const agentType = String(event.payload?.agentType ?? 'agent')
      if (taskId !== lastStreamKey) {
        if (hasOpenLine) {
          output.write('\n')
        }
        output.write(`[stream ${agentType} ${taskId.slice(0, 8)}] `)
        lastStreamKey = taskId
      }
      output.write(String(event.payload?.delta ?? ''))
      hasOpenLine = true
      return
    }

    if (event.type === 'tool.called') {
      if (hasOpenLine) output.write('\n')
      output.write(
        `[tool ${String(event.payload?.tool ?? 'unknown')} ${String(event.payload?.taskId ?? '').slice(0, 8)}]\n`,
      )
      hasOpenLine = false
    }
  }

  workbench.runtime.events.on('event', handler)
  try {
    return await execute()
  } finally {
    workbench.runtime.events.off('event', handler)
    if (hasOpenLine) {
      output.write('\n')
    }
  }
}

export async function startRepl(workbench: AgentWorkbench): Promise<void> {
  const runtime = workbench.runtime
  const rl = createInterface({ input, output })

  console.log('Agent Blueprint REPL+')
  console.log('Commands: help, dashboard, agents, spawn, message, tasks, teams, events, orchestrate, mcp, remote, save, load, quit')

  try {
    while (true) {
      let line = ''
      try {
        line = (await rl.question('> ')).trim()
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ERR_USE_AFTER_CLOSE') {
          break
        }
        throw error
      }
      if (!line) continue
      if (line === 'quit' || line === 'exit') break
      if (line === 'help') {
        console.log('dashboard')
        console.log('agents')
        console.log('spawn <agentType> <description> :: <prompt>')
        console.log('message <agentIdOrName> :: <message>')
        console.log('tasks')
        console.log('teams')
        console.log('events [limit]')
        console.log('isolation')
        console.log('orchestrate <goal> :: <aspect1> | <aspect2> | <aspect3>')
        console.log('mcp demo [name]')
        console.log('mcp connect <name> :: <json-config>')
        console.log('mcp servers')
        console.log('mcp disconnect <server>')
        console.log('mcp profile list')
        console.log('mcp profile save <name> :: <description>')
        console.log('mcp profile activate <name>')
        console.log('mcp profile deactivate [name]')
        console.log('mcp profile delete <name>')
        console.log('mcp tools <server>')
        console.log('mcp call <server> <tool> :: <json>')
        console.log('remote start [port] [token]')
        console.log('remote stop')
        console.log('save [dir]')
        console.log('load [dir]')
        continue
      }
      if (line === 'dashboard') {
        console.log(renderDashboard(runtime))
        continue
      }
      if (line === 'agents') {
        console.log(
          runtime
            .listAgents()
            .map(a => `- ${a.agentType}: ${a.whenToUse}`)
            .join('\n'),
        )
        continue
      }
      if (line === 'tasks') {
        console.log(formatTaskList(Array.from(runtime.state.taskRecords.values())))
        console.log(
          Array.from(runtime.state.agentTasks.values()).map(formatAgentTask).join('\n\n') ||
            'No agent tasks found.',
        )
        continue
      }
      if (line === 'teams') {
        const teams = Array.from(runtime.state.teams.values()) as TeamRecord[]
        if (teams.length === 0) {
          console.log('No teams found.')
        } else {
          for (const team of teams) {
            console.log(`- ${team.name} (${team.members.length} member(s))`)
          }
        }
        continue
      }
      if (line.startsWith('events')) {
        const [, limitRaw] = line.split(' ')
        const limit = limitRaw ? Number(limitRaw) : 20
        console.log(
          workbench
            .getRecentEvents(limit)
            .map(event => `${new Date(event.timestamp).toISOString()} ${event.type} ${JSON.stringify(event.payload ?? {})}`)
            .join('\n') || 'No events.',
        )
        continue
      }
      if (line === 'isolation') {
        const isolation = runtime.options.security?.processIsolation
        console.log(
          JSON.stringify(
            {
              detectedProviders: isolation?.detectedProviders ?? {},
              defaultShellProfile: isolation?.defaultShellProfile ?? null,
              defaultMcpProfile: isolation?.defaultMcpProfile ?? null,
              profiles: isolation?.profiles ?? {},
            },
            null,
            2,
          ),
        )
        continue
      }
      if (line.startsWith('spawn ')) {
        const rest = line.slice(6)
        const [left, prompt = ''] = splitCommandPayload(rest)
        const parts = left.trim().split(' ')
        const agentType = parts.shift()
        const description = parts.join(' ').trim() || 'Ad hoc task'
        const task = await withLiveStreaming(workbench, () =>
          runtime.spawnAgent({
            description,
            prompt: prompt.trim() || description,
            subagent_type: agentType,
          }),
        )
        console.log(formatAgentTask(task))
        continue
      }
      if (line.startsWith('message ')) {
        const rest = line.slice(8)
        const [target, message = ''] = splitCommandPayload(rest)
        const task = await withLiveStreaming(workbench, () =>
          runtime.continueAgent(target.trim(), message.trim()),
        )
        console.log(formatAgentTask(task))
        continue
      }
      if (line.startsWith('orchestrate ')) {
        const rest = line.slice('orchestrate '.length)
        const [goal, aspectsRaw] = splitCommandPayload(rest)
        const result = await withLiveStreaming(workbench, () =>
          runCoordinatedWorkflow(runtime, {
            goal,
            aspects: parseAspects(aspectsRaw),
            teamName: 'coordination',
            verify: true,
          }),
        )
        console.log(`Team: ${result.teamName}`)
        console.log('Research:')
        console.log(result.researchTasks.map(formatAgentTask).join('\n\n'))
        console.log('\nSynthesis:')
        console.log(formatAgentTask(result.synthesisTask))
        if (result.verificationTask) {
          console.log('\nVerification:')
          console.log(formatAgentTask(result.verificationTask))
        }
        continue
      }
      if (line.startsWith('mcp ')) {
        const rest = line.slice(4).trim()
        if (rest.startsWith('demo')) {
          const [, name] = rest.split(' ')
          await workbench.connectDemoMcp(name || 'demo')
          console.log(`Connected demo MCP server as '${name || 'demo'}'`)
          continue
        }
        if (rest.startsWith('connect ')) {
          const payload = rest.slice('connect '.length)
          const [name, json = '{}'] = splitCommandPayload(payload)
          const config = parseJson(json) as McpServerConfig
          await workbench.connectMcp(name.trim(), config)
          console.log(`Connected MCP server '${name.trim()}'`)
          continue
        }
        if (rest === 'servers') {
          const servers = workbench.listMcpConnections()
          console.log(
            servers.map(server => `- ${server.name} [${server.config.transport}] tools=${server.tools.length}`).join('\n') ||
              'No MCP servers connected.',
          )
          continue
        }
        if (rest.startsWith('disconnect ')) {
          const server = rest.slice('disconnect '.length).trim()
          await workbench.disconnectMcp(server)
          console.log(`Disconnected MCP server '${server}'`)
          continue
        }
        if (rest.startsWith('profile ')) {
          const profileRest = rest.slice('profile '.length).trim()
          if (profileRest === 'list') {
            const active = workbench.getActiveMcpProfile()
            const profiles = workbench.listMcpProfiles()
            console.log(
              profiles
                .map(
                  profile =>
                    `- ${profile.name}${active === profile.name ? ' [active]' : ''} connections=${profile.connections.length}${profile.description ? `: ${profile.description}` : ''}`,
                )
                .join('\n') || 'No MCP profiles saved.',
            )
            continue
          }
          if (profileRest.startsWith('save ')) {
            const payload = profileRest.slice('save '.length)
            const [name, description = ''] = splitCommandPayload(payload)
            const profile = await workbench.saveCurrentAsMcpProfile(
              name.trim(),
              description.trim() || undefined,
            )
            console.log(
              `Saved MCP profile '${profile.name}' with ${profile.connections.length} connection(s)`,
            )
            continue
          }
          if (profileRest.startsWith('activate ')) {
            const name = profileRest.slice('activate '.length).trim()
            const result = await workbench.activateMcpProfile(name)
            console.log(
              `Activated MCP profile '${result.name}' connected=${result.connected.join(', ') || 'none'}${result.failed.length ? ` failed=${result.failed.map(entry => `${entry.name}:${entry.error}`).join('; ')}` : ''}`,
            )
            continue
          }
          if (profileRest.startsWith('deactivate')) {
            const name = profileRest.slice('deactivate'.length).trim() || undefined
            const result = await workbench.deactivateMcpProfile(name)
            console.log(
              result.name
                ? `Deactivated MCP profile '${result.name}' disconnected=${result.disconnected.join(', ') || 'none'}`
                : 'No active MCP profile.',
            )
            continue
          }
          if (profileRest.startsWith('delete ')) {
            const name = profileRest.slice('delete '.length).trim()
            const deleted = await workbench.deleteMcpProfile(name)
            console.log(
              deleted
                ? `Deleted MCP profile '${name}'`
                : `No MCP profile '${name}' found`,
            )
            continue
          }
        }
        if (rest.startsWith('tools ')) {
          const server = rest.slice(6).trim()
          const tools = await workbench.mcp.refreshTools(server)
          console.log(tools.map(tool => `- ${tool.name}${tool.description ? `: ${tool.description}` : ''}`).join('\n'))
          continue
        }
        if (rest.startsWith('call ')) {
          const payload = rest.slice(5)
          const [left, json = '{}'] = splitCommandPayload(payload)
          const [server, tool] = left.split(' ')
          const result = await workbench.mcp.callTool(server, tool, parseJson(json))
          console.log(JSON.stringify(result, null, 2))
          continue
        }
      }
      if (line.startsWith('remote ')) {
        const rest = line.slice(7).trim()
        if (rest.startsWith('start')) {
          const [, portRaw, token] = rest.split(' ')
          const port = portRaw ? Number(portRaw) : 8787
          await workbench.startRemote(port, token)
          const resolvedToken = workbench.getRemoteToken()
          const url = resolvedToken
            ? `http://localhost:${port}/?token=${encodeURIComponent(resolvedToken)}`
            : `http://localhost:${port}`
          console.log(`Remote control listening on ${url}`)
          continue
        }
        if (rest === 'stop') {
          await workbench.stopRemote()
          console.log('Remote control stopped')
          continue
        }
      }
      if (line.startsWith('save')) {
        const [, dir] = line.split(' ')
        await workbench.saveSession(dir)
        console.log(`Session saved${dir ? ` to ${dir}` : ''}`)
        continue
      }
      if (line.startsWith('load')) {
        const [, dir] = line.split(' ')
        const loaded = await workbench.loadSession(dir)
        console.log(loaded ? 'Session loaded' : 'No session found')
        continue
      }
      console.log('Unknown command. Type help.')
    }
  } finally {
    rl.close()
  }
}

