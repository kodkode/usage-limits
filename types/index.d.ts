export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

export type SessionStats = {
  costUsd: number
  /** Milliseconds spent waiting on model requests. */
  apiMs: number
  /** Milliseconds of main-thread turns. */
  activeMs: number
  linesAdded: number
  linesRemoved: number
  /** Tokens per model family, for the model mix. */
  modelTokens: Record<string, number>
  cacheRead: number
  /** Input tokens in total: uncached, cache-written and cache-read. */
  inputTotal: number
}

declare module 'claude-code' {
  interface PluginState {
    'usage-limits': {
      limits: Limit[]
      stats: SessionStats
      now: number
    }
  }
}
