# Injection demos

Demo instructions and expected results for the fixtures loaded by
[`demo-injections.sh`](demo-injections.sh). Expected results follow each
fixture's header comment and the [capture visibility rules](../doc/architecture/capture.md#scope).

The launcher loads demo-only extensions from [`scripts/fixtures/`](fixtures/).
Regular tests use independent fixtures in `test/fixtures/`; neither set imports
or re-exports the other. Change the demo fixtures without changing regular test
behavior. The launcher tests check selection and paths. `demo-fixtures.test.ts` loads
the demo files through Pi's resource loader and checks their combined behavior
with the mock provider in both load orders and all three supported payload APIs.
`pnpm check` also typechecks both sets and checks their import boundaries.

Load orders:

- **Before:** selected fixtures load before pi-context-view (default).
- **After:** pi-context-view loads first (add `--after`).

## Explicit fixture selection

The launcher loads only pi-context-view by default. Place demo flags before
Pi arguments; groups load in flag order, with each group's fixtures in the
order below.

Discovered extensions stay disabled unless you add `--local`, which omits
Pi's `--no-extensions` argument. The working copy and selected fixtures still
load explicitly, so an installed pi-context-view may load alongside them.

| Flag              | Fixtures                                                               |
| ----------------- | ---------------------------------------------------------------------- |
| `--context`       | `context-modify`, `context-delete`, `context-add`                        |
| `--system`        | `review-checklist`, `section-patch`, `section-modify`, `section-delete`  |
| `--payload`       | `payload-changes`, `payload-remove-tool`                                |
| `--message`       | `agent-start-message`                                                  |
| `--forced`        | `forced-prompt` (forced system prompt)                                  |
| `--codemode-only` | none; Pi's built-in codemode in `only` mode                             |

Flags combine without enabling unselected groups:

```sh
./scripts/demo-injections.sh --codemode-only --forced --no-session
```

For isolated demo checks, load a file from `scripts/fixtures/` directly with
Pi's `-e` option, for example `pi -e ./scripts/fixtures/section-patch.ts`.
The overlapping edits, in-place mutations, reordering, extra message additions,
and marker-triggered payload deletion remain available this way, but no longer
load with the overview groups.
`--forced` replaces the system prompt; conversation and payload demos still run.

## Viewing the demos

Opening `/context injections` before the first prompt attempts a silent probe.
This requires a configured model, credentials, and the usual probe safety checks.
Probes have no provider payload, so payload changes require an ordinary prompt.
Reopen the view afterwards: the latest real request replaces the probe snapshot.

## Combined overview

```sh
./scripts/demo-injections.sh --context --system --payload --message --no-session
```

Send an ordinary prompt, for example:

```text
Suggest improvements to a code review workflow. Do not call tools.
```

Then open `/context injections`. No marker prompts are needed. The overview
uses realistic review instructions and gives one example of each structured
addition, modification, and deletion, plus two payload findings.

Suggested preview order:

1. The three custom System Prompt sections: an added checklist, an expanded
   review instruction, and a deleted migration note at zero tokens. Pi's
   Current Dir and Documentation stay unchanged.
2. `review-checklist.ts`: its `tool:review_checklist` definition and
   `system prompt` row. The latter previews its exactly attributed lines in
   Available Tools and Guidelines, already counted in System Prompt.
3. `unattributed` → `messages (4)`: the saved review note, the edited user
   prompt, the deleted obsolete note, and two request-only additions. Deleted
   parts do not count toward `(4)`.
4. `unattributed` → `payload changes (2)`: a changed review instruction and
   the removed `write` declaration. Payload changes are separate from the
   captured request, not marked `Request-Only`.

These counts assume a fresh session, no initial probe, normal tool selection
including `write`, and one real request. A probe and additional runs save more
`agent-start-message` copies. A tool follow-up replaces the latest snapshot,
so the sample asks the model not to call tools.

