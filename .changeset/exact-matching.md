---
"tailwind-from-css": patch
---

Add exact matching: the declarations of one block become the classes whose generated CSS is exactly the same. It finds whole utilities (`truncate`, `size-4`), covers the rest with physical utilities (`margin: 0 auto` → `mt-0 mr-auto mb-0 ml-auto`, never the logical `mx-auto`), compiles bare values the class list doesn't enumerate (`p-3.25`, `w-1/3`, `z-37`, `opacity-37`), uses modifiers (`text-sm/6`, `bg-black/50`), and falls back to variables (`text-(length:--size)`), arbitrary values (`text-[#ef4444]`) and arbitrary properties, all checked by compiling them with your Tailwind. Important declarations get `!`, redundant vendor-prefixed copies are dropped (`TFC105`), and values that can't be written as a class are reported (`TFC204`). Also fixes two normalization edge cases on malformed input (`/ *` in a custom property, an unclosed function in a shadow). Not part of the public API yet: the converter that uses it comes in a later release.
