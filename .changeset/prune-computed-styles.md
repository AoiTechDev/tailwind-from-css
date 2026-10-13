---
"tailwind-from-css": minor
---

Add `pruneStyles`, which reduces a computed style (`getComputedStyle`) to the declarations that need classes. Pass the parent's computed style and a baseline: a blank element of the same tag, rendered under Tailwind's Preflight inside an element that carries the parent's inherited values. A property is dropped when it equals the baseline's value; an inherited property the baseline doesn't list, when it equals the parent's; any other property, when it equals its initial value. Before comparing, values the browser resolved are read back: a color that follows the text color counts as `currentcolor`, an origin at the center of the box as `50% 50%`, and a list of equal transition or background items as one item. Logical properties that repeat their physical twin, `none` border, outline and column-rule styles, shorthands repeated by their own longhands, and custom properties are dropped too. `keep` and `drop` override any of it.

```js
import { convertStyles, pruneStyles } from 'tailwind-from-css'

const declarations = pruneStyles(styles, { parent, baseline })
const hover = pruneStyles(hoverStyles, { baseline: styles })
const { className } = await convertStyles([
  { declarations },
  { selector: '&:hover', declarations: hover },
])
```

On a captured Pico CSS page, elements went from about 600 computed properties to a median of 9 classes, all exact.
