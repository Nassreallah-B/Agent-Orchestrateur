import type { AgentRuntime } from '../runtime'
import type { AgentTask } from '../types'

export type WorkerSpec = {
  description: string
  prompt: string
  name?: string
  model?: string
}

export type OrchestrationResult = {
  teamName: string
  researchTasks: AgentTask[]
  synthesisTask: AgentTask
  verificationTask?: AgentTask
}

export async function spawnWorkersInParallel(
  runtime: AgentRuntime,
  workers: WorkerSpec[],
  teamName?: string,
): Promise<AgentTask[]> {
  runtime.events.emitEvent('coordinator.workers.spawning', {
    teamName,
    count: workers.length,
    workers: workers.map(worker => worker.name ?? worker.description),
  })

  const tasks = await Promise.all(
    workers.map(worker =>
      runtime.spawnAgent({
        description: worker.description,
        prompt: worker.prompt,
        subagent_type: 'worker',
        name: worker.name,
        model: worker.model,
        run_in_background: true,
        team_name: teamName,
      }),
    ),
  )

  runtime.events.emitEvent('coordinator.workers.spawned', {
    teamName,
    tasks: tasks.map(task => ({
      taskId: task.id,
      agentId: task.agentId,
      description: task.description,
    })),
  })

  return tasks
}

export async function waitForAllTasks(
  runtime: AgentRuntime,
  tasks: AgentTask[],
  timeoutMs = 60000,
): Promise<AgentTask[]> {
  const completed = await Promise.all(
    tasks.map(task => runtime.waitForTask(task.id, timeoutMs)),
  )
  runtime.events.emitEvent('coordinator.workers.completed', {
    completed: completed.map(task => ({
      taskId: task.id,
      agentId: task.agentId,
      status: task.status,
      description: task.description,
    })),
  })
  return completed
}

export async function synthesizeWorkerResults(
  runtime: AgentRuntime,
  goal: string,
  tasks: AgentTask[],
): Promise<AgentTask> {
  const findings = tasks
    .map(task => `## ${task.description}\n${task.result ?? task.output ?? ''}`)
    .join('\n\n')

  runtime.events.emitEvent('coordinator.synthesis.started', {
    goal,
    inputCount: tasks.length,
  })

  const task = await runtime.spawnAgent({
    description: 'Synthesize findings',
    prompt: [
      `Goal: ${goal}`,
      'Synthesize the worker outputs into one coherent report.',
      'Highlight conflicts, concrete findings, and next actions.',
      findings,
    ].join('\n\n'),
    subagent_type: 'general-purpose',
    run_in_background: false,
  })

  runtime.events.emitEvent('coordinator.synthesis.completed', {
    goal,
    taskId: task.id,
    agentId: task.agentId,
    status: task.status,
  })

  return task
}

export async function runCoordinatedWorkflow(
  runtime: AgentRuntime,
  input: {
    goal: string
    aspects: string[]
    teamName?: string
    verify?: boolean
  },
): Promise<OrchestrationResult> {
  const teamName = input.teamName ?? 'coordination'
  runtime.events.emitEvent('coordinator.started', {
    goal: input.goal,
    teamName,
    aspects: input.aspects,
    verify: input.verify !== false,
  })
  if (!runtime.state.teams.has(teamName)) {
    runtime.createTeam({
      team_name: teamName,
      description: `Coordinator workflow for: ${input.goal}`,
      agent_type: 'team-lead',
    })
  }

  const workers = input.aspects.map((aspect, index) => ({
    description: `Research ${aspect}`,
    prompt: [
      `Overall goal: ${input.goal}`,
      `Your assigned aspect: ${aspect}`,
      'Investigate this area, produce concrete findings, and suggest next implementation or verification steps.',
    ].join('\n\n'),
    name: `worker-${index + 1}`,
  }))

  const spawned = await spawnWorkersInParallel(runtime, workers, teamName)
  const completed = await waitForAllTasks(runtime, spawned)
  const synthesisTask = await synthesizeWorkerResults(runtime, input.goal, completed)

  let verificationTask: AgentTask | undefined
  if (input.verify !== false) {
    runtime.events.emitEvent('coordinator.verification.started', {
      goal: input.goal,
      teamName,
      synthesisTaskId: synthesisTask.id,
    })
    verificationTask = await runtime.spawnAgent({
      description: 'Verify synthesis',
      prompt: [
        `Goal: ${input.goal}`,
        'Review the synthesized report below and verify that it is actionable and internally consistent.',
        synthesisTask.result ?? synthesisTask.output,
      ].join('\n\n'),
      subagent_type: 'verification',
      run_in_background: false,
    })
    runtime.events.emitEvent('coordinator.verification.completed', {
      goal: input.goal,
      teamName,
      taskId: verificationTask.id,
      status: verificationTask.status,
    })
  }

  runtime.events.emitEvent('coordinator.completed', {
    goal: input.goal,
    teamName,
    researchCount: completed.length,
    synthesisTaskId: synthesisTask.id,
    verificationTaskId: verificationTask?.id,
  })

  return {
    teamName,
    researchTasks: completed,
    synthesisTask,
    verificationTask,
  }
}
