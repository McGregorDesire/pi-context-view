# Injections Redesign: UI Draft

Draft for the Injections items in the [PLAN.md TODO list](../PLAN.md#todo).
It is not canonical: [ui/injections.md](../ui/injections.md) and
[ui/previews.md](../ui/previews.md) stay the contract until the items land.
Then move the agreed rules there and delete this file. The list, status bar,
messages preview (with user-prompt numbers and word-level diffs), and
payload-changes preview are now implemented. Only the System Prompt and
`system prompt` preview diff bodies below remain unscheduled; their previews
stay plain text for now.

The numbers are invented but consistent: every parent, group, and `TOTAL`
adds up. Frames are 90 columns wide.

## List

```text
──────────────────────────────────────────────────────────────────────────────────────────

Context Injections · [Latest Request]

  pi ...................................... 2,865  +200  -466
  ├─ System Prompt ........................   547  +200  -466
  │  ├─ Preamble ..........................    56   +13        Request-Only
  │  ├─ Available Tools ...................   101   +20
  │  ├─ Guidelines ........................   250   +44
  │  ├─ Documentation .....................     0        -466  Request-Only
→ │  ├─ Current Dir .......................    31   +14        Request-Only
  │  ├─ context-view-fixture-review .......    36   +36        Request-Only
  │  ├─ context-view-fixture ..............    10   +10        Request-Only
  │  └─ Extension Additions ...............    63   +63
  ├─ Instruction Files (2) ................ 1,360
  │  ├─ ~/…/injection-redesign/AGENTS.md .. 1,068
  │  └─ ~/.pi/agent/AGENTS.md .............   292
  ├─ Skills (3) ...........................   436
  │  ├─ s-vhs-recording ...................   162
  │  ├─ commit ............................   152
  │  └─ code-style ........................   122
  └─ Built-in Tools (3) ...................   522
     ├─ edit ..............................   278
     ├─ read ..............................   154
     └─ write .............................    90
  npm:pi-web-providers .................... 1,514
  ├─ tool:web_search ...................... 1,418
  └─ tool:web_contents ....................    96
  npm:@eko24ive/pi-ask .................... 1,000
  ├─ tool:ask_user ........................ 1,000
  └─ system prompt ..............................   +127
  unattributed ............................    66   +31    -5
  ├─ system prompt ..............................    +73  -466  Request-Only
  ├─ messages (4) .........................    54   +23    -1  Request-Only
  └─ payload changes (2) ..................    12    +8    -4

  TOTAL (Prompt, Tools, Injections) ....... 5,445
  (7/31)

    Change: +14 only in this request; the session keeps the original
    Changed By: Unknown

  Injections into the model context, with token estimates.
  - 1 tool hidden by pi: bash.

  ↑↓/jk Navigate · Enter Preview · Esc Close

──────────────────────────────────────────────────────────────────────────────────────────
```

### Tree

- **Groups.** `pi`, one group per extension, then `unattributed`. Custom
  messages and payload changes live under `unattributed`.
- **Aggregated rows.** `messages (4)` and `payload changes (2)` have no child
  rows; their previews list each message or finding. `messages (N)` counts the
  messages sent; `payload changes (N)` counts all findings, deletions included.
- **Value column.** Tokens sent, right-aligned, on every counted row,
  including `0` for a deleted part (`Documentation`) and `10 +10` for an added
  one (`context-view-fixture`).
- **Diff columns.** `+N` in `toolDiffAdded` and `-N` in `toolDiffRemoved`,
  right-aligned in fixed-width columns sized from the whole tree, so they stay
  in place while scrolling. They keep their colors on the selected row.
- **Diff base.** Rows under `pi` compare with pi's default prompt, so saved
  extension text shows too: `Available Tools +20` and `Guidelines +44` are
  `ask_user`'s lines, and `Extension Additions +63` is pi-ask's added text.
  Extension-owned rows (tools, messages) compare with the session.
- **Extension tool rows** carry a dim `tool:` prefix, so `tool:web_search`
  reads apart from the fixed rows `system prompt`, `messages (N)`, and
  `payload changes (N)`. Tools under `Built-in Tools (3)` keep plain names.
- **System Prompt counts all its text.** `tool:ask_user` counts only its
  definition; its prompt lines count in `Available Tools` and `Guidelines`.
- **Extension `system prompt` rows.** Only `+N`/`-N`, with dot leaders through
  the empty value column. They count toward neither their group nor `TOTAL`.
  pi-ask's row (`+127` = `+20` + `+44` + `+63`) repeats its changes; the
  `unattributed` row (`+73 -466`) repeats every change with an unknown source.
- **Deleted extension section.** A section an extension saved and the request
  deleted has no base under pi's default, so it compares with the session and
  reads `0 -N`.
- **Parent and group sums.** A parent sums the changes of the rows it counts
  only, so `npm:@eko24ive/pi-ask` shows no diff, and `unattributed` shows
  `+31 -5` from `messages (4)` and `payload changes (2)`.
- **Paths** keep the file name: `~/…/injection-redesign/AGENTS.md`.
- **Markers.** `Dropped`, `Moved`, `Forced`, and `Request-Only` are markers
  after the `-N` column. Narrow widths drop the diff columns whole, like
  markers.
- **`Request-Only`** (`dim`) marks every row whose sent content differs from
  the session, even when mixed with saved changes: `context-view-fixture-review`
  is saved text with a request-only edit folded into its `+36`. Saved
  extension text (`Available Tools`, `Extension Additions`) has no marker.
  Parent rows such as `System Prompt` never carry it, and neither does
  `payload changes (2)`.

### Header status

Implemented contract: [Context Injections header](../ui/injections.md).
The header stays visible when the description collapses. The right side lists
payload status only when it needs attention:

| State                         | Header                                                              |
| ----------------------------- | ------------------------------------------------------------------- |
| Real request, payload checked | `Context Injections · [Latest Request]`                             |
| Silent probe                  | `Context Injections · [Request Probe]` … `Payload: not checked`     |
| Payload comparison pending    | `Context Injections · [Latest Request]` … `Payload: pending`        |
| Payload comparison incomplete | `Context Injections · [Latest Request]` … `Payload: partly checked` |

Request-origin labels use bold `mdHeading`. The `Payload` label uses `muted`;
payload values and separators use `dim`, without bold or warning highlighting. At 90 columns, a probe header reads:

```text
Context Injections · [Request Probe]                                  Payload: not checked
```

The description keeps the full explanations: probe, payload reason, hidden
tool counts and names. They collapse with it; hidden tools have no header status.
Narrow headers wrap status below the title without dropping it, and the degraded
reason stays visible. The short default description does not repeat the header's
request origin. No details key is added.

### Status bar

Implemented contract: [selected-row status bar](../ui/injections.md#selected-row-status-bar).
Each field occupies its own line, indented four columns with brighter field
names. Wrapped continuations hang two columns deeper. It never collapses; the
list viewport shrinks instead. It never shows raw text or repeats the row's
source or location. An unchanged row reserves one empty line; changed rows
reserve only their own wrapped height. All marker explanations move from the
list description to this bar; previews keep their full legends.

| Selected row                         | Status bar                                                                                   |
| ------------------------------------ | -------------------------------------------------------------------------------------------- |
| `Current Dir 31 +14`                 | `Change: +14 only in this request; the session keeps the original · Changed By: Unknown`     |
| `Documentation 0 -466`               | `Change: -466 only in this request; the session keeps the original · Changed By: Unknown`    |
| `Available Tools 101 +20`            | `Change: +20 saved in the session · Changed By: npm:@eko24ive/pi-ask`                        |
| `Extension Additions 63 +63`         | `Change: +63 saved in the session · Changed By: npm:@eko24ive/pi-ask (guess)`                |
| `context-view-fixture-review 36 +36` | `Change: +36 saved in the session, with an edit only in this request · Changed By: Unknown`  |
| `System Prompt 547 +200 -466`        | `Change: +200 -466, partly only in this request`                                             |
| pi-ask `system prompt +127`          | `Change: +127 saved in the session · Already counted in System Prompt`                       |
| `messages (4) 54 +23 -1`             | `Change: +23 -1 only in this request; the session keeps the originals · Changed By: Unknown` |
| `payload changes (2) 12 +8 -4`       | `Change: +8 -4 only in the provider payload · Changed By: Unknown`                           |
| `edit 278`                           | Empty reserved line                                                                          |

`+N` and `-N` use the diff colors here too; the rest is `dim`, field names `muted`.

## Previews

Diffs follow pi's `renderDiff()` style: removed lines open with `- ` in
`toolDiffRemoved`, added lines with `+ ` in `toolDiffAdded`, and changed words
inside a changed line are inverse. Unchanged lines keep the two-column gap, so
text stays aligned. In this draft, `«…»` marks inverse words. Wrapped lines
hang under their text.

### System Prompt

Parts keep the [labeled part](../ui/previews.md#labeled-parts) layout; each
subheader adds the part's `+N`/`-N`. Extension lines are now diff additions
instead of `Highlighted` restored lines, and keep their `<- source`
annotation.

```text
──────────────────────────────────────────────────────────────────────────────────────────

System Prompt                                                 pi · 547 tokens · +200 -466

  Preamble · 56 tokens · +13 · Request-Only
  + XYZZY_SYSTEM_APPEND: request-only system instruction.

    You are an expert coding assistant operating inside pi, a coding agent harness. You
    help users by reading files, executing commands, editing code, and writing new files.


  Available Tools · 101 tokens · +20
    - read: Read file contents
    - edit: Make precise file edits with exact text replacement, including multiple
      disjoint edits in one call
    - write: Create or overwrite files
  + - ask_user: Clarify ambiguous or preference-sensitive decisions with a short
      interactive interview before proceeding <- npm:@eko24ive/pi-ask:ask_user


  Documentation · 0 tokens · -466 · Request-Only
  - Pi documentation (read only when the user asks about pi itself, its SDK, extensions,
    themes, skills, or TUI):
  - - Main documentation: /home/dmitry/.local/share/pnpm/…/README.md
  (12/86)

  - +N -N Tokens extensions added or removed, compared with pi's default prompt.
  - Request-Only Includes changes made only in this request, not saved in the session.

  ↑↓/jk Scroll · PgUp/PgDn Page · Esc Back

──────────────────────────────────────────────────────────────────────────────────────────
```

A standalone part preview, such as `Current Dir`, renders the same body under
its own header: `Current Dir … pi · 31 tokens · +14 · Request-Only`.

### Extension `system prompt`

The header says where the tokens count instead of a token estimate. Parts
are the System Prompt parts the extension changed, in prompt order.

```text
──────────────────────────────────────────────────────────────────────────────────────────

system prompt                      npm:@eko24ive/pi-ask · +127 · counted in System Prompt

  Available Tools · +20
  + - ask_user: Clarify ambiguous or preference-sensitive decisions with a short
      interactive interview before proceeding


  Guidelines · +44
  + - Use ask_user before making preference-sensitive decisions about scope, tone, UX,
      naming, architecture, docs, or implementation direction.
  + - When calling ask_user, prefer one focused decision per question.


  Extension Additions · +63 (guess)
  + When the user asks to configure, customize, debug, or explain @eko24ive/pi-ask
    settings or keymaps, first read …/pi-ask/docs/configuration.md and follow it as the
    source of truth before editing config files.

  - +N -N Tokens extensions added or removed, compared with pi's default prompt.
  - (guess) sources are inferred from the injected text itself.

  ↑↓/jk Scroll · PgUp/PgDn Page · Esc Back

──────────────────────────────────────────────────────────────────────────────────────────
```

The `unattributed` `system prompt` preview has the same layout, with every
change of unknown source, including removed lines.

### Messages

One part per message, in conversation order. The part label is the
`customType`, or the role for any other message; the muted metadata adds
`user prompt #N`, the estimate, and the message's `+N`/`-N` against the
session. A deleted message stays visible at 0 tokens but is not in the count.

```text
──────────────────────────────────────────────────────────────────────────────────────────

messages (4)                              unattributed · 54 tokens · +23 -1 · Request-Only

  context-view-fixture-agent-message · user prompt #1 · 15 tokens
    XYZZY_AGENT_START_MESSAGE: saved before_agent_start message.


  user · user prompt #1 · 0 tokens · -1 · Request-Only
  - one


  context-view-fixture-agent-message · user prompt #2 · 15 tokens
    XYZZY_AGENT_START_MESSAGE: saved before_agent_start message.


  user · user prompt #2 · 7 tokens · +6 · Request-Only
  - four
  + four «XYZZY_CONTEXT_MODIFY»


  context-view-fixture-system-add · user prompt #2 · 17 tokens · +17 · Request-Only
  + XYZZY_SYSTEM_ADD_MESSAGE: request-only message.

  - +N -N Tokens extensions added or removed, compared with the session.
  - Request-Only Includes changes made only in this request, not saved in the session.

  ↑↓/jk Scroll · PgUp/PgDn Page · Esc Back

──────────────────────────────────────────────────────────────────────────────────────────
```

### Payload changes

One part per finding, in payload order. The part label is the message part
(`system message`, `user message`, `assistant message`, `tool call`,
`tool result`) or the tool name with a dim `tool:` prefix, so a tool
declaration reads apart from a `tool call`; the muted metadata adds the estimate and the
finding's `+N`/`-N` against the captured request. Findings carry no position,
so parts have no `user prompt #N`. The guard keeps only changed lines, so each
part shows only those, and a deleted finding reads 0 tokens.

```text
──────────────────────────────────────────────────────────────────────────────────────────

payload changes (2)                                       unattributed · 12 tokens · +8 -4

  system message · 5 tokens · +5
  + XYZZY_PAYLOAD_SYSTEM: payload-only note.


  user message · 7 tokens · +3 -4
  - Summarize «the latest test» results.
  + Summarize «XYZZY_PAYLOAD» results.

  - +N -N Tokens added or removed, compared with the captured request.
  - Payload changes appear only in the provider payload. Their sources are unknown.

  ↑↓/jk Scroll · PgUp/PgDn Page · Esc Back

──────────────────────────────────────────────────────────────────────────────────────────
```
