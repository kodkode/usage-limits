import { atom, read, update } from 'claude-code'
import type { Register, RenderChildren } from 'claude-code'

import type { Limit, SessionStats } from '../types'

const EMPTY: SessionStats = {
  costUsd: 0,
  apiMs: 0,
  activeMs: 0,
  linesAdded: 0,
  linesRemoved: 0,
  modelTokens: {},
  cacheRead: 0,
  inputTotal: 0,
}

const limits = atom({ plugin: 'usage-limits', key: 'limits' } as const, [] as Limit[])
const stats = atom({ plugin: 'usage-limits', key: 'stats' } as const, EMPTY)
const now = atom({ plugin: 'usage-limits', key: 'now' } as const, 0)

// The three windows the band always shows, matched against the reported kinds.
const ROWS: { label: string; match: (kind: string) => boolean }[] = [
  { label: 'Session limit', match: k => k === 'five_hour' },
  { label: 'Weekly · all models', match: k => k === 'seven_day' },
  { label: 'Weekly · Fable', match: k => /fable/i.test(k) },
]

const fmtReset = (ms: number) => {
  if (ms <= 0) return 'Resets now'
  const min = Math.floor(ms / 60_000)
  const d = Math.floor(min / 1440)
  const h = Math.floor((min % 1440) / 60)
  const m = min % 60
  if (d > 0) return `Resets in ${d}d ${h} hr`
  if (h > 0) return `Resets in ${h} hr ${m} min`
  return `Resets in ${m} min`
}

