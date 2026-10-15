---
"tailwind-from-css": patch
---

Two fixes found by the property tests:

- A converter gives the same result whatever it converted before. Verification cascaded classes it had compiled in different calls by sort keys that only compare within one call, so a class cached from an earlier conversion could be ordered wrongly and replaced: `content: ""` on `md:` + `:first-child` next to `content: none` came out as `md:first:[content:'']` after an earlier conversion and `md:first:content-['']` on a fresh converter.
- Selectors keep the combinator after a hex escape's terminating space (`.\31  .b` no longer becomes `.\31 .b`, one compound), and whitespace inside quoted attribute values is kept (`[title="a  b"]`).
