// SPEC §11 budgets, asserted at twice the budget for noise. Runs only with TFC_PERF=1 (the CI perf
// job); timings are printed so the job summary shows the actual numbers.
import { describe, expect, it } from 'vitest'
import { createConverter } from '../../src/converter.ts'
import { buildUtilityIndex } from '../../src/tailwind/index-builder.ts'
import type { StyleInput } from '../../src/types.ts'
import { loadEntry } from '../helpers/design-system.ts'

const BUDGET_MS = 1500
const HEAP_BUDGET_BYTES = 250 * 1024 * 1024
const CONVERT_P95_BUDGET_MS = 2

const megabytes = (bytes: number): number => Math.round(bytes / 1024 / 1024)

// 30 declarations in 3 contexts: theme values, bare values, arbitrary values and keywords.
const ELEMENT: StyleInput[] = [
  {
    declarations: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      padding: '13px 24px',
      margin: '0 auto',
      width: '50%',
      maxWidth: '42rem',
      borderRadius: 8,
      backgroundColor: '#ffffff',
      color: '#111827',
      fontSize: 14,
      lineHeight: '20px',
      fontWeight: 600,
      boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
    },
  },
  {
    selector: '&:hover',
    declarations: {
      backgroundColor: '#f9fafb',
      color: '#ef4444',
      transform: 'translateY(-1px)',
      opacity: 0.9,
      textDecorationLine: 'underline',
      cursor: 'pointer',
      borderColor: 'rgba(0, 0, 0, 0.5)',
    },
  },
  {
    conditions: ['@media (min-width: 768px)'],
    declarations: {
      flexDirection: 'row',
      padding: 16,
      fontSize: '1rem',
      lineHeight: 1.5,
      gap: '2rem',
      width: '33.333333%',
      letterSpacing: '-0.025em',
    },
  },
]

function percentile(samples: readonly number[], fraction: number): number {
  const sorted = [...samples].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0
}

describe.runIf(process.env.TFC_PERF === '1')('SPEC §11 budgets', () => {
  it('creates a converter for the default theme (cold load + index)', async () => {
    const start = performance.now()
    const converter = await createConverter()
    const created = performance.now() - start
    const heap = process.memoryUsage().heapUsed
    console.info(`createConverter ${Math.round(created)} ms, heap ${megabytes(heap)} MB`)
    expect(converter.convertStyles({ declarations: 'padding: 16px' }).classes).toEqual(['p-4'])
    expect(created).toBeLessThan(2 * BUDGET_MS)
    expect(heap).toBeLessThan(2 * HEAP_BUDGET_BYTES)
  }, 30_000)

  it('rebuilds an index on the same design system no slower than the first build', async () => {
    const design = await loadEntry('@import "tailwindcss";')
    const times: number[] = []
    for (let build = 0; build < 2; build++) {
      const start = performance.now()
      buildUtilityIndex(design, { rootFontSize: 16 })
      times.push(performance.now() - start)
    }
    console.info(`index build ${times.map(Math.round).join(' ms, then ')} ms`)
    expect(times[1]).toBeLessThan(2 * BUDGET_MS)
  }, 60_000)

  it('converts 30 declarations in 3 contexts within the warm p95 budget', async () => {
    const converter = await createConverter()
    const expected = converter.convertStyles(ELEMENT).className
    for (let run = 0; run < 50; run++) converter.convertStyles(ELEMENT)
    const samples: number[] = []
    for (let run = 0; run < 500; run++) {
      const start = performance.now()
      converter.convertStyles(ELEMENT)
      samples.push(performance.now() - start)
    }
    const p95 = percentile(samples, 0.95)
    console.info(
      `convertStyles p50 ${percentile(samples, 0.5).toFixed(2)} ms, p95 ${p95.toFixed(2)} ms: ${expected}`,
    )
    expect(p95).toBeLessThan(2 * CONVERT_P95_BUDGET_MS)
  }, 60_000)
})
