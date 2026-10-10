import fc from 'fast-check'

// 500 runs locally; the nightly job raises it with TFC_PROPERTY_RUNS=5000.
fc.configureGlobal({ numRuns: Number(process.env.TFC_PROPERTY_RUNS ?? 500) })
