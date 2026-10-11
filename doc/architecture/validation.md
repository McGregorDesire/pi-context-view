# Validation

Part of the [architecture](../ARCHITECTURE.md). How lifecycle, capture, and
payload behavior is verified, and what to recheck after a Pi upgrade.
Rendering checks belong to [UI.md](../UI.md#responsive-rendering).

## Harness

Runtime tests run the pinned Pi CLI against a local mock provider:

| Path                            | Purpose                                                                                                                                                                                               |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/harness/mock-provider.ts` | `startMockProvider()`: loopback OpenAI Completions, OpenAI Responses, and Anthropic streaming with scripted replies, tool calls, delayed stream events, and HTTP failures; records every request body |
| `test/harness/pi-rpc.ts`        | `startPi()`: Pi in RPC mode with an isolated `PI_CODING_AGENT_DIR`, a scratch working directory, no discovered resources, a `vision` and a text-only model per mock API, and deterministic settings   |
| `test/harness.test.ts`          | Checks the harness and every fixture's effect on the request                                                                                                                                          |
| `test/fixtures/`                | Independent regular-test extensions; the header comment states the expected result in both load orders                                                                                              |
| `scripts/fixtures/`             | Demo-only extensions, independent of `test/fixtures/`; changes here do not change regular-test behavior                                                                                               |
| `scripts/demo-injections.sh`    | Starts Pi with selected groups from `scripts/fixtures/` in either load order; [demo-injections.md](../../scripts/demo-injections.md) records the results per version                                  |

`--no-extensions` also disables Pi's built-in extensions; runtime tests add the
ones they need with `builtin:<name>`. `demo-injections.test.ts` checks launcher
selection, order, and demo fixture paths without starting a provider.
`demo-fixtures.test.ts` loads demo files by path through Pi's resource loader
and checks the combined overview against the mock provider: distinct message
and section edits, exact tool/prompt attribution, payload edits, both load
orders, all three supported APIs, and reversed group order. It also checks
conversation edits without the other groups. No demo fixture is imported by a
regular test.
`module-boundaries.test.ts` rejects imports between demo fixtures and regular
tests, fixtures, or harness modules, including indirect imports. Both fixture
sets are typechecked by `pnpm check`, but they are not required to stay identical.
Probe cases that open a view need TUI
mode: run them in a real PTY as the `pi-extension` skill describes.

## Validation Matrix

| Check                     | Required cases                                                                                                                                                                                                                                                                                                                                                           | Tests                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Core calibration          | With only this extension loaded, both diffs are empty for first and later prompts, tool follow-ups, resume with another model, compaction, and requests after a silent probe.                                                                                                                                                                                            | `capture-runtime`, `payload-runtime`                               |
| Handler ordering          | Load each fixture before and after the monitor. Pi's resource order matches [Handler Order](pi-requests.md#handler-order), with project trust resolved; check that order by hand after a Pi upgrade.                                                                                                                                                                     | `capture-runtime`, `payload-runtime`, `probe-runtime`              |
| Structured edits          | Add, modify, and delete conversation messages; patch system sections; mutate messages in place; change active tools on a later prompt.                                                                                                                                                                                                                                   | `capture-runtime`, `capture-diff`, `hidden-tools-runtime`          |
| Payload changes           | Rewrite the payload before and after the monitor and confirm the stated visibility limits, including the four injection points of [#9](https://github.com/dimk90/pi-context-view/pull/9).                                                                                                                                                                                | `payload-runtime`, `capture-runtime`, `payload-guard`              |
| Forced prompt             | Return `systemPrompt` from `before_agent_start`; the capture applies it in both load orders, in real and probe runs, and the guard in real runs.                                                                                                                                                                                                                         | `capture-runtime`, `forced-prompt`, `payload-runtime`              |
| Built-ins                 | Codemode with an active `codemode` tool in normal and `"codemode": { "mode": "only" }` settings; tool-search; MCP with a minimal direct-tool server. Recorded prompt/description changes stay apart from hidden declarations.                                                                                                                                            | `payload-runtime`, `hidden-tools-runtime`                          |
| Usage tools               | With codemode `only`, Usage counts only `codemode` before and after a request, including probes and incomplete guards. Injections leaves out and counts the snapshot's hidden tools before the first prompt. Active-tool changes apply to Usage at once and to Injections at the next request. Payload removals do not affect Usage. The placeholder never appears.      | `hidden-tools-runtime`, `hidden-tools`                             |
| Routing and normalization | Alternate physical providers, directly and through a virtual model; route image input to a text-only model; cover every [Pi adjustment](payload-guard.md#pis-own-adjustments).                                                                                                                                                                                           | `payload-runtime`, `message-channel`                               |
| Retries                   | Fail once with agent retries enabled, then with `"retry": { "enabled": false, "provider": { "maxRetries": 2 } }`. Each capture pairs once.                                                                                                                                                                                                                               | `payload-runtime`                                                  |
| Cache warming             | Model `"promptCache": { "short": 12 }`, `"cacheWarming": "idle"`, and `test/fixtures/cache-warm.ts`. Successful and failed refreshes publish nothing, and the next real request pairs normally. Probes are skipped while idle warming is enabled.                                                                                                                        | `payload-runtime`, `probe-guards`                                  |
| Dispatch timing           | Delay stream events after HTTP headers; accept whichever identity-bearing event arrives first, and never repeat findings. Include failures before streaming. On a physical selection, the guard settles before the response; `pi.setModel()` during preparation leaves it incomplete.                                                                                    | `dispatch-runtime`, `payload-runtime`                              |
| Incomplete comparison     | Missing model metadata and unsupported or mismatched payloads never appear as empty diffs. A compared channel keeps its findings when the other fails.                                                                                                                                                                                                                   | `payload-guard`, `payload`, `capture-payload`                      |
| Format selection          | Parsers are selected by API on both paths. A payload that does not match its API settles incomplete. An image placeholder needs model evidence.                                                                                                                                                                                                                          | `dispatch-runtime`, `payload`, `message-channel`                   |
| Inline tool changes       | Anthropic with `supportsMidConvoToolChanges`, with API-key and OAuth casing; OpenAI Responses with `supportsAdditionalTools` or `supportsToolSearch`; Completions system-message additions. Activate, remove, and redefine tools after the first request: both diffs stay empty.                                                                                         | `payload-runtime`, `dispatch-runtime`                              |
| Silent probe              | Probe before the first request with the lifecycle fixtures in both orders; the `after_provider_response` sentinel stays silent. On a model with `supportsMidConvoSystemMessages`, system messages keep their positions after probes.                                                                                                                                     | `probe-runtime`, `payload-runtime`                                 |
| Probe payload             | A standard probe produces a structured capture but no payload; its guard settles incomplete at settlement. Virtual selections fall back without probing.                                                                                                                                                                                                                 | `probe-runtime`, `probe-guards`                                    |
| Probe trigger             | One automatic attempt per runtime; concurrent callers share it; every precondition falls back without consuming the attempt.                                                                                                                                                                                                                                             | `probe-trigger`, `probe-guards`                                    |
| Snapshot store            | Keeps only the latest snapshot by ID; same-ID guard updates replace it, older ones only notify; a real request replaces a probe. Capture runs with no consumer and in RPC mode. Consumers import no capture or probe internals.                                                                                                                                          | `snapshot`, `capture-runtime`, `module-boundaries`                 |
| Cleanup and privacy       | Pending data is released on settlement and shutdown; raw content stays out of logs, session entries, and notifications. Persisted probe records contain only role and timestamp.                                                                                                                                                                                         | `capture-builder`, `payload-guard`, `silent-probe`, `probe-filter` |

Test names refer to `test/<name>.test.ts`. `pnpm check` runs all of them.

### Prompt source rows

`system-prompt-rows`, `injections`, and `injections-view` test the diff-only
`system prompt` rows: exact tool lines, guessed additions, unknown edits and
deletions, cumulative rounding, and unchanged group values and diffs. Cases
include forced prompts, dropped blocks, fallback, instruction-file and skill
edits and deletions, request-only line comparison, plain-text previews,
terminal sanitization, theme invalidation, and width/height reflow. These are
pure composition and render tests; real-PTY checks remain explicit opt-in.

### Injections source and aggregate rows

`model`, `system-prompt-rows`, `injections`, `injections-model`, and
`injections-view` test the `pi` / extension / trailing `unattributed` source
contract. Cases include unregistered tools sharing the unknown source,
customType and cooperative provenance creating no source group, non-context
`pi.share` entries, absent empty rows, deletion-only rows, and section-level
changed-line ownership. Message parts preserve session order with additions
following in capture order; payload parts preserve guard order. Counts exclude
message deletions but include every payload finding; estimates and diffs sum
without double-counting a modified message's original. Render checks cover dim
`tool:` prefixes, value alignment, aggregate status, per-part token shares and
markers, sanitization, preview return, narrow widths, and height reflow.
Real-PTY checks remain explicit opt-in.

### Message and payload previews

`message-sections` tests branch-wide `user prompt #N` numbers: messages before
the first prompt, compaction, saved context omissions, abandoned branches,
entries appended after capture, excluded probe prompts, and request-only
additions. It also checks that a modified message keeps only its redacted,
signature-free original. `token-diff` checks that preview word runs rebuild
both texts and match the counted characters, including the bounded fallback.
`diff-preview` and `injections-view` cover context lines, multi-line word
highlighting, whole-line additions and deletions, expanded marked JSON, payload
guard order, sanitization before styling, Unicode, and wrapped inverse words.

### Selected-row status bar

`injections`, `system-prompt-rows`, `injections-model`, `status-bar`, and
`injections-view` test saved, request-only, mixed, and payload-only changes,
known and guessed saved-line editors, unknown request editors, session-original
presence, parent removals, and diff-only accounting. Render cases cover field
colors, sanitized names, selection and preview return, description collapse,
height-only resize, narrow wrapping, empty reserved lines, theme invalidation,
and the compact frame that keeps the selected row and bar on short terminals.
`model` checks that editor metadata owns its sources and arrays.

## Lifecycle Smoke Tests

For lifecycle changes, load `test/fixtures/marker.ts`,
`test/fixtures/forced-prompt.ts`, and `test/fixtures/input-transform.ts` before
and after this extension. Use an `after_provider_response` sentinel to prove
that a probe makes no provider request, and load
`test/fixtures/payload-logger.ts` last to compare the views with the payload
that reached the provider. For TUI changes, also run the real-PTY and
rendering checks of the `pi-extension` skill and [UI.md](../UI.md).

## After a Pi Upgrade

Recheck event shapes, handler order, provider adjustments, the probe's abort
form and where Pi checks its abort signal (authentication resolution), whether
dispatch metadata is now exposed to `before_provider_request`, and whether Pi
now reports which tool hid a declaration. `test/dispatch-runtime.test.ts`
re-runs the [payload guard evidence](payload-guard.md#evidence).
