---
"tailwind-from-css": minor
---

Nearest mode drops a relaxed class under a width condition when a wider layer or the base already shows the same value there: `text-2xl md:text-2xl xl:text-3xl` becomes `text-2xl xl:text-3xl`, and `md:mt-4.5 xl:mt-4.5` becomes `md:mt-4.5`. What every context shows is unchanged and still verified. The dropped declarations are reported on the class that shows their value, with their relaxations. Exact mode is unaffected.
