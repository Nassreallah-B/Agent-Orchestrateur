import { stdin, stdout } from 'process'
import {
  ContentLengthParser,
  encodeContentLengthMessage,
  type JsonRpcError,
  type JsonRpcMessage,
  type JsonRpcSuccess,
} from './protocol'

const parser = new ContentLengthParser()

function write(message: JsonRpcMessage): void {
  stdout.write(encodeContentLengthMessage(message))
}

function success(id: number, result: unknown): JsonRpcSuccess {
  return {
    jsonrpc: '2.0',
    id,
    result,
  }
}

function failure(id: number | null, message: string): JsonRpcError {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code: -32000,
      message,
    },
  }
}

function handleMessage(message: JsonRpcMessage): void {
  if (!('method' in message)) return
  if (!('id' in message)) return

  switch (message.method) {
    case 'initialize':
      write(
        success(message.id, {
          protocolVersion: '2024-11-05',
          serverInfo: { name: 'demo-mcp', version: '0.1.0' },
          capabilities: {
            tools: {},
          },
        }),
      )
      return
    case 'tools/list':
      write(
        success(message.id, {
          tools: [
            {
              name: 'echo',
              description: 'Return the provided payload',
              inputSchema: {
                type: 'object',
                properties: {
                  value: { type: 'string' },
                },
              },
            },
            {
              name: 'time',
              description: 'Return the current ISO timestamp',
              inputSchema: { type: 'object', properties: {} },
            },
            {
              name: 'uppercase',
              description: 'Uppercase a string',
              inputSchema: {
                type: 'object',
                properties: {
                  value: { type: 'string' },
                },
              },
            },
          ],
        }),
      )
      return
    case 'tools/call': {
      const params = (message.params ?? {}) as {
        name?: string
        arguments?: Record<string, unknown>
      }
      const args = params.arguments ?? {}
      if (params.name === 'echo') {
        write(success(message.id, { content: [{ type: 'text', text: JSON.stringify(args) }] }))
        return
      }
      if (params.name === 'time') {
        write(success(message.id, { content: [{ type: 'text', text: new Date().toISOString() }] }))
        return
      }
      if (params.name === 'uppercase') {
        write(
          success(message.id, {
            content: [
              {
                type: 'text',
                text: String(args.value ?? '').toUpperCase(),
              },
            ],
          }),
        )
        return
      }
      write(failure(message.id, `Unknown tool '${params.name ?? 'unknown'}'`))
      return
    }
    default:
      write(failure(message.id, `Unknown method '${message.method}'`))
  }
}

export function startDemoMcpServer(): void {
  stdin.on('data', chunk => {
    for (const message of parser.push(Buffer.from(chunk))) {
      handleMessage(message)
    }
  })
}

if (process.argv.includes('--stdio')) {
  startDemoMcpServer()
}
