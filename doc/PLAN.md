## `TODO`

- [ ] **Skip GPT-6 `configuration_update` Items in the Message Channel**:
  - Since Pi 1.3.0, on `openai-responses` models with
    `compat.supportsMidConvoEffort` (GPT-6), with thinking on and API-key auth,
    every request has these items: one before each same-model reply with
    `providerThinkingLevel`, and one at the end. The parser rejects them, so
    message comparison is always incomplete on these models.
  - `src/capture/payload.ts`: add `configuration_update` to
    `RESPONSES_SKIPPED_ITEMS`; like `reasoning`, it has no message text.
  - `test/payload.test.ts`: a Responses payload with these items before an
    assistant reply and at the end parses to the same units as without them.
  - `test/payload-runtime.test.ts`: on an `openai-responses` model with
    `supportsMidConvoEffort` and thinking on, change the thinking level between
    prompts; the guard is complete and both diffs stay empty.
  - Docs: list the items as non-text in
    [Message Channel](architecture/payload-guard.md#message-channel) and add
    the case to [validation.md](architecture/validation.md).

- [ ] **Leave Out Other Models' Thinking in Usage**:
  - Since Pi 1.3.0, Pi drops thinking from assistant messages of another
    provider, API, or model before it sends a request. The payload guard does
    the same, but Usage still counts this thinking in Assistant Thinking.
  - `src/index.ts`: pass the next request's model identity (provider, API,
    model ID) to `computeUsage()`. Use `ctx.model` for a physical selection.
    For a virtual selection, use the latest assistant reply that is not an
    error or aborted, as Pi's own routed-model lookup does; without such a
    reply, count all thinking as now.
  - `src/usage.ts`: in `thinkingEntries()`, count and preview no thinking of
    another model, and leave its tool calls' `thoughtSignature` out of the
    signature proxy. Like deleted messages, dropped thinking gets no preview
    and no marker. Same-model thinking stays as it is.
  - Share one same-model check with `src/capture/adjustments.ts` from a module
    outside `src/capture/`: Usage must not import capture modules.
  - `test/usage.test.ts`: same model, another provider, API, or model, and a
    virtual selection with and without a latest reply.
  - Docs: [Usage](architecture/views.md#usage) and
    [THINKING.md](THINKING.md#counting-architecture).

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
