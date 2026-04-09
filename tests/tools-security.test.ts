import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { buildDefaultTools } from '../src/tools/defaultTools'
import { createMockWorkbench, createTempDir, removeDir } from './helpers'

test('filesystem policy blocks reads outside allowed roots', async () => {
  const baseDir = await createTempDir('agent-blueprint-tools-')
  const outsideDir = await createTempDir('agent-blueprint-tools-outside-')
  const workbench = createMockWorkbench(baseDir)

  try {
    const tools = buildDefaultTools()
    const readTool = tools.find(tool => tool.name === 'Read')
    assert.ok(readTool)

    await writeFile(join(outsideDir, 'secret.txt'), 'nope', 'utf8')

    await assert.rejects(
      () =>
        readTool!.call(
          { path: join(outsideDir, 'secret.txt') },
          workbench.runtime.createContext(baseDir),
        ),
      /outside the allowed workspace roots/i,
    )
  } finally {
    await workbench.shutdown()
    await removeDir(baseDir)
    await removeDir(outsideDir)
  }
})

test('shell policy blocks dangerous commands', async () => {
  const baseDir = await createTempDir('agent-blueprint-shell-')
  const workbench = createMockWorkbench(baseDir)

  try {
    const tools = buildDefaultTools()
    const shellTool = tools.find(tool => tool.name === 'Shell')
    assert.ok(shellTool)

    await assert.rejects(
      () =>
        shellTool!.call(
          { command: 'schtasks /create /tn bad /tr calc.exe' },
          workbench.runtime.createContext(baseDir),
        ),
      /blocked by policy/i,
    )
  } finally {
    await workbench.shutdown()
    await removeDir(baseDir)
  }
})
