---
"tailwind-from-css": minor
---

The `tailwind-from-css` command converts stylesheets. It reads a file or stdin and prints one `subject { classes }` line per rule, then the CSS that stays in a stylesheet; unconverted declarations and diagnostics go to stderr with their line and column. Flags: `--mode`, `--relax`, `--theme`, `--root-font-size`, `--format text|json` (JSON is the `convertCss` result), `--fail-on-unconverted`, `--print-config`, `--version` and `--help`. Exit codes: 0 ok, 1 Tailwind or the theme failed to load, 2 usage error, 3 unconverted with `--fail-on-unconverted`.