## Automatic section and attribution demo

```sh
./scripts/demo-injections.sh --system --no-session
```

| Fixture           | Changes |
| ----------------- | ------- |
| `section-patch`    | Adds only `context-view-fixture-checklist`: read affected files and run focused tests. |
| `section-modify`   | Expands only `context-view-fixture-review` from correctness to correctness, error handling, and test coverage. |
| `section-delete`   | Deletes only `context-view-fixture-obsolete`: a legacy configuration migration note. |
| `review-checklist` | Registers `review_checklist`, a harmless tool returning a fixed review checklist, with a prompt snippet and guideline. |

The modification and deletion fixtures seed their originals through
`before_agent_start`, making them part of the session baseline.
`context_with_system` changes only the outgoing request, so every changed
section is marked `Request-Only`. Modified sections preview the request text;
deleted sections keep the original at zero tokens.

The tool definition belongs to `review-checklist.ts`. Its exactly matched
prompt lines also appear in that extension's diff-only `system prompt` row,
without `(guess)` or `Request-Only`: Pi saves them in the session. The row
repeats changes counted under `pi`, without counting them twice. Enter on
Available Tools or Guidelines also shows the attributed lines; selecting
these saved parts names the known extension in `Changed By`.

Custom section tags and message types do not identify an editing extension,
so those changes remain under `unattributed`. This is a deliberate contrast,
not a claim that all edits can be attributed.

With `--after`, the three section edits appear only as payload changes after a
real prompt. The tool definition and its saved prompt lines remain attributed
in both load orders.

## Automatic conversation demo

```sh
./scripts/demo-injections.sh --context --message --no-session
```

| Fixture               | Preview |
| --------------------- | ------- |
| `context-add`         | Added: “Focus the review on error handling and test coverage.” |
| `context-modify`      | Modified user prompt: adds “Give recommendations only; do not edit files.” |
| `context-delete`      | Deleted: “Limit the review to formatting; skip error handling and test coverage.” |
| `agent-start-message` | Unchanged saved note: “Review findings should include the affected file and a suggested improvement.” |

`context-delete` saves its obsolete custom note once per session, then omits
it from each request. It never removes genuine user prompts. The saved note
stays available as a zero-token removed preview.

`context-add` goes before the prompt, and the payload demo's synthetic note
goes after it, so neither is mistaken for the prompt's replacement or the
obsolete note. `context-modify` targets the latest saved user prompt rather
than a synthetic user message, regardless of group order.

All custom messages and request-only edits share the `messages (N)` row under
`unattributed`; custom types label preview parts, not source groups. The three
`context` changes carry `Request-Only` in both load orders. Pi saves one
`agent-start-message` per run, including a probe, without a diff or
`Request-Only`. This shows saved content alongside request-only content.

## Automatic payload-change demo

```sh
./scripts/demo-injections.sh --payload --no-session
```

Send an ordinary prompt, then open `/context injections`. The group produces
one message modification and one tool declaration removal in
`payload changes (2)` under `unattributed`, when `write` is declared.
Enter shows one labeled part per finding:

| Change   | Preview |
| -------- | ------- |
| Modified | “Keep the review brief.” → “Keep the review brief. Include a short explanation for each finding.” |
| Deleted  | `tool:write`, at zero tokens, with its removed declaration text. |

`payload-changes` adds its original note in `context`, without saving it. That
note is a request-only addition in `messages (N)`; `before_provider_request`
then edits it only in the provider payload. It supports OpenAI Completions,
OpenAI Responses, and Anthropic Messages. No synthetic separator, extra payload
addition, or marker-triggered deletion loads with this group.

The manual `write` removal is not a Pi-hidden tool. Its ordinary tool row and
Usage count stay unchanged, and payload findings do not carry `Request-Only`.
The payload row's `(N)` includes deletions, unlike the messages row's `(N)`.

