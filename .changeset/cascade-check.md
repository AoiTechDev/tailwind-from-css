---
"tailwind-from-css": patch
---

Check the cascade between contexts that can apply together. Tailwind orders classes by variant, not by your stylesheet, so a later `@media (min-width: 1000px)` rule used to lose to an earlier `md:` one, and a `:focus` rule written after `:hover` lost to `[&:hover]:`. Where the source and Tailwind disagree, a class for the intersection is added (`min-[1000px]:md:p-6`, `[&:hover]:focus:bg-…`) with `TFC401`. A declaration that a later or stronger rule always overrides, such as an `@starting-style` or `@container` rule placed before the base rule, is dropped with `TFC106`. When a conflict can't be fixed (more than four conflicting contexts for one property, or no class for the intersection), the declaration Tailwind would wrongly let win is left unconverted with `TFC402`. The published JavaScript is now minified, so the package is about 145 kB unpacked instead of 244 kB.
