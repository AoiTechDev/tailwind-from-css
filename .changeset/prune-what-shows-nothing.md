---
"tailwind-from-css": minor
---

`pruneStyles` takes the element's other captured `states`. Given them, it drops longhands that show nothing (a line's color where the line isn't drawn, insets of a static box, background size, position and repeat with no background image, transition details where no transition runs) unless a state shows them with the same value (#31–#34). The capture guide passes them, and its baseline copies `width`, `height`, `hidden`, `dir` and SVG presentation attributes onto the blank element (#35).
