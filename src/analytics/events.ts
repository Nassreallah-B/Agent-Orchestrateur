export type AnalyticsEvent = {
  name: string
  timestamp: number
  payload?: Record<string, unknown>
}
