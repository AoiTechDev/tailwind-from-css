// SPEC §11 budgets, asserted at twice the budget for noise. Runs only with TFC_PERF=1 (the CI perf
// job); timings are printed so the job summary shows the actual numbers.
import { describe, expect, it } from 'vitest'
import { buildUtilityIndex } from '../../src/tailwind/index-builder.ts'
import { loadEntry } from '../helpers/design-system.ts'

const BUDGET_MS = 1500
const HEAP_BUDGET_BYTES = 250 * 1024 * 1024

describe.runIf(process.env.TFC_PERF === '1')('SPEC §11 budgets', () => {
  it('loads the default design system and builds its index (cold)', async () => {
    const start = performance.now()
    const design = await loadEntry('@import "tailwindcss";')
    const loaded = performance.now()
    const index = buildUtilityIndex(design, { rootFontSize: 16 })
    const built = performance.now()
    const heap = process.memoryUsage().heapUsed
    console.info(
      `load ${Math.round(loaded - start)} ms, index ${Math.round(built - loaded)} ms, ` +
        `heap ${Math.round(heap / 1024 / 1024)} MB, ${index.bySignature.size} signatures`,
    )
    expect(built - start).toBeLessThan(2 * BUDGET_MS)
    expect(heap).toBeLessThan(2 * HEAP_BUDGET_BYTES)
  }, 30_000)
})
