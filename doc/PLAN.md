## `TODO`

- [x] **Count all prompt text in System Prompt** ([measurement.md](architecture/measurement.md#extension-prompt-additions), [UI draft](drafts/injections-redesign.md)):
  - Replace the contract "Count an addition under its assigned source, never again under pi's own prompt" in both views: System Prompt counts every token of its text.
  - Extension prompt additions count in their System Prompt part; `Extension Additions` gets a real estimate instead of always reading 0.
  - Extension tools' `Available Tools` and `Guidelines` lines count in those System Prompt parts; an extension tool row counts only its definition.
  - Restored `<- source` lines stay preview annotations, now of counted text.
  - Update Usage categories and the `Highlighted` legend, which says extension text is excluded from the System Prompt count.
    Decided: the `system prompt additions` rows and their Usage `Extensions` children are removed until the extension `system prompt` row item; an extension tool preview shows only `Definition` plus `Dropped` lines, like a built-in tool. `InjectedReference` now marks a `start`/`end` range in the part's text instead of an insertion; a dropped part's text holds only its extension lines, uncounted.
    Verified on Pi 1.1.0: `pnpm check` (735 tests). Real-PTY run with a temporary extension that registers a tool with a snippet and guideline and appends a prompt addition: Injections counted `Extension Additions` (16) and the tool lines in System Prompt, the tool row counted only its definition (32), the preview annotated each line once with `<- ext.ts:smoke_tool`, and Usage showed no `Extensions` category.

- [ ] **Improve Injection View Readability** ([UI draft](drafts/injections-redesign.md))
  - [x] Right-align token values in the shared value column, so magnitudes line up.
  - [x] Keep the file name in long instruction-file paths: shorten the middle (`~/…/injection-redesign/AGENTS.md`), retaining whole trailing directories where space permits.
  - [x] Rename `TOTAL` to `TOTAL (Prompt, Tools, Injections)`, so it does not read as the context or payload size.
  - [x] **Diff columns instead of change markers** ([injections.md](ui/injections.md#request-only-changes)):
    - Replace the `Added`, `Modified`, and `Deleted` legend bullets in the list description with one bullet that explains `+N`/`-N` in their diff colors and one for `Request-Only`; keep the full sentences in previews.
    - The value column holds the tokens sent, on every counted row, including `0` for a deleted part and `10 +10` for an added one.
    - `+N` and `-N` columns follow the value. Rows under `pi` compare with pi's default prompt, so saved and request-only extension changes both show; extension-owned rows (tools, messages) compare with the session.
    - Parent and group rows sum the changes of the rows they count only.
    - Value, `+N`, and `-N` are right-aligned in fixed-width columns sized from the whole tree, stable while scrolling; dot leaders run through an empty value column.
    - `+N` uses `toolDiffAdded` and `-N` `toolDiffRemoved`, also on the selected row and in the description bullet.
    - Compute changes with a word-level diff, in numbers and previews; payload changes pair their removed and added lines the same way.
    - Round so that base + `+N` - `-N` equals the value exactly.
    - `Dropped`, `Moved`, `Forced`, and `Request-Only` are markers after the `-N` column. Narrow widths drop the diff columns whole, like markers.
    - Known limits: a request-only edit of an extension's own section folds into its `+N`; a saved edit inside pi's own section text is not detectable.
    Decided: the `Request-Only` marker and its list bullet land with the next item. Previews keep `Added`, `Modified`, and `Deleted` with their full sentences and add `+N`/`-N` after the estimate in headers and part subheaders, with a legend bullet that names the base; word-level diff lines in previews wait for the preview items. A section an extension saved and the request deleted compares with the session (`0 -N`). A forced prompt without sections compares with pi's whole default prompt. A diff never removes more than its base or adds more than its value, so text outside the estimates, such as JSON around content blocks, cannot inflate it. The degraded fallback compares the live prompt with pi's default too.
    Verified on Pi 1.1.0: `pnpm check` (754 tests). Real-PTY runs with `--system`, `--forced`, and `--context --payload --message` plus a temporary extension with a tool snippet, guideline, and custom section: the tool lines (`+8`, `+10`) and the section (`+18`) showed under pi while the tool row showed no diff, deleted extension sections read `0 -32`, the forced System Prompt read `17 +17 -3,316 · Forced`, payload changes read `+8 -6` in the row and preview header, and the diff columns dropped whole at 60 columns, in fullscreen and regular modes.
  - [x] **`Request-Only` marker** ([injections.md](ui/injections.md#request-only-changes)):
    - `Request-Only`, in `dim`, marks every row whose sent content differs from the session: request-only additions, edits, and deletions, alone or mixed with saved changes.
    - It shows what `+N` cannot: whether a change is saved or only in this request, including a request-only edit folded into a saved `+N`.
    - It also marks extension tool rows, `messages (N)`, and the `unattributed` `system prompt` row, though their numbers already imply it, so one rule covers every row.
    - Not on `payload changes (N)`: those changes are not in the captured request, and the row name says so.
    - Not on parent rows such as `System Prompt`, like `Forced`, which never marks parts. Revisit with collapsible groups.
    - Preview headers, System Prompt part subheaders, and message parts carry it too.
    Decided: `Request-Only` replaces the `Added`, `Modified`, and `Deleted` markers in previews too, as in the draft; payload-change previews keep only `+N -N`. Pi never saves a forced prompt, so a forced prompt's parts, instruction files, and skills that differ from the session's version carry `Request-Only`; System Prompt keeps only `Forced`. A part that stands for a child row (System Prompt parts, built-in tools, instruction files, skills) carries it in its subheader; a tool's own `Definition` part does not. Per-message parts wait for the message preview item; until then the message preview header carries it.
    Verified on Pi 1.1.0: `pnpm check` (755 tests). No real-PTY run.
  - [x] **Extension `system prompt` row** ([injections.md](ui/injections.md#contribution-tree)):
    - Rename `system prompt additions` to `system prompt`.
    - It shows only `+N`/`-N`, never a plain value: dots fill the value column, and it counts toward neither its group nor `TOTAL`, since System Prompt counts the text.
    - It holds the extension's tool lines (exact owner) and attributed additions (guessed owner).
    - Under an extension it shows only `+N` in practice: Pi does not report who modified or deleted prompt content, so those changes appear under `unattributed`.
    - Under `unattributed` it sums every prompt change with an unknown source, saved or request-only.
    Decided: `unattributed` also includes Instruction Files and Skills diffs. Extension rows carry `Request-Only` when their attributed lines differ from the session, not merely when their containing part is request-only. Enter previews plain text in labeled parts: an extension's own lines, or an unattributed part's whole request text (session text for deletions), with no token estimates; the header says `counted in System Prompt`, and guessed parts carry `(guess)`. Word-level diff lines wait for later preview work. Usage categories stay unchanged. Generated instruction-file and skill children now detect request-only edits, and replaced or deleted generated sections keep their measured session aggregate as the diff base.
    Verified on Pi 1.1.0: `pnpm check` (770 tests). No real-PTY run.
  - [x] **Selected-row status bar** ([injections.md](ui/injections.md#selected-row-status-bar)):
    - Place the bar above the description, outside the scrollable list, and update it when selection changes.
    - Show only relevant change/state details, including `Change` and `Changed By`; do not repeat source or location, or expose raw text.
    - Explain request-only changes and whether the session keeps the original. Show `Changed By: Unknown` when the editor is not known; never infer it from the source group.
    - Never collapse the bar when the terminal shrinks or the description collapses. Wrap at narrow widths and reserve its space by reducing the list viewport.
    - Move per-marker explanations from the list description into this bar; keep the full explanations in previews.
    - For a row with `+N`/`-N`, say whether the change is saved in the session or only in this request.
    - For an extension `system prompt` row, say why it has no value: `Already counted in System Prompt`.
    - Keep view-wide capture status separate from selected-row details.
    Decided: one field per line, indented four columns with muted field names and dim values; wrapped continuations hang two columns deeper. An unchanged row reserves one empty line; changed rows reserve only their own wrapped height. All list marker-legend bullets move into the bar; previews keep their full legends. Known and guessed editors are shown only for saved prompt lines; request-only editors stay Unknown, never inferred from the affected source. Parents and groups summarize where their counted changes live without repeating editors. When even a one-row list cannot fit, compact the frame to keep the selected row and full bar whenever physically possible.
    Verified on Pi 1.1.0: `pnpm check` (791 tests). No real-PTY run.
  - [ ] **Keep Injections capture status visible** ([injections.md](ui/injections.md#latest-request)):
    - Show compact status near the header for Latest Request versus Request Probe, pending or incomplete payload comparison, and hidden-tool count.
    - Keep this status visible when the description collapses; keep the degraded-capture reason visible too.
    - Shorten the default explanations while keeping detailed explanations available.
  - [ ] **Injections source contract** ([injections.md](ui/injections.md#contribution-tree)):
    - Top-level groups are `pi`, one group per extension, then `unattributed` for content from an extension that cannot be identified.
    - Custom messages leave their `customType` groups and move to `unattributed`; `customType` labels only the message's preview part.
    - `payload changes` moves under `unattributed`; see **One row for payload changes**.
    - Extension tool rows carry a dim `tool:` prefix (`tool:web_search`), so they read apart from the fixed rows `system prompt`, `messages (N)`, and `payload changes (N)`. Tools under `Built-in Tools (N)` keep plain names, since their group already names them.
    - Describe `unattributed` as content from an unknown extension: pi adds no custom messages to the context (`pi.share` is a session entry only).
  - [ ] **One row for messages** ([injections.md](ui/injections.md#request-only-changes)):
    - `unattributed` holds one `messages (N)` row for all custom messages and request-only message changes.
    - `N` counts the messages the request sent; deleted messages are left out, like tools in `Built-in Tools (N)`.
    - The row shows its messages' summed `+N`/`-N` against the session after its value.
  - [ ] **Message preview** ([injections.md](ui/injections.md#injection-preview)):
    - The header reads `messages (N)` with `unattributed · N tokens` and the row's `+N`/`-N`.
    - One [labeled part](ui/previews.md#labeled-parts) per message in conversation order, including deleted messages at 0 tokens.
    - The part label is the `customType` of a custom message, or the role of any other message, followed by muted `· user prompt #N · N tokens` and the message's `+N`/`-N`.
    - `user prompt #N` counts user prompts up to the message over the whole branch, not only the compacted projection, so numbers stay the same after compaction. Request-only additions take the number of the request's prompt; a message before the first prompt shows no number.
    - A modified message shows a word-level diff of its session and request versions instead of `Request` and `Session` parts. Its estimate counts the request version.
  - [ ] **One row for payload changes** ([injections.md](ui/injections.md#payload-changes)):
    - `unattributed` holds one `payload changes (N)` row without child rows, like `messages (N)`.
    - `N` counts all findings, deletions included: the row lists changes, so a deletion-only finding still counts.
    - The row shows its findings' summed `+N`/`-N` against the captured request after its value.
    - The preview shows one labeled part per finding in payload order: the message part (`user message`) or the tool name with the dim `tool:` prefix, so it reads apart from a `tool call`, then muted `· N tokens` and the finding's `+N`/`-N`, then its word-level diff. Findings carry no position, so parts have no `user prompt #N`.


## `Backlog`

- [ ] **Injections grouping by content or source** ([injections.md](ui/injections.md#contribution-tree)):
  - Offer By Content and By Source groupings of the same latest-request snapshot.
  - By Content uses the existing category names; By Source groups contributions under `pi`, each extension, and `unattributed`, keeping `payload changes` separate when present.
  - Or introduce more tabs: "System Prompt", "Extensions", "unattributed", "Diff View".
  - Show capturing type in the header, aligned to the right: "Last Req", "Probe", ...
  - Switching grouping changes presentation only, not capture, token accounting, or preview content.

- [ ] **Collapsible groups in Injections** ([injections.md](ui/injections.md#contribution-tree)):
  - Enter or `←`/`→` on a group or parent row collapses and expands its children; a collapsed row shows its child count.
  - Consider collapsing `pi` sub-groups (e.g SKILLS) by default, so extension groups fit on the first screen.

- [ ] **Improve Silent Probe Robustness with v1.1.0 features**:
  - Check especially "Added aborted to agent_settled session, extension, and JSON events, so integrations can tell a cancelled run from a finished one (#10607)".

- [ ] **Manual probe trigger** ([probe.md](architecture/probe.md#probe-layer)):
  - An explicit user action starts a new probe; one probe at a time, concurrent requests share it.
  - Choose a command or a view key; keep parsing, completions, registration text, README usage, and command tests in sync.

- [ ] **Request model at `turn_start`** ([payload-guard.md](architecture/payload-guard.md#evidence)):
  - Record `ctx.model` at the request's `turn_start` and take the virtual path when it differs from the request model, so `pi.setModel()` during preparation cannot publish a provisional result normalized with the wrong capabilities.

- [ ] **Shape-based payload extraction for virtual selections**:
  - Extract both channels early from a recognized payload shape, keep only comparison data, and normalize when dispatch arrives. Ambiguous shapes still wait or settle incomplete.
  - Only if payload retention or result delay on virtual selections becomes a measured problem; the spike found the retention small.

- [ ] **Upstream: dispatched model in `before_provider_request`**:
  - Ask Pi to forward the model that `onPayload()` already receives. It replaces the request model and the wait for dispatch, but not the blind spot for later handlers.
  - Rejected alternatives: cooperative announcements over `pi.events` need router and provider participation; wrapping provider streaming adds registration, reload, and compatibility risks to an observe-only monitor.

- [ ] **Fix Visualization for > 100% After Model Switch**:
  - e.g. Opus 1M (50%) -> switch -> Sol 200k (120%).
