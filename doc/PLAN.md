## `TODO`

Pi 1.2.0 support. Require Pi 1.2.0 and describe only its behavior: remove
outdated text instead of describing both versions. Run `pnpm check` after
each step.

- [x] **Pi 1.2: restore `pnpm check`**:
  - [x] Add `messageType: "user"` to the `before_agent_start` test events in
    `test/capture-payload.test.ts` (lines 71, 98, 106) and
    `test/index-context.test.ts` (line 136).

- [x] **Pi 1.2: require Pi 1.2.0**:
  - [x] `src/pi-version.ts`: set `MIN_PI_VERSION` to `"1.2.0"`.
  - [x] `test/pi-version.test.ts`: move `1.1.x` to the refused versions;
    use `1.2.x` in the accepted examples (`v1.2.0`, `1.2.0-beta.1`, `1.2.1`).
  - [x] `test/command.test.ts`: build the expected `reportUnsupportedPi`
    message from `MIN_PI_VERSION` instead of a literal version.
  - [x] `doc/architecture/pi-requests.md`, "Supported Pi Versions": require
    `1.2.0` and add `before_agent_start.messageType` to the features it relies
    on; change the header to "Checked against Pi `1.2.0`".

- [x] **Pi 1.2: SilentProbe claims only user-message runs**:
  - Bug: `before_agent_start` now also fires for idle
    `pi.sendMessage(..., { triggerTurn: true })` runs. A nested `sendMessage()`
    from another extension's async `input` handler inherits the probe token, so
    its custom run is claimed and aborted, and the original empty prompt then
    reaches the provider.
  - [x] `src/probe/silent-probe.ts`: pass `event.messageType` to `beginRun()`
    and claim only `"user"` runs. A custom run, with or without the token, is
    foreign: fail the waiting attempt and never abort the run.
  - [x] Update the `beginRun()` calls in `test/silent-probe.test.ts` and
    `test/probe-trigger.test.ts`. Add a unit case: a custom run with the token
    is not claimed and fails the attempt; a later user run with the token is
    still claimed.
  - [x] `test/probe-runtime.test.ts`: an earlier extension's async `input`
    handler sends `pi.sendMessage(..., { triggerTurn: true })` during the probe
    and waits until that run settles. The custom run gets its provider
    response, the attempt fails, and the probe prompt is claimed, aborted, and
    never sent to the provider.

- [x] **Pi 1.2: SilentProbe records only its own prompt**:
  - Bug: Pi now counts the session as busy while a run starts. A
    `pi.sendUserMessage(text, { deliverAs: "steer" })` sent from another
    extension's `before_agent_start` during the probe is delivered into the
    probe run, recorded as a probe identity, blanked, and omitted.
  - [x] `src/probe/silent-probe.ts`: record only the first user message of the
    owned run; Pi emits the starting messages before queued ones. Keep
    recording every assistant message: the probe aborts each turn of its run
    at `turn_start`, including the extra turns Pi runs for queued messages.
  - [x] `src/probe/silent-probe.ts`: `isProbeInput()` also requires
    `streamingBehavior === undefined`. A steer from an earlier extension's
    `before_agent_start` inherits the token while the probe still waits, and
    the `input` handler emptied its text.
  - [x] `src/probe/filter.ts`: the queued message usually has the same
    millisecond timestamp as the probe prompt. `matches()` accepts a user
    identity only for a blank message (no parts, or one empty text part from
    older versions), for omission and request filtering; `message_end` blanks
    only the run's first user message.
  - [x] `test/silent-probe.test.ts`, `test/probe-filter.test.ts`: a second user
    message in the probe run, with the prompt's timestamp, is not recorded,
    blanked, omitted, or filtered.
  - [x] `test/probe-runtime.test.ts`, with the sender in both orders: an
    extension steers a user message and sends a plain custom message from
    `before_agent_start` during the probe. Both stay visible in the session
    and in the next real request, the probe makes no provider request, and the
    abort of the extra turn is blanked.

