## `TODO`

- [x] **Copy Only Differing Tool Declarations**:
  - `copyRequest` `structuredClone`s the replayed system state and every tool
    declaration on every request: ~0.2–0.4 ms in the handler for 7 tools
    (~10 KB), though they usually equal the baseline.
  - Content and sections need no copy: `getCurrentSystemMessage()` already
    builds new containers, and strings are immutable. Keep them by reference.
  - Compare each distinct request tool with the baseline tool of the same
    name (`getCurrentTools`/`getDeclaredTools`) in place: `compareJson` over
    the fields `toToolDeclaration` keeps, with `declarationsEqual` only on
    `"unknown"` (it is slower than the clone). Reuse the baseline object when
    equal; clone otherwise. Measured ~20 µs instead of ~190 µs.
  - In `diffTools`, add `previous === tool ||` before `declarationsEqual`, so
    the deferred diff also skips its ~270 µs for reused tools.
  - No handler comparison of content or sections, and no deferred replay
    skip: the replay costs ~5 µs and runs off the critical path.
  - Contract: `RequestCopy` declarations equal to the baseline are session
    objects, which are append-only and only read. Update "Request Copy" in
    `capture.md` and, if needed, `payload-guard.md#retention`. A function
    value on an otherwise equal tool then no longer drops the capture.
  - Tests: the in-place comparison agrees with `declarationsEqual` on symbol
    keys, `undefined` fields, and non-declaration fields; a later in-place
    schema edit of an equal tool leaves the capture unchanged.


## `Backlog`

- [ ] **Update demo recordings**:
  - Add reference to `pi-dark-legacy` theme for each image/demo.
  - Add the theme file to the repo.

- [ ] **Fix Visualization for > 100% After Model Switch**:
  - e.g. Opus 1M (50%) -> switch -> Sol 200k (120%).
