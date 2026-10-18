## `TODO`

- [x] **Rename System Prompt Sections in the Injections View**:
  - Match current Pi terminology: Available Tools → Tools,
    Guidelines → Rules, Documentation → Docs, Appended Prompt → Addendum.
  - Keep Instruction Files and Current Dir unchanged.
- [ ] **Drop the `provider_stream_event` Handler**:
  - Pi emits the event only when a handler exists; ours costs an awaited
    emit and a new `ctx` per streamed chunk, but only the first one is used.
  - Confirm dispatch from assistant `message_start`, with `message_end` as the
    fallback; remove `noteWarmRefresh` and the `stream` identity source.
  - Check `test/dispatch-runtime.test.ts` and the virtual path; update
    `payload-guard.md` and `pi-requests.md`.
- [ ] **Defer Forced-Prompt Detection**:
  - `detectForcedPrompt` renders `getCurrentSystemPrompt(baseline)` inside the
    `context_with_system` handler on every request.
  - Keep only the `ctx.getSystemPrompt()` string in the handler; compare it in
    the deferred job. The baseline is append-only session objects, which the
    deferred diff already relies on.
- [ ] **Trim Exactly Equal Units in the Message Channel**:
  - The deferred guard normalizes (two regex passes) and interns a key for
    every unit of the whole conversation on every request.
  - Before building keys, trim units with equal `part`, `name`, and `text`
    (`===`) at both ends; normalize only the middle. The findings stay the
    same: exact equality implies equal keys, and alignment trims ends by key.


## `Backlog`

- [ ] **Copy Only What the Payload Parsers Read** (needs evaluation and a
  capture contract decision):
  - `copyPayload` copies every array and object of the payload on every
    request, including tool schemas, image blocks, and reasoning blocks.
  - Options: on the physical path, parse units and declarations from the live
    payload in the handler; or copy only the fields the parsers read. At
    minimum, replace `fromEntries(entries().map())` with a `for…in` loop.
  - Changes the payload copy and retention rules in `payload-guard.md`.

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

- [ ] **Update demo recordings**:
  - Add reference to `pi-dark-legacy` theme for each image/demo.
  - Add the theme file to the repo.

- [ ] **Fix Visualization for > 100% After Model Switch**:
  - e.g. Opus 1M (50%) -> switch -> Sol 200k (120%).