With `--after`, payload edits run after the monitor's payload hook and are not
visible. If `--system` is also selected, its later `context_with_system` edits
still appear as payload changes.

## Optional codemode hidden-tools demo

```sh
./scripts/demo-injections.sh --codemode-only --no-session
```

The launcher loads codemode with `-e builtin:codemode`. Pi loads explicit
`builtin:` entries after other `-e` paths, so `--after` moves only
pi-context-view and the fixtures. The `codemode` tool appears under Built-in
Tools with the `builtin` source.

The launcher sets `PI_CODING_AGENT_DIR` to a temporary directory. It links the
real agent directory's entries except `settings.json`, which is copied with
`codemode.mode` set to `"only"` and `+codemode` added to `defaultTools`.
Your original settings stay unchanged; settings changed during the run are
lost when the temporary directory is removed on exit.

The silent probe records Pi's hidden tools in both load orders. Injections
omits their rows and lists their count and names in one description bullet;
they remain callable through codemode scripts. With the default tool selection,
`read`, `bash`, `edit`, and `write` are hidden; Usage counts only `codemode`.
Tool-selection arguments can change that set.

`--payload` without codemode reports its manual `write` removal as a deleted
`tool:write` part (`0 -N`) in the `payload changes (N)` preview, not a hidden
tool. The finding counts toward `N` even though its estimate is zero. Its normal
tool row and Usage count remain unchanged.

## Comparison with v0.6.0

Recorded results: v0.6.0 was checked with Pi 1.0.0; **Unreleased** was checked
with Pi 1.0.2 at `053aa57`, not the current code. The fixtures have since been
simplified; this historical table is not an expected-result matrix for the
current overview. The checks loaded all fixtures listed below together, not
the current launcher's groups. Their edits can
interact, especially message modification, reordering, and addition.

Prompts, in order: `XYZZY_CONTEXT_REORDER one`, `XYZZY_CONTEXT_DELETE two`,
`XYZZY_PAYLOAD_DELETE three`, then `four`.

**Target** describes the expected result. Marks: ✅ matches the target;
⚠️ differs from it; ❌ not shown; ➖ not visible by design.

### Injections view

| Demo extension        | Event                     | Target: before                       | Target: after        | v0.6.0: before | v0.6.0: after | Unreleased: before | Unreleased: after |
| --------------------- | ------------------------- | ------------------------------------ | -------------------- | -------------- | ------------- | ------------------ | ----------------- |
| `context-add`         | `context`                 | addition, `context-view-fixture-add` | same as before       | ✅             | ❌            | ✅                 | ✅                |
| `context-add-user`    | `context`                 | addition, unattributed               | same as before       | ✅             | ❌            | ⚠️³              | ⚠️³             |
| `context-modify`      | `context`                 | modification, unattributed           | same as before       | ⚠️¹          | ❌            | ⚠️¹              | ⚠️¹             |
| `context-in-place`    | `context`                 | modification, unattributed           | same as before       | ⚠️¹          | ❌            | ⚠️¹              | ⚠️¹             |
| `context-delete`      | `context`                 | deletion, unattributed               | same as before       | ❌             | ❌            | ✅                 | ✅                |
| `context-reorder`     | `context`                 | deletion plus addition               | same as before       | ❌             | ❌            | ✅                 | ✅                |
| `system-append`       | `context_with_system`     | system change, unattributed          | edited after monitor | ❌             | ❌            | ✅                 | ❌                |
| `section-patch`       | `context_with_system`     | system change, unattributed          | edited after monitor | ❌             | ❌            | ✅                 | ❌                |
| `section-modify`      | `context_with_system`     | system change, unattributed          | edited after monitor | ❌             | ❌            | ✅                 | ❌                |
| `section-delete`      | `context_with_system`     | system change, unattributed          | edited after monitor | ❌             | ❌            | ✅                 | ❌                |
| `in-place-mutation`   | `context_with_system`     | modification, unattributed           | edited after monitor | ❌             | ❌            | ⚠️³              | ❌                |
| `payload-modify`      | `before_provider_request` | edited after monitor                 | not visible          | ❌             | ➖            | ❌                 | ➖                |
| `payload-delete`      | `before_provider_request` | edited after monitor                 | not visible          | ❌             | ➖            | ❌                 | ➖                |
| `payload-remove-tool` | `before_provider_request` | edited after monitor²                | not visible          | ❌             | ➖            | ❌                 | ➖                |
| `payload-rewrite`     | `before_provider_request` | edited after monitor                 | not visible          | ❌             | ➖            | ❌                 | ➖                |