- [x] **Pi 1.2: hidden tools on every run**:
  - [x] `src/capture/register.ts`: shorten the `hiddenTools` comment. Every
    run now reports them; only a later handler or a mid-run tool change can
    make the copy stale.
  - [x] Runtime test (`test/hidden-tools-runtime.test.ts`): change the active
    tools, then start an idle `pi.sendMessage(..., { triggerTurn: true })` run.
    Its `real-turn` snapshot has the new hidden set; with
    `test/fixtures/forced-prompt.ts` loaded, the forced prompt is captured.

- [x] **Pi 1.2: update architecture docs**:
  - [x] `doc/architecture/pi-requests.md`: update the flow node and the table
    row for `before_agent_start` (a user prompt or an idle custom message; the
    probe claims only user runs) and replace "runs for a new prompt". Describe
    the run-start busy window: `waitForIdle()` waits through the compaction
    check and `before_agent_start`, and messages sent meanwhile are queued into
    the starting run.
  - [x] `doc/architecture/probe.md`:
    - Replace the reason for `sendUserMessage("")`: custom-message runs skip
      `input` and handlers limited to `messageType === "user"`, so they are a
      worse approximation of a user prompt.
    - Lifecycle chart and "Identifying the Probe Run": claim only a
      user-message run that carries the token. The `input` handler resets only
      idle input: queued input that inherits the token is never the probe's.
    - "Keeping Probe Messages Out of Real Context": a user identity matches
      only a blank message, because a message queued while the probe run
      starts usually shares the prompt's timestamp; only the run's first user
      message is blanked; omission checks the stored entry message. Trade-off:
      if a later `message_end` handler adds content to the blank prompt, or a
      `context_edit` replacement does, requests no longer filter it.
    - "Known Limitation: Nested Sends": only a nested `sendUserMessage()`
      remains. Simplify the steps: Pi rejects the original send while the
      nested run is active, so it reaches `before_agent_start` only after that
      run settled.
    - "What a Probe Snapshot Represents": contributions limited to
      custom-message runs are missing.
    - "Side Effects": in the TUI, `ctx.abort()` goes through Pi's interactive
      abort handler, which clears the queues at the probe's first
      `turn_start`. User messages queued while the probe run starts go back to
      the editor, and queued custom messages are dropped. Messages queued
      later, or on hosts without that handler, are delivered into the probe
      run, stay visible, and get no reply. Pi delivers one queued message per
      turn, the first with the probe prompt, so each further one adds one more
      aborted turn.
  - [x] `doc/architecture/capture.md`, "Hidden Tools": remove the case of a
    run without `before_agent_start`.
  - [x] `doc/ARCHITECTURE.md`, "Required Invariants": only a user-message run
    carrying the probe token is aborted or rewritten, and only its own prompt
    and aborts are blanked.
  - [x] `doc/architecture/validation.md`: add the new probe and hidden-tool
    cases to the validation matrix; add `before_agent_start.messageType` and
    the run-start busy window to "After a Pi Upgrade".

- [ ] **Pi 1.2: cleanup**:
  - [ ] Rename the outdated `Pi 1.0 probe aborts, blanks and omits its
    entries` test in `test/probe-runtime.test.ts`.
  - [ ] Search `src/`, `doc/`, and `test/` for remaining outdated wording about
    `before_agent_start`, `sendMessage`, and Pi `1.1`, and fix it.

- [ ] **Pi 1.2: changelog and verification**:
  - [ ] `CHANGELOG.md`, `Unreleased`: `[package]` Require Pi 1.2; `[probe]`
    fixes for blanking messages sent while the probe run starts and for
    claiming another extension's custom-message run.
  - [ ] `pnpm check`, including the lifecycle smoke tests: `marker.ts`,
    `forced-prompt.ts`, and `input-transform.ts` in both orders with the
    `after_provider_response` sentinel.
  - Real-PTY UI checks and new `scripts/demo-injections.md` results only when
    explicitly requested.

## `Backlog`

- [ ] **Fix Visualization for > 100% After Model Switch**:
  - e.g. Opus 1M (50%) -> switch -> Sol 200k (120%).
