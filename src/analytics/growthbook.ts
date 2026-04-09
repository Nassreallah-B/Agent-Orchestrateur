import { resolveFeatureFlags } from '../featureFlags'

export function getFeatureValue_CACHED_MAY_BE_STALE(
  name: string,
  fallback: boolean,
  overrides?: Record<string, boolean>,
): boolean {
  const flags = resolveFeatureFlags(overrides)
  const normalized = name.toLowerCase()

  if (normalized.includes('explore') || normalized.includes('stoat')) {
    return flags.explorePlanAgents
  }
  if (normalized.includes('verification') || normalized.includes('evidence')) {
    return flags.verificationAgent
  }
  if (normalized.includes('fork')) {
    return flags.forkSubagent
  }
  return fallback
}
