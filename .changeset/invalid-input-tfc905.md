---
"tailwind-from-css": minor
---

New thrown code `TFC905`: `convertStyles` and `convertCss` given input of the wrong shape (for example the declarations themselves instead of `{ declarations }`) throw `TfcError` with `TFC905` and a message naming the entry and field, instead of a raw `TypeError`.
