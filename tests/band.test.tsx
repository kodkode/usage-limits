import { expect, test } from 'claude-code/testing'

const BAND = {
  plugin: 'usage-limits',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 10 },
  },
} as const

test('the band shows the limits and session stats', async ($, on) => {
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 200000 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 1, resetsAt: new Date(Date.now() + 4 * 3_600_000 + 36 * 60_000 + 30_000).toISOString() },
        { kind: 'seven_day', percentUsed: 7 },
      ],
      cost: { usd: 1.12 },
    },
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface } as never)
    expect(await ui.find({ type: 'Text', text: /Resets in 4 hr 36 min/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\$1\.12/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Weekly · Fable/ })).toBeDefined()
    await ui.unmount()
  }
})
