---
"tailwind-from-css": patch
---

Don't pick an important class that also writes a vendor-prefixed property the block sets without `!important`. `user-select: none !important; -webkit-user-select: none` now converts exactly to `[user-select:none]! [-webkit-user-select:none]`; before, `select-none!` overrode the prefixed declaration, which ended up unconverted with TFC501 and TFC502.
