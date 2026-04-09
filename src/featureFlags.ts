export type FeatureFlagMap = {
  forkSubagent: boolean
  explorePlanAgents: boolean
  verificationAgent: boolean
  coordinatorMode: boolean
  analytics: boolean
  mcp: boolean
  persistence: boolean
  remoteControl: boolean
}

export const DEFAULT_FEATURE_FLAGS: FeatureFlagMap = {
  forkSubagent: false,
  explorePlanAgents: true,
  verificationAgent: true,
  coordinatorMode: true,
  analytics: true,
  mcp: true,
  persistence: true,
  remoteControl: false,
}

export function resolveFeatureFlags(
  input?: Partial<FeatureFlagMap>,
): FeatureFlagMap {
  return { ...DEFAULT_FEATURE_FLAGS, ...(input ?? {}) }
}

export function isFeatureEnabled(
  flags: Partial<FeatureFlagMap> | undefined,
  key: keyof FeatureFlagMap,
): boolean {
  return (flags?.[key] ?? DEFAULT_FEATURE_FLAGS[key]) === true
}
