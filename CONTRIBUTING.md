# Contributing

Thanks for helping out. Bug reports with a minimal CSS input and the output you expected are the most useful contribution: every one of them becomes a test case.

## Setup

- Node **≥ 22.18** for development (the build tool and `pnpm gen` need it; the published package runs on Node ≥ 22.12). The repo pins Node 24 in `.nvmrc`.
- pnpm 10, pinned through `packageManager`. With Corepack: `corepack enable`.

```bash
pnpm install
```

## Commands

| Command | What it does |
|---|---|
| `pnpm check` | Biome (lint + format), `tsc --noEmit`, knip |
| `pnpm test` | unit, contract, golden, property (500 runs) and type tests |
| `pnpm test:coverage` | the same with coverage thresholds |
| `pnpm test:golden --update` | rewrites golden expectations. Review the diff like code |
| `pnpm build` | builds `dist/` with tsdown |
| `pnpm check:package` | publint, are-the-types-wrong and the packed-tarball tests (run `pnpm build` first) |
| `pnpm gen` | regenerates `src/data/css-properties.generated.ts` from `mdn-data` |

Before opening a pull request, run `pnpm check && pnpm test && pnpm build`.

## How the code is organized

- `src/tailwind/adapter.ts` is the only module that imports `tailwindcss`. Tailwind's design-system API is internal, so every use of it stays in one file.
- `src/tailwind/loader.ts` and `src/cli.ts` are the only modules that import Node built-ins. Everything else is I/O-free.
- `src/css/**` never imports from `src/match/**` or `src/tailwind/**`.

Biome and `test/contract/import-boundary.test.ts` enforce these boundaries.

## Rules

- **No hand-written CSS-to-class tables.** Class names come from the loaded Tailwind design system, never from a table in `src/`. Tests and fixtures may contain class names.
- **Every output class is verified** by compiling it with Tailwind and comparing the result with the input. No option or code path skips verification.
- **Normalizations are lossless.** Anything that changes how a page looks is a named, opt-in relaxation.
- **Problems in the user's CSS never throw.** They become diagnostics or unconverted declarations. Only `TfcError` with a `TFC9xx` code is thrown.
- **Output is deterministic.** No dates, randomness, or locale-dependent formatting in output paths; sort explicitly.
- **Diagnostic codes are public API.** Never renumber or reuse one. Tests assert codes, not messages.
- No new runtime dependencies and no install scripts without discussing it in an issue first.

## Tests

| Folder | For |
|---|---|
| `test/unit/` | mirrors `src/` one-to-one |
| `test/contract/` | behavior we rely on from Tailwind, plus repo-wide invariants |
| `test/golden/` | fixture-driven end-to-end cases (CSS in, expected JSON out) |
| `test/property/` | fast-check properties; a failing seed becomes a permanent unit test |
| `test/types/` | type-level tests |
| `test/e2e/` | CLI and packed-tarball tests |
| `test/repo/` | workflow and config invariants |

Tests above the unit layer use the real Tailwind design system, never a mock.

## Comments

TSDoc on every public export. Elsewhere, comment only what the code can't say: why a non-obvious algorithm works, or a workaround for a specific Tailwind version. No comments that restate the code, no commented-out code, no TODOs without an issue link.

## Commits and changesets

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `test:`, `docs:`, `chore:`).

A pull request that changes behavior users can observe adds a changeset with `pnpm changeset`. Docs-only and test-only changes don't need one.

### Versioning

The package is `0.x` during the public beta. From `1.0.0`:

- **Major:** removing or renaming API, options, result fields, diagnostic codes or CLI flags; raising the Node or Tailwind floor; changing what `exact` means.
- **Minor:** new options, relaxations or diagnostic codes; output changes that stay exact under the same Tailwind version and theme (a better class found); a wider peer range.
- **Patch:** bug fixes, including a fix that changes wrong output into correct output.

Diagnostic messages may change in any release. Codes may not.

Releases are published from GitHub Actions with npm trusted publishing. There are no npm tokens in the repository or its secrets.
