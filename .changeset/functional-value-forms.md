---
"tailwind-from-css": minor
---

Shorter classes for values with `var()`, and type hints only where they describe the value. The output stays exact; only the spelling of some classes changes.

- A shorthand kept whole gets its utility instead of an arbitrary property: `padding: var(--p)` → `p-(--p)` (was `[padding:var(--p)]`), `margin: var(--y) 0` → `m-[var(--y)_0]`, `border-radius: var(--r)` → `rounded-(--r)`, `border-color: var(--c)` → `border-(--c)`, `padding-block: var(--y)` → `py-(--y)`.
- Utilities that no listed class shows are used too: `background-size` → `bg-size-[auto_1rem]`, `background-position` → `bg-position-[center_left]`, `filter` → `filter-[brightness(0)]`, `backdrop-filter` → `backdrop-filter-(--x)`.
- A negated variable uses the negative utility: `margin-left: calc(var(--x) * -1)` → `-ml-(--x)`.
- A variable with a fallback keeps the variable form: `box-shadow: var(--s, none)` → `shadow-(--s,none)`.
- A variable line height is a variable modifier: `text-base/(--lh)` (was `text-base/[var(--lh)]`).
- An arbitrary or variable size takes the line height as a modifier: `font-size: 18.2px; line-height: 28px` → `text-[18.2px]/7` (was `text-[18.2px] leading-7`).
- A type hint is written only for a value with `var()`, whose type Tailwind can't see. `font-weight: bolder` is now `[font-weight:bolder]` instead of the misleading `font-[color:bolder]`, and `font-size: inherit` is `[font-size:inherit]` instead of `text-[length:inherit]`.