1. Both extensions edit the latest prompt. The edited copy (`four` with both
   markers) appears as a new unattributed user message, not as a modification
   of the session message. In Unreleased it has the `Added` marker in both
   load orders; `context-reorder` has also moved it to the start of the conversation.
2. A missing declaration with no `model-only` candidates.
3. In Unreleased, the `context-add-user` message appears as `Modified`, with
   the original `four` as its `Session` preview, rather than as an addition.
   Before the monitor, `in-place-mutation` appends its marker to that added
   message, so its preview also compares against the wrong session message.
   After the monitor, that marker is absent from the snapshot.

At that Unreleased revision, payload-change detection was not implemented. The view
reported an incomplete payload comparison in both load orders, although the
external payload log confirmed that the edits reached the provider request.

### Usage view

In the Unreleased check, Usage counted the current branch with the request
snapshot applied. v0.6.0 used the older Initial capture; its `--after` results
come from the notes of that check.

| Content in Usage                                     | Target: before            | Target: after                     | v0.6.0: before                          | v0.6.0: after        | Unreleased: before                | Unreleased: after |
| ---------------------------------------------------- | ------------------------- | --------------------------------- | --------------------------------------- | -------------------- | --------------------------------- | ----------------- |
| Prompt `two`, deleted by `context-delete`            | not counted               | same as before                    | ⚠️ counted                            | ⚠️ counted         | ✅ not counted                    | ✅ not counted    |
| Prompt `four`, modified by `context-modify`          | counted once, as modified | same as before                    | ⚠️ counted twice: original and copy ⁴ | ⚠️ original only ⁴ | ✅ counted once ⁵                 | ✅ counted once ⁵ |
| Additions by `context-add` and `context-add-user`    | counted                   | same as before                    | ✅ counted under Extensions             | ❌ not counted       | ✅ counted ⁶                      | ✅ counted ⁶      |
| System changes from `context_with_system`            | counted while fresh       | not counted: edited after monitor | ❌ not counted                          | ➖                   | ✅ counted under System Prompt ⁷  | ➖                |
| `XYZZY_IN_PLACE`, appended by `in-place-mutation`    | counted                   | not counted: edited after monitor | not checked                             | not checked          | ✅ counted                        | ➖                |
| `write` declaration removed by `payload-remove-tool` | not counted               | counted                           | ⚠️ counted under Built-in Tools       | ✅ counted           | ⚠️ counted under Built-in Tools | ✅ counted        |

4. [Issue #6](https://github.com/dimk90/pi-context-view/issues/6). With `--after`,
   only the original `four` is counted; its edited copy is missing.
5. As in Injections (footnote 3), the `context-add-user` message replaces the
   original `four`, and the edited copy of `four` counts as an addition. Each
   text is counted once, so the total is right. Usage shows no markers.
6. The `context-add` message counts under Extensions, and the
   `context-add-user` message under User Messages, by role.
7. `system-append`, `section-modify`, and `section-patch` text counts under
   System Prompt, and the section that `section-delete` removes is not counted.

Payload edits from `before_provider_request` are not applied to Usage, in
either load order: prompt `three`, removed by `payload-delete`, is still
counted, and the text that `payload-modify` and `payload-rewrite` add is not.
