import type { McpServerConfig } from '../types'

export class McpRegistry {
  private readonly servers = new Map<string, McpServerConfig>()

  register(name: string, config: McpServerConfig): void {
    this.servers.set(name, config)
  }

  get(name: string): McpServerConfig | undefined {
    return this.servers.get(name)
  }

  list(): Array<{ name: string; config: McpServerConfig }> {
    return Array.from(this.servers.entries()).map(([name, config]) => ({
      name,
      config,
    }))
  }
}
