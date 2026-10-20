## `TODO`

- [ ] **Compare System State in Place** (needs evaluation and a capture
  contract decision):
  - `copyRequest` `structuredClone`s the replayed system state and every tool
    declaration on every request, though they usually equal the baseline;
    cloning immutable strings is wasted work.
  - Compare content, sections, and declarations (`declarationsEqual`) with
    the baseline in the handler and copy only differing declarations; the
    diff and the guard take equal parts from the baseline. The deferred
    system diff can then skip the baseline replay when nothing differed.
  - Changes "Request Copy" in `capture.md` and the guard's rebuild inputs.


## `Backlog`

- [ ] **Update demo recordings**:
  - Add reference to `pi-dark-legacy` theme for each image/demo.
  - Add the theme file to the repo.

- [ ] **Fix Visualization for > 100% After Model Switch**:
  - e.g. Opus 1M (50%) -> switch -> Sol 200k (120%).
