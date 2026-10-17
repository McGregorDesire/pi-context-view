## `TODO`

- [ ] **Detect Nested Sends That Take the Probe's Identity**:
  - A nested `pi.sendUserMessage()` from another extension's `input` handler
    inherits the probe token and can claim it before the probe's own prompt:
    its text is erased, its run is aborted, and the probe prompt later reaches
    the provider
    ([Known Limitation: Nested Sends](architecture/probe.md#known-limitation-nested-sends)).
    Pi 1.2.0's busy run start does not cover it: `input` handlers run before
    the run starts.
  - `test/probe-runtime.test.ts`: an async `input` handler sends an idle user
    message during the probe and waits until its run settles, with the sender
    loaded before and after this extension.
  - `src/probe/silent-probe.ts`: count idle inputs with the token while
    waiting. After a second one, ownership is ambiguous: erase no later input,
    claim no run, and fail the attempt with a precise reason. This works only
    when this extension's `input` handler runs before the sender's.
  - A user-message run with the token that starts after the claim proves a
    wrong claim: warn that the probe prompt may have been sent, without message
    content. Never abort or rewrite that run.
  - Ask Pi for a per-send identity, such as a run handle from
    `sendUserMessage()` or a correlation value passed to `input` and
    `before_agent_start`. Once it exists, claim the run by it instead of
    `AsyncLocalStorage` and remove the known limitation.
  - Docs: [probe.md](architecture/probe.md#known-limitation-nested-sends) and
    the Probe ownership row in [validation.md](architecture/validation.md).

## `Backlog`

- [ ] **Fix Visualization for > 100% After Model Switch**:
  - e.g. Opus 1M (50%) -> switch -> Sol 200k (120%).
