import { Buffer } from 'buffer'

export type JsonRpcRequest = {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: unknown
}

export type JsonRpcNotification = {
  jsonrpc: '2.0'
  method: string
  params?: unknown
}

export type JsonRpcSuccess = {
  jsonrpc: '2.0'
  id: number
  result: unknown
}

export type JsonRpcError = {
  jsonrpc: '2.0'
  id: number | null
  error: {
    code: number
    message: string
    data?: unknown
  }
}

export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcSuccess
  | JsonRpcError

export function encodeContentLengthMessage(message: JsonRpcMessage): Buffer {
  const payload = Buffer.from(JSON.stringify(message), 'utf8')
  const header = Buffer.from(`Content-Length: ${payload.length}\r\n\r\n`, 'utf8')
  return Buffer.concat([header, payload])
}

export class ContentLengthParser {
  private buffer = Buffer.alloc(0)

  push(chunk: Buffer): JsonRpcMessage[] {
    this.buffer = Buffer.concat([this.buffer, chunk])
    const messages: JsonRpcMessage[] = []

    while (true) {
      const separatorIndex = this.buffer.indexOf('\r\n\r\n')
      if (separatorIndex === -1) break

      const headerRaw = this.buffer.subarray(0, separatorIndex).toString('utf8')
      const match = headerRaw.match(/Content-Length:\s*(\d+)/i)
      if (!match) {
        throw new Error(`Invalid header: ${headerRaw}`)
      }

      const contentLength = Number(match[1])
      const totalLength = separatorIndex + 4 + contentLength
      if (this.buffer.length < totalLength) break

      const payload = this.buffer
        .subarray(separatorIndex + 4, totalLength)
        .toString('utf8')
      this.buffer = this.buffer.subarray(totalLength)
      messages.push(JSON.parse(payload) as JsonRpcMessage)
    }

    return messages
  }
}
