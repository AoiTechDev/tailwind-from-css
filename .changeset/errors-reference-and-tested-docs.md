---
"tailwind-from-css": patch
---

`docs/errors.md` explains every diagnostic and error code (`TFC101`–`TFC502`, `TFC901`–`TFC904`) with an example and what to do; `TfcError.docsUrl` and the CLI link to it. The README and error-reference examples now run in the test suite against the built package, the published type declarations are checked for TSDoc on every export, and the packed tarball is tested converting a stylesheet through the API and the CLI. `pruneStyles` documents that it never throws.