const fmtTime = (ms: number) => {
  const s = Math.round(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s % 60}s`
  return `${s}s`
}

const familyOf = (model: string) => {
  const hit = /fable|opus|sonnet|haiku/i.exec(model)?.[0]
  return hit ? hit[0]!.toUpperCase() + hit.slice(1).toLowerCase() : model
}

const bar = (percent: number, width: number) => {
  const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * width)
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled))
}

// A rounded progress bar for the graphical surfaces: a soft track, a filled part
// that turns amber from 70% and red from 90%.
const svgBar = (percent: number) => {
  const pct = Math.min(100, Math.max(0, percent))
  const fill = pct >= 90 ? '#e5534b' : pct >= 70 ? '#d99a29' : '#5b7cfa'
  const w = pct === 0 ? 0 : Math.max(1.2, pct)
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="6" viewBox="0 0 100 6" preserveAspectRatio="none">' +
    '<rect x="0" y="0" width="100" height="6" rx="1" ry="3" fill="rgba(128,128,140,0.22)"/>' +
    (w > 0 ? `<rect x="0" y="0" width="${w}" height="6" rx="1" ry="3" fill="${fill}"/>` : '') +
    '</svg>'
  )
}

const colorFor = (percent: number) => (percent >= 90 ? 'error' : percent >= 70 ? 'warning' : 'suggestion')

const countPatch = (result: unknown) => {
  const patch = (result as { structuredPatch?: { lines?: string[] }[] } | undefined)?.structuredPatch
  let added = 0
  let removed = 0
  for (const hunk of Array.isArray(patch) ? patch : []) {
    for (const line of hunk.lines ?? []) {
      if (line.startsWith('+')) added += 1
      else if (line.startsWith('-')) removed += 1
    }
  }
  return { added, removed }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await update($, now, () => Date.now())
    const usage = await $.session.usage()
    await update($, limits, () => usage.rateLimits)
    await update($, stats, s => ({ ...s, costUsd: usage.cost?.usd ?? s.costUsd }))
    // Tick every 30 seconds so the reset countdowns stay current.
    $.clock.every(30_000, () => void update($, now, () => Date.now()))

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await update($, limits, () => e.rateLimits)
    if (e.cost) {
      const usd = e.cost.usd
      await update($, stats, s => ({ ...s, costUsd: usd }))
    }

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const startedAt = Date.now()
    const step = yield* next(e)
    const usage = step.usage
    const spent = Date.now() - startedAt
    await update($, stats, s => {
      if (!usage) return { ...s, apiMs: s.apiMs + spent }
      const family = familyOf(usage.model)
      const tokens =
        usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens + usage.output_tokens
      return {
        ...s,
        apiMs: s.apiMs + spent,
        modelTokens: { ...s.modelTokens, [family]: (s.modelTokens[family] ?? 0) + tokens },
        cacheRead: s.cacheRead + usage.cache_read_input_tokens,
        inputTotal:
          s.inputTotal + usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens,
      }
    })

    return step
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      const ms = e.durationMs
      await update($, stats, s => ({ ...s, activeMs: s.activeMs + ms }))
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    try {
      if ((e.tool === 'Edit' || e.tool === 'Write') && 'result' in ran && !ran.isError) {
        const { added, removed } = countPatch(ran.result)
        if (added || removed) {
          await update($, stats, s => ({
            ...s,
            linesAdded: s.linesAdded + added,
            linesRemoved: s.linesRemoved + removed,
          }))
        }
      }
    } catch {
      // Counting lines must never fail the tool call itself.
    }

    return ran
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const list = await read($, limits)
    const s = await read($, stats)
    const t = (await read($, now)) || Date.now()

    const rows = ROWS.map(row => {
      const limit = list.find(l => row.match(l.kind))
      return {
        label: row.label,
        pct: limit?.percentUsed ?? 0,
        hasReading: limit !== undefined,
        reset: limit?.resetsAt ? fmtReset(Date.parse(limit.resetsAt) - t) : '',
      }
    })

    const totalTokens = Object.values(s.modelTokens).reduce((a, b) => a + b, 0)
    const mix = Object.entries(s.modelTokens)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([family, n]) => `${family} ${Math.round((n / totalTokens) * 100)}%`)
      .join(' · ')
    const cacheHit = s.inputTotal > 0 ? `${Math.round((s.cacheRead / s.inputTotal) * 100)}%` : '—'

    if (e.surface === 'terminal') {
      const { Box, Text } = $.ui.resolve(e)
      const cols = e.props.bodyColumns
      const colWidth = Math.max(16, Math.floor((cols - 4) / 3))

      return (
        <Box flexDirection="column">
          <Box flexDirection={cols >= 72 ? 'row' : 'column'} columnGap={2}>
            {rows.map(row => (
              <Box key={row.label} flexDirection="column" width={colWidth}>
                <Box flexDirection="row" justifyContent="space-between">
                  <Text wrap="truncate">{row.label}</Text>
                  <Text bold>{row.hasReading ? `${row.pct}%` : '—'}</Text>
                </Box>
                <Text color={colorFor(row.pct)}>{bar(row.pct, colWidth)}</Text>
                <Text dimColor wrap="truncate">
                  {row.reset || ' '}
                </Text>
              </Box>
            ))}
          </Box>
          <Text wrap="truncate">
            <Text dimColor>This session </Text>
            {`$${s.costUsd.toFixed(2)}`}
            <Text dimColor> · API </Text>
            {fmtTime(s.apiMs)}
            <Text dimColor> · Active </Text>
            {fmtTime(s.activeMs)}
            <Text dimColor> · Lines </Text>
            <Text color="success">+{s.linesAdded}</Text> <Text color="error">−{s.linesRemoved}</Text>
            <Text dimColor> · </Text>
            {mix || '—'}
            <Text dimColor> · Cache hit </Text>
            {cacheHit}
          </Text>
        </Box>
      )
    }

    const { Box, Text, Svg } = $.ui.resolve(e)
    const stat = (label: string, value: RenderChildren) => (
      <Box key={label} flexDirection="row" columnGap="xs" width="33%" flexShrink={1}>
        <Text size="footnote" dimColor>
          {label}
        </Text>
        <Text size="footnote" tabular wrap="truncate">
          {value}
        </Text>
      </Box>
    )

    return (
      <Box flexDirection="column" rowGap="md" paddingX="xs" paddingY="xs">
        <Box flexDirection="row" columnGap="lg">
          {rows.map(row => (
            <Box key={row.label} flexDirection="column" rowGap="xs" flexGrow={1} flexShrink={1} width="30%" minWidth={0}>
              <Box flexDirection="row" justifyContent="space-between" alignItems="center" columnGap="sm">
                <Text size="footnote" weight="medium" wrap="truncate">
                  {row.label}
                </Text>
                <Box flexDirection="row" columnGap="xs" alignItems="center" flexShrink={0}>
                  {row.reset !== '' && (
                    <Text size="caption" dimColor wrap="truncate">
                      {row.reset}
                    </Text>
                  )}
                  <Text size="footnote" weight="semibold" tabular>
                    {row.hasReading ? `${row.pct}%` : '—'}
                  </Text>
                </Box>
              </Box>
              <Svg source={svgBar(row.pct)} alt={`${row.label}: ${row.pct}% used`} height={6} />
            </Box>
          ))}
        </Box>
        <Box flexDirection="column" rowGap="xs">
          <Text size="footnote" weight="medium">
            This session
          </Text>
          <Box flexDirection="row" flexWrap="wrap" rowGap="xs">
            {stat('Cost', `$${s.costUsd.toFixed(2)}`)}
            {stat('API', fmtTime(s.apiMs))}
            {stat('Active', fmtTime(s.activeMs))}
            {stat(
              'Lines',
              <Text size="footnote" tabular>
                <Text size="footnote" color="success">
                  +{s.linesAdded}
                </Text>{' '}
                <Text size="footnote" color="error">
                  −{s.linesRemoved}
                </Text>
              </Text>,
            )}
            {stat('Model', mix || '—')}
            {stat('Cache hit', cacheHit)}
          </Box>
        </Box>
      </Box>
    )
  })
}
