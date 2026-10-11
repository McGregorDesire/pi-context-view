# Context Injections view

`/context injections` opens **Context Injections**. Frame, color, description,
and interaction rules live in the [UI specification](../UI.md); rules shared
with Usage previews live in [previews.md](previews.md).

Its header is:

```text
Context Injections · [Latest Request]
```

`Latest Request` uses the active `mdHeading` treatment. Runtime inspection is
roadmap-only, so no Runtime label, switching key, or Runtime status renders
until that step lands. If the combined header does not fit (below 37 columns),
put title and label on separate lines with one empty row before and after the
label.

The list description reads:

```text
Injections into the model context of the latest request, with token estimates.
```

## Latest request

The view shows the latest request snapshot of the extension runtime, the same
one Usage applies. A silent-probe snapshot is shown only until the first real
request's snapshot is published. Its composition is the session projection at
the snapshot's leaf, rebuilt when the view opens, with the snapshot's
request-only changes applied: the prompt and tools replayed from the recorded
system messages, the forced prompt in place of the replayed prompt when the
request had one, and the custom messages of the projection. Ordinary session
messages are not listed unless a request-only change touches them.

The view describes the request as it was sent, so a tool follow-up or a
one-time injection can change it between two prompts. Usage instead estimates
the current branch; [views.md](../architecture/views.md#one-snapshot-two-views)
lists the differences.

When the snapshot came from a silent probe, the description block carries a
wrapped bullet with only `request probe` in `warning` color; the rest is dim:

```text
- Captured by a request probe with an empty prompt. Prompt-dependent injections may be missing.
```

The bullet collapses with the rest of the description block. The payload guard
compares tool declarations and message text with the provider payload. While
that comparison is pending or incomplete, the description block carries one dim
guard-status bullet with the reason:

| Guard                        | Bullet                                                            |
| ---------------------------- | ----------------------------------------------------------------- |
| Pending                      | `Payload changes are not checked yet: the comparison is pending.` |
| Incomplete, nothing compared | `Payload changes were not checked: <reason>`                      |
| Incomplete, one channel only | `Payload changes were checked only in part: <reason>`             |

A standard probe says `Payload changes were not checked: No provider payload was
observed for this request.` None of these means "no changes". A partial check
still shows the [payload changes](#payload-changes) of the channel it compared.
[Hidden tools](#hidden-tools) come from Pi's prompt options, independently of
the guard, so a probe counts them too. A complete guard adds no bullet:
without payload changes, the payload matched the request, excluding Pi's known
hidden declarations, up to this extension's own `before_provider_request`
handler. Handlers after it stay invisible.

## Contribution tree

Present the request's contributions in this order:

- `pi`
  - System Prompt, including when `--system-prompt` replaced pi's default,
    with one child per part pi assembles it from, in prompt order: `Preamble`,
    `Available Tools`, `Guidelines`, `Documentation`, `Appended Prompt`
    (`--append-system-prompt` text), `Current Dir`, and `Extension Additions`.
    A custom XML section keeps its own tag as the child label, at its actual
    position, including after `Current Dir`. Parts pi rendered no text into are
    absent. A replaced prompt keeps its whole
    body as the `Preamble` part and still lists `Available Tools`, `Guidelines`,
    and `Documentation`, each at 0 tokens with the
    [`Dropped` marker](../UI.md#color-and-casing) after its estimate, so the
    tree shows what the replacement gave up; a section the replacement kept is
    an ordinary part instead. System Prompt counts all its text: extension
    tool lines in `Available Tools` and `Guidelines`, and the unwrapped text
    extensions added around pi's sections in `Extension Additions`. Moved
    `Available Tools` and `Guidelines` sections remain System Prompt
    children, at their actual prompt position
    with a [`Moved` marker](../UI.md#color-and-casing). For example, sections
    relocated past `cwd` follow `Current Dir`, not `Preamble`.
    `Extension Additions` still consolidates all unwrapped additions at the end.
    A forced prompt without XML sections has no children: System Prompt is one
    undivided part holding the whole forced text, with no `Dropped`, `Moved`,
    or `Extension Additions` parts.
    Any forced prompt carries the
    [`Forced` marker](#request-only-changes) on System Prompt.
  - `Instruction Files (M)`, with one child per context file, abbreviating home
    paths with `~`. When a path exceeds its list-label space, replace middle
    directories with `…`, keeping the root and as many whole trailing
    directories as fit (`~/…/injection-redesign/AGENTS.md`). At narrow widths,
    drop directories before shortening the filename; truncate the filename
    only if it cannot fit by itself. This is list-only formatting: captured
    paths and preview labels stay unchanged.
  - Skills (K), with one content-only child per skill
  - Built-in Tools (N), with one child per active built-in tool
- each extension/tool source, labelled by its package (`npm:pi-web`). An
  extension loaded from a path (`-e`, settings, or auto-discovery) is its own
  source, labelled like Pi's startup list: the shortest path tail no other such
  extension shares, without `/index.ts` (`hidden-tools.ts`, `my-ext`)
  - one child per active tool, counting only its definition: its prompt lines
    count in System Prompt
  - [`system prompt`](#system-prompt-rows) when that source contributed prompt
    lines, showing only their `+N`/`-N`, with no value or children
  - injected messages identified by `customType` where available
- `unattributed` for prompt changes with an unknown source, saved or
  request-only, in one [`system prompt`](#system-prompt-rows) row, and for
  request-only changes to messages without a `customType`
- `payload changes` for changes found only in the provider payload
  ([Payload changes](#payload-changes))

### System prompt rows

The extension and `unattributed` `system prompt` rows repeat prompt changes
already counted under `pi`: they show only `+N`/`-N`, never a token value. Dim
dot leaders run through the empty value column. Their changes count toward
neither their group diff nor `TOTAL (Prompt, Tools, Injections)`; a source
with only this row therefore reads 0 tokens with no group diff. No row appears
without a nonzero diff. Within each source, it follows tools and precedes
messages.

An extension's row holds its tools' exactly matched prompt lines and additions
attributed to it by a guess. It shows only `+N` in practice: Pi reports no
editor for prompt modifications or deletions. The `unattributed` row holds all
remaining changes, including custom sections, unowned additions, edits and
deletions, and changes to Instruction Files and Skills. Together these rows
sum to the prompt diffs under `pi`, excluding tool definitions. The split and
rounding contract lives in
[measurement.md](../architecture/measurement.md#system-prompt-rows).

The extension row carries `Request-Only` when its attributed lines differ
from those in the session, not merely when pi's containing part is
request-only. The `unattributed` row carries it when any of its contributing
changes is request-only. Source ownership never identifies an unknown editor.

### Request-only changes

Changes from all `context` handlers and earlier `context_with_system` handlers
stay in place in the tree. Each changed row shows its [token diff](#token-diffs)
after the tokens the request sent: an added message reads `10 +10`, a deleted
part `0 -466`, and a modified one can show both columns. Two change markers
follow the diff columns:

| Marker         | Color     | Row                                                                                  |
| -------------- | --------- | ------------------------------------------------------------------------------------ |
| `Forced`       | `warning` | System Prompt, when the request carried an extension's forced prompt instead of pi's |
| `Request-Only` | `dim`     | Any row whose sent content differs from the session                                  |

`Request-Only` shows what `+N` and `-N` cannot: whether a change is saved in
the session or exists only in this request. It marks request-only additions,
edits, and deletions, alone or mixed with saved changes, so a request-only
edit that folds into a saved `+N` still shows. Saved extension text, such as
an extension tool's lines in `Available Tools`, keeps its `+N` without the
marker. One rule covers every row, so it also marks extension tool and message
rows, though their numbers already imply it. It never marks:

- **Parent rows and groups**, such as System Prompt, `Instruction Files (M)`,
  and `Built-in Tools (N)`; `Forced` likewise never marks parts.
- **Payload changes**: they are not in the captured request, and their group
  name says so.

Pi never saves a forced prompt, so every System Prompt part, instruction file,
or skill whose forced text differs from the session's version carries
`Request-Only`, such as text appended in `Extension Additions`. System Prompt
itself carries only `Forced`.

- **Messages.** An added or modified custom message sits under its
  `customType` source with the `message` label; any other message sits under
  `unattributed` with a `<role> message` label, such as `user message`. A
  deleted message uses the `customType` of the session message it removed. A
  modified or deleted session custom message replaces its unchanged row.
- **System Prompt.** A changed section changes its part, at its position in the
  request prompt. The recorded layout also identifies inline XML, unwrapped,
  and empty sections. Pi renders changed plain content before the first section, so
  it changes `Preamble`. A deleted section follows the parts the request sent, in
  session order, before `Extension Additions`. A forced prompt replaces every
  section, so section and content changes do not apply to it. `Forced` marks
  the System Prompt row and its preview header, never its parts.
- **Tools.** A changed declaration changes its tool. A deleted tool keeps a
  0-token row under its source; `Built-in Tools (N)` counts only the tools the
  request declared. A [hidden](#hidden-tools) tool has no row.

These source groups identify the affected content, not the extension that
edited it. Changes to a pi part or a custom message remain unattributed to an
editor.

Markers keep the order `Dropped`, `Moved`, then `Forced` or `Request-Only`,
after a row's diff columns or a preview's diff. The estimate counts the
request version. `TOTAL (Prompt, Tools, Injections)` covers these contributions only, not
unchanged ordinary conversation; it is neither the full context nor a
provider-payload size.

### Selected-row status bar

The selected row's status bar sits above the description, outside the scrollable
list and its counter. It changes with selection and returns unchanged after a
preview. It shows only relevant change or state details, never raw text, the
row's source, or its location. Capture status stays in the view-wide description
and degraded warning, separate from selected-row details.

Each field occupies its own line: four-space indent, `muted` field names, `dim`
values, and six-space hanging continuation lines. `+N` uses `toolDiffAdded` and
`-N` uses `toolDiffRemoved`, including when narrow list rows omit their diff
columns. The extra indent and brighter field names distinguish the bar from the
description. Fields appear in this order:

| Field | When shown | Meaning |
| --- | --- | --- |
| `Change` | A diff, a request-only change, or a forced prompt | Actual `+N -N`, when nonzero, followed by where the changes live |
| `Changed By` | A changed leaf, except a diff-only row | Known extension editors, with `(guess)` when inferred, or `Unknown` |
| `Already counted in System Prompt` | A diff-only `system prompt` row | Why the row has no value; replaces `Changed By` |
| `Dropped` | A dropped part | `a custom system prompt replaced this part; counted nowhere` |
| `Moved` | A moved part | `in a different position in the system prompt than usual` |
| `Forced` | System Prompt carries `Forced` | `an extension’s prompt replaced pi’s system prompt for this request` |

Marker field names use their markers' fixed colors. `Change` replaces the list's
`+N -N` and `Request-Only` legend bullets; the state fields replace its `Dropped`,
`Moved`, and `Forced` bullets. Previews keep all their full legend explanations.

`Change` uses these phrases:

- `saved in the session` when the session keeps every change.
- `only in this request; the session keeps the original` for a request-only
  edit or deletion. An addition with no session original says
  `only in this request; not in the session` instead.
- `saved in the session, with an edit only in this request` for a leaf whose
  saved extension text also has a request-only edit folded into its diff.
- `only in this request` on a parent, group, or diff-only row whose changes
  are all request-only; `, partly only in this request` after the diff when
  some are saved and some request-only.
- `only in the provider payload` for payload-change rows and their group.

Parents and groups summarize only the rows they count, including removals of
session-only children. Their bars omit `Changed By`; diff-only rows count in
neither their groups nor totals. An editor is never inferred from a source
group, tool name, customType, or section tag. Exactly matched tool lines and
guessed additions name editors only on saved prompt parts. Any request-only
edit has an unknown editor, even if the edited part keeps a known extension's
lines. Remaining saved additions and every removal also have unknown editors.

A row with no change and no state marker leaves one empty reserved line. A
changed row reserves only its own wrapped fields, reducing the list viewport
instead of collapsing. The bar never collapses with the description or because
of a resize. If the normal frame cannot fit even one list row, remove spare
blank rows and reduce the header and hints, keeping the selected row and the
full bar whenever physically possible; below that minimum, keep both borders
and clip content. Height-only resizing restores the regular frame.

### Token diffs

`+N` and `-N` are the tokens a row gained and lost against its base. Counted
rows round so that the base estimate plus `+N` minus `-N` equals the value
exactly; diff-only `system prompt` rows repeat these changes without a value:

| Rows                         | Base                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| Under `pi`                   | Pi's default prompt: the session's version of a pi part without its extension lines |
| Extension tools and messages | The session                                                                         |
| `system prompt` rows         | The prompt diffs already measured under `pi`, split by source                       |
| Payload changes              | The captured request: the finding's removed lines                                   |

- **Saved extension text.** Rows under `pi` show saved and request-only
  extension text alike: an extension tool's lines in `Available Tools` and
  `Guidelines`, a custom section, and `Extension Additions`. Pi's default has
  no custom section and no `Extension Additions`, so their whole value is
  `+N`. A saved extension tool or message matches the session and shows no
  diff.
- **Deleted extension section.** A custom section the session has and the
  request deleted has no default; it compares with the session instead and
  reads `0 -N`, so the deletion stays visible.
- **Forced prompt.** A forced prompt with sections compares part by part; one
  without sections compares System Prompt with pi's whole default prompt,
  instruction files and skills included.
- **Word-level diff.** Changed words, not changed lines, make up `+N` and `-N`.
  Changed characters round up to tokens, and any rounding difference goes to
  the side with changed characters. Equal texts have no diff. A diff never
  removes more than the base or adds more than the value has; text the
  estimates leave out, such as JSON around content blocks, would otherwise
  inflate it, so such a row reads as a whole replacement.
- **Parents and groups.** A parent or group row sums the diffs of the rows it
  counts, plus the removal of parts or children only the session has. Group
  diffs leave out diff-only `system prompt` rows.
  `TOTAL (Prompt, Tools, Injections)` shows no diff.
- **Known limits.** A request-only edit of an extension's own section folds
  into its `+N`. A saved edit inside pi's own section text is not detectable:
  the session is pi's default there.

### Payload changes

Payload changes are payload differences the structured capture cannot
explain: they come from `context_with_system` handlers after this extension,
or from `before_provider_request` handlers before it. They carry no structure
or source, so they cannot stay in place. The `payload changes` group, after
`unattributed`, lists one row per finding:

- A changed message part: `system message`, `user message`,
  `assistant message`, `tool call`, or `tool result`.
- A tool declaration the payload added, removed, or describes differently: the
  tool name. A removal Pi did not report in `hiddenTools` is a deleted
  payload change (`0 -N`), not a [hidden tool](#hidden-tools).

Each row's [token diff](#token-diffs) compares the lines the payload added
with the lines it removed from the captured request. The guard keeps only the
changed lines, so a row's estimate counts the lines the payload added, and a
deleted row reads 0 tokens. These estimates count
toward the group and `TOTAL (Prompt, Tools, Injections)`. Rows sort like other
source groups and carry no change marker. While the group is shown, the
description carries a dim bullet:

```text
- Payload changes appear only in the provider payload. Their sources are unknown.
```

### Hidden tools

A tool in the snapshot's `hiddenTools` is hidden: Pi leaves its declaration
out while it stays active and callable through another tool, such as codemode.
The tree leaves a hidden tool out, whatever structured change it had: it has no
row, marker, or preview, and `TOTAL (Prompt, Tools, Injections)` does not count
it. A source left without rows has no group, and `Built-in Tools (N)` has no row
without children. Its prompt lines, if the prompt still has them, stay in pi's
prompt text.

While the request declared any hidden tool, the description carries one dim
bullet with their count and all their names in alphabetical order, wrapping as
needed, such as the first line below, or the second for a single tool:

```text
- 4 tools hidden by pi: bash, edit, read, write.
- 1 tool hidden by pi: bash.
```

A hidden name the request did not declare is not counted. Previews do not
repeat the bullet.

Capture reads Pi's `before_agent_start.systemPromptOptions.hiddenTools`, so
the count works for a silent probe before the first ordinary prompt. It is
independent of payload comparison and stays with the snapshot until the next
request replaces it, even after the active tools change. A degraded fallback
without a snapshot uses the live list instead.

Pi does not report which tool's `prepareLoadout()` hid each declaration. Do
not guess from `model-only` exposure or name a candidate. Capture's observation
limits are documented in
[capture.md](../architecture/capture.md#hidden-tools).

Within the `pi` group, keep the fixed semantic order above. Children break
down parent contributions and do not increase totals. Measurements and previews exclude XML transport wrappers and
section-introduction scaffolding; pi sends its `cwd` section with every
request, so it is measured as the `Current Dir` part.

Use dim `├─`, `└─`, and `│` connectors for source, item, and constituent
hierarchy. Right-align every token estimate in one shared, fixed-width value
column, sized from the largest formatted estimate in the whole tree, including
`TOTAL (Prompt, Tools, Injections)`, so its right edge stays stable while
scrolling. Cap the column's start near the tree (`MAX_TOKEN_VALUE_COLUMN`) on
wide terminals, leaving unused space to the right.
The `+N` and `-N` columns follow the value column, each after two spaces and
right-aligned in a fixed width sized from the widest `+N` or `-N` in the whole
tree, so they also stay stable while scrolling. A column no row fills is
absent. `+N` uses `toolDiffAdded` and `-N` `toolDiffRemoved`, also on the
selected row. A row leaves a column blank when that side is zero, and ends
without trailing blanks unless a marker follows. Markers follow the right edge
of the `-N` column. When the diff columns do not fit the width, every row drops
them whole, like a marker; markers then follow the value column.
Fill label/value gaps with dim dot leaders, running through the value column
on diff-only `system prompt` rows; as width shrinks, shorten or remove
leaders before truncating labels or token values, and retain tree connectors
where space permits.

Place one empty row before `TOTAL (Prompt, Tools, Injections)`. It is the last
row in the scrollable list, counts only the shown snapshot's contributions, and
is not selectable: cursor navigation, the selectable-row counter, and Enter
preview skip it. At narrow widths, truncate the label before the token value,
like other list labels.

The list description survives scrolling, per the floor in
[Descriptions](../UI.md#descriptions); the `(current/total)` counter never
collapses it by itself. When capture is degraded, wrap the precise reason below
the header and show a `Degraded: pi-native fallback used` indicator beside the
description, with only `Degraded` in `warning` color and the colon and explanation
in `dim`, keeping the fallback hierarchy usable. Below both come, when shown, the probe bullet,
the guard-status bullet, the [hidden-tools bullet](#hidden-tools), then the
payload-changes bullet. All collapse with the rest of the description block.
The [selected-row status bar](#selected-row-status-bar), above the description,
explains changes and markers instead of list-wide legend bullets.

## Injection preview

Enter on an injection item opens its sanitized raw text. Show item title,
source, and estimated tokens in the header; wrap content to available width and
support arrow and page scrolling. Escape returns to the same selected row. Raw
text must never appear in row descriptions.

A tool item renders its labeled parts under the
[labeled part rules](previews.md#labeled-parts) instead of one undivided block
of raw text. An item with children — System Prompt, Instruction Files, Skills,
Built-in Tools — renders one part per child under the same rules, so children
stay separated by two blank rows instead of running together. The whole preview
is full content, so marked JSON expands here, in an aggregate part as much as in
a tool's own definition.

A `system prompt` row previews one labeled part per affected prompt part, in
prompt order, with no token estimates. Its header reads
`source · +N -N · counted in System Prompt`, followed by `Request-Only` when
applicable. Parts read `Available Tools · +20`; a guessed owner adds dim
` (guess)` after its diff, such as `Extension Additions · +63 (guess)`, with
the usual guess legend bullet. An extension's part shows only its own lines,
without source annotations. At narrow widths, the header drops the marker
first, then the accounting note, then the diff. An unattributed part shows the
whole request part with its existing source annotations, or the session text
of a deleted part.
Instruction-file and skill changes follow System Prompt parts. Session-only
children omitted from the request appear as a reference part with their
removed text. These previews are plain text for now; word-level diff lines
come later. The diff legend names pi's default prompt, like the original pi
parts whose diffs these rows repeat.

The preview header of a counted item carries its token diff, then its markers,
after its estimate: `pi · 547 tokens · +200 -466 · Forced`. A narrow header drops the
markers first, then the diff. A [labeled part](previews.md#labeled-parts)
that stands for a child row carries the row's diff and markers the same way:
`Current Dir · 31 tokens · +14 · Request-Only`. Like the list, previews show
no `Added`, `Modified`, or `Deleted` markers: the diff and the estimate tell
those changes apart, and `Request-Only` tells that the session does not keep
them. The `+N -N` legend bullet names the base: pi's default prompt for pi's
items, the session for extension tools and messages, and the captured request
for payload changes. A changed message previews both versions:

- A **modified** message renders a `Request` part with the counted request
  version and a `Session` part with the session original at 0 tokens.
- A **deleted** message renders the session original undivided; the header
  reads 0 tokens.

A deleted System Prompt part or tool previews the session text it removed, at 0
tokens. A modified System Prompt part or tool shows only the request version.

A payload change previews its changed lines in payload order, without labeled
parts. A line only in the payload opens with `+ ` in `toolDiffAdded`; a line
only in the captured request opens with `- ` in `toolDiffRemoved`. The whole line takes
that color, and wrapped continuation lines hang under its text.

After the legend bullets of its markers, a payload-change preview repeats the
payload-changes bullet. Descriptions collapse under the rules in
[previews.md](previews.md#marker-legend).
