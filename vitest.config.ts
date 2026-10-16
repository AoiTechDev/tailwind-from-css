import { defineConfig, type ViteUserConfig } from 'vitest/config'

const config: ViteUserConfig = defineConfig({
  test: {
    // golden/ and property/ fill up from M2 on; an empty project must not fail the run.
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/cli.ts', 'src/index.ts', 'src/types.ts'],
      thresholds: {
        statements: 90,
        branches: 85,
        'src/css/normalize/**': { lines: 100 },
        'src/match/verify.ts': { lines: 100 },
        'src/match/encode.ts': { lines: 100 },
      },
    },
    projects: [
      { test: { name: 'unit', include: ['test/unit/**/*.test.ts'] } },
      {
        test: {
          name: 'contract',
          include: ['test/contract/**/*.test.ts', 'test/repo/**/*.test.ts'],
        },
      },
      { test: { name: 'golden', include: ['test/golden/**/*.test.ts'] } },
      {
        test: {
          name: 'differential',
          include: ['test/differential/**/*.test.ts'],
          testTimeout: 120_000,
        },
      },
      {
        test: {
          name: 'property',
          include: ['test/property/**/*.property.test.ts'],
          setupFiles: ['test/helpers/fast-check-setup.ts'],
        },
      },
      {
        test: {
          name: 'types',
          include: ['test/types/**/*.test.ts'],
          typecheck: { enabled: true, include: ['test/types/**/*.test-d.ts'] },
        },
      },
      { test: { name: 'e2e', include: ['test/e2e/**/*.test.ts'], testTimeout: 300_000 } },
      { test: { name: 'perf', include: ['test/perf/**/*.test.ts'] } },
    ],
  },
})

export default config
