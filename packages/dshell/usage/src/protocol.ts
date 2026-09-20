/**
 * The usage index's wire and storage shapes.
 *
 * One request type and one response type, because the page both reads the
 * aggregate and asks for a scan through the same endpoint — the scan belongs to
 * the host, which is where the session events already are.
 */

/** What the browser can ask of the usage endpoint. */
export interface UsageRequest {
  /** `scan` extends the index first, then answers with the same summary. */
  readonly action: 'summary' | 'scan'
  /** Window length in days, or null for everything on record. */
  readonly days: number | null
}

/**
 * The four buckets a provider reports, kept apart rather than summed.
 *
 * They are not interchangeable: a cache read is what makes a long session
 * affordable and a cache write is what made it expensive, so a single "total"
 * hides the only number a reader can act on.
 */
export interface UsageBuckets {
  readonly uncachedInputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  /** Model turns that reported these buckets — one per assistant step. */
  readonly turns: number
}

/** One day's usage for one route, as the curve reads it. */
export interface UsageDayRow extends UsageBuckets {
  /** `YYYY-MM-DD` in the host's own local time. */
  readonly day: string
  readonly provider: string
  readonly model: string
}

/** One route's total across the requested window, as the pie and table read it. */
export interface UsageTotalRow extends UsageBuckets {
  readonly provider: string
  readonly model: string
}

/** What the page renders, in one response. */
export interface UsageSummary {
  /** Whether a scan has ever completed. False renders the empty state. */
  readonly built: boolean
  /** The window the rows cover, or null for everything on record. */
  readonly days: number | null
  /** The local day the index was last extended, for the page's freshness line. */
  readonly scannedAt: string | null
  /** Distinct local days present, oldest first, so the curve has its x-axis. */
  readonly daysList: readonly string[]
  /** Routes present in the window, so the pie and the table agree. */
  readonly models: readonly string[]
  readonly byDay: readonly UsageDayRow[]
  readonly totals: readonly UsageTotalRow[]
}

/** A summary response, or a refusal the page renders verbatim. */
export type UsageResponse = UsageSummary | { readonly error: string }

/** The composite key a bucket is stored under. */
export interface UsageKey {
  readonly day: string
  readonly provider: string
  readonly model: string
}
