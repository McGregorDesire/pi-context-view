/**
 * Injections composition from a request snapshot: the session projection at
 * the snapshot's leaf, rebuilt when the view opens, with the snapshot's
 * request-only changes marked and hidden tools left out, plus the payload
 * guard's payload changes. Every contribution carries the tokens it gained and
 * lost against its base. Reads the snapshot and current Pi data only; imports
 * no capture or probe module.
 */
import { getCurrentSystemMessage } from "@earendil-works/pi-ai";
import {
	type BuildSystemPromptOptions,
	estimateTokens,
	type SessionEntry,
	type ToolInfo,
} from "@earendil-works/pi-coding-agent";

import {
	analyzeSystemPrompt,
	isPiPromptPart,
	SYSTEM_PROMPT_ITEM_ID,
	textTokens,
	type ToolSlice,
} from "./measure.ts";
import { messagePreview } from "./message-preview.ts";
import {
	AGGREGATE_SOURCE,
	buildSnapshot,
	type InjectedReference,
	type InjectionItem,
	type InjectionSnapshot,
	type InjectionSource,
	messageTypeSource,
	PAYLOAD_CHANGES_SOURCE,
	type RequestChange,
	sumTokenDiffs,
	type TokenDiff,
} from "./model.ts";
import { type MessageFilter, type ProjectedMessage, readProjection } from "./projection.ts";
import type { PromptSourceSlice } from "./prompt-additions.ts";
import {
	applySystemChanges,
	buildNativeSnapshot,
	markForcedPrompt,
	type NativeSnapshotInput,
	replayedToolSlices,
	splitHiddenTools,
} from "./replay.ts";
import type {
	ConversationChange,
	GuardFinding,
	GuardResult,
	MessagePart,
	RequestMessage,
	RequestSnapshot,
} from "./snapshot.ts";
import { type DiffSide, measureTokenDiff } from "./token-diff.ts";
import { type SystemMessage, systemMessageText } from "./transcript.ts";

/** Row label of a payload change, by the message part it changed. */
const PAYLOAD_CHANGE_LABELS: Readonly<Record<MessagePart, string>> = {
	system: "system message",
	user: "user message",
	assistant: "assistant message",
	"tool-call": "tool call",
	"tool-result": "tool result",
};

/** Everything the composition reads besides the snapshot itself. */
export interface InjectionsInput {
	readonly snapshot: RequestSnapshot;
	/** Current session entries; they are append-only, so the snapshot's leaf still rebuilds its baseline. */
	readonly entries: SessionEntry[];
	/** Removes recorded probe messages, as capture did for the baseline. */
	readonly filterMessages: MessageFilter;
	/**
	 * Live prompt options; only `customPrompt` is used, to mark dropped blocks.
	 * The snapshot's hidden tools replace `hiddenTools`.
	 */
	readonly options: BuildSystemPromptOptions;
	readonly allTools: readonly ToolInfo[];
	/** Loaded extension provenance: labels path extensions and guesses who appended prompt text. */
	readonly promptSources?: readonly PromptSourceSlice[];
	/** Live prompt and active tools, used only when the branch recorded no system state. */
	readonly systemPrompt: string;
	readonly activeToolNames: readonly string[];
}

/**
 * Build the Injections tree of one request: its replayed prompt and tools,
 * custom messages, and changes, with the guard's payload changes in their own
 * group. The tools Pi hid are left out; their names supply the description note.
 */
export function buildInjectionsSnapshot(input: InjectionsInput): InjectionSnapshot {
	const baseline = readProjection(input.entries, input.snapshot.leafId, input.filterMessages);
	const findings = guardFindings(input.snapshot.guard);
	const prompt = measureRequestPrompt(input, baseline.map(({ message }) => message));
	const items = [
		...prompt.items,
		...measureMessages(input.snapshot.changes.conversation, baseline),
		...measurePayloadChanges(findings),
	];
	return { ...buildSnapshot(items), hiddenTools: prompt.hiddenTools };
}

/**
 * The degraded fallback without a request snapshot: the live prompt and tools,
 * compared with pi's default prompt like a captured request.
 */
export function buildFallbackInjectionsSnapshot(input: NativeSnapshotInput): InjectionSnapshot {
	const native = measureNativePrompt(input);
	return { ...buildSnapshot(withPromptDiffs(native.items, native.items)), hiddenTools: native.hiddenTools };
}

/** Findings of every compared channel; a pending guard has none yet. */
function guardFindings(guard: GuardResult): readonly GuardFinding[] {
	return guard.status === "pending" ? [] : guard.findings ?? [];
}

// ============================================================================
// Prompt and tools
// ============================================================================

/** Measured prompt and tool items, and names of the tools Pi hid from the model and the items leave out. */
interface RequestPrompt {
	readonly items: readonly InjectionItem[];
	readonly hiddenTools: readonly string[];
}

/**
 * Measure the replayed prompt and tools with the request's system changes
 * applied. A forced prompt replaces every section, so only tool changes reach
 * it. A tool Pi hid is left out, whatever structured change it had. A branch
 * with no recorded system state uses the live prompt and tools.
 */
function measureRequestPrompt(input: InjectionsInput, baseline: readonly RequestMessage[]): RequestPrompt {
	const hiddenTools = input.snapshot.hiddenTools ?? [];
	const base = getCurrentSystemMessage(baseline);
	const forced = input.snapshot.forcedPrompt;
	if (base === undefined) {
		const live = { ...input, options: { ...input.options, hiddenTools: [...hiddenTools] } };
		const native = measureNativePrompt({ ...live, forcedPrompt: forced });
		const session = forced === undefined ? native : measureNativePrompt(live);
		return { items: withPromptDiffs(native.items, session.items), hiddenTools: native.hiddenTools };
	}
	const request = applySystemChanges(base, input.snapshot.changes.system);
	const declarations = splitHiddenTools(request.declarations, hiddenTools);
	const tools: ToolSlice[] = [
		...replayedToolSlices(request.state, declarations.declared, input.allTools)
			.map((tool) => withToolChange(tool, request.tools.get(tool.name))),
		...replayedToolSlices(base, request.deletedTools, input.allTools)
			.map((tool) => withToolChange(tool, "deleted")),
	];
	const items = markForcedPrompt(analyzeSystemPrompt(
		forced ?? systemMessageText(request.state),
		{ homeDir: process.env.HOME, customPrompt: input.options.customPrompt },
		tools,
		{ sources: input.promptSources },
		forced === undefined ? request.prompt : {},
	), forced);
	return {
		items: withPromptDiffs(items, measureSessionPrompt(input, base, hiddenTools)),
		hiddenTools: declarations.hiddenNames,
	};
}

/**
 * The session's prompt and tools at the snapshot's leaf, measured like the
 * request but without its changes: the base the request's prompt and tool
 * rows compare with.
 */
function measureSessionPrompt(
	input: InjectionsInput,
	base: SystemMessage,
	hiddenTools: readonly string[],
): InjectionItem[] {
	const session = applySystemChanges(base, []);
	const declared = splitHiddenTools(session.declarations, hiddenTools).declared;
	return analyzeSystemPrompt(
		systemMessageText(session.state),
		{ homeDir: process.env.HOME, customPrompt: input.options.customPrompt },
		replayedToolSlices(session.state, declared, input.allTools),
		{ sources: input.promptSources },
		{ replayed: session.prompt.replayed },
	);
}

/** Live prompt and tool items without recorded system state, and the tools Pi hid. */
function measureNativePrompt(input: NativeSnapshotInput): RequestPrompt {
	const native = buildNativeSnapshot(input);
	return { items: native.groups.flatMap((group) => group.items), hiddenTools: native.hiddenTools ?? [] };
}

/** The slice with a request-only change, or unchanged when there is none. */
function withToolChange(tool: ToolSlice, change: RequestChange | undefined): ToolSlice {
	return change === undefined ? tool : { ...tool, change };
}

// ============================================================================
// Messages
// ============================================================================

/**
 * Items for the session's custom messages and every conversation change. A
 * modified or deleted message takes the place of its unchanged session row.
 */
function measureMessages(
	changes: readonly ConversationChange[],
	baseline: readonly ProjectedMessage[],
): InjectionItem[] {
	const consumed = new Set<ProjectedMessage>();
	/** The first unconsumed conversation message of an entry; an entry rarely holds more than one. */
	const take = (entryId: string): RequestMessage | undefined => {
		const found = baseline.find((candidate) => candidate.entryId === entryId
			&& candidate.message.role !== "system" && !consumed.has(candidate));
		if (found !== undefined) consumed.add(found);
		return found?.message;
	};
	const changed = changes.map((change, index) => changeItem(`change:${index}`, change, take));

	const occurrences = new Map<string, number>();
	const unchanged: InjectionItem[] = [];
	for (const entry of baseline) {
		if (consumed.has(entry) || entry.message.role !== "custom") continue;
		const customType = entry.message.customType;
		const occurrence = occurrences.get(customType) ?? 0;
		occurrences.set(customType, occurrence + 1);
		unchanged.push(messageItem(`message:${customType}:${occurrence}`, entry.message, messageTypeSource(customType)));
	}
	return [...unchanged, ...changed];
}

/**
 * One conversation change as a marked, request-only item with its token diff
 * against the session; deletions read 0 tokens and preview the session original.
 */
function changeItem(
	id: string,
	change: ConversationChange,
	take: (entryId: string) => RequestMessage | undefined,
): InjectionItem {
	const source = change.attribution.customType === undefined
		? AGGREGATE_SOURCE
		: messageTypeSource(change.attribution.customType);
	switch (change.type) {
		case "added": {
			const item = messageItem(id, change.message, source, true);
			return { ...item, change: "added", requestOnly: true, ...diffField(measureTokenDiff(undefined, item)) };
		}
		case "modified": {
			const item = messageItem(id, change.message, source, true);
			const original = take(change.entryId);
			if (original === undefined) return { ...item, change: "modified", requestOnly: true };
			const session = messagePreview(original);
			const diff = measureTokenDiff({ text: session.text, tokens: estimateTokens(original) }, item);
			return {
				...item,
				change: "modified",
				requestOnly: true,
				...diffField(diff),
				sections: [
					{ label: "Request", text: item.text, tokens: item.tokens, jsonSpan: item.jsonSpan },
					{ label: "Session", text: session.text, tokens: 0, jsonSpan: session.jsonSpan },
				],
			};
		}
		case "deleted": {
			const original = take(change.entryId);
			if (original === undefined) {
				return {
					id, kind: "message", source, label: "message", chars: 0, tokens: 0, text: "",
					change: "deleted", requestOnly: true,
				};
			}
			const item = messageItem(id, original, source);
			const diff = measureTokenDiff(item, { text: "", tokens: 0 });
			return { ...item, chars: 0, tokens: 0, change: "deleted", requestOnly: true, ...diffField(diff) };
		}
	}
}

// ============================================================================
// Payload changes
// ============================================================================

/**
 * One item per payload change, in the payload-changes group. The guard keeps only the
 * changed lines, so each item counts the lines the payload added; a deletion
 * reads 0 tokens. Its token diff compares the added lines with the removed
 * ones, the lines of the captured request.
 */
function measurePayloadChanges(findings: readonly GuardFinding[]): InjectionItem[] {
	return findings.map((finding, index): InjectionItem => {
		const text = finding.lines.filter((line) => line.type === "added").map((line) => line.text).join("\n");
		const removed = finding.lines.filter((line) => line.type === "removed").map((line) => line.text).join("\n");
		const base = removed.length === 0 ? undefined : { text: removed, tokens: textTokens(removed) };
		return {
			id: `payload:${index}`,
			kind: finding.type === "payload-change" ? "message" : "tool",
			source: PAYLOAD_CHANGES_SOURCE,
			label: finding.type === "payload-change" ? PAYLOAD_CHANGE_LABELS[finding.part] : finding.name,
			chars: text.length,
			tokens: textTokens(text),
			text,
			change: finding.change,
			...diffField(measureTokenDiff(base, { text, tokens: textTokens(text) })),
			changedLines: finding.lines,
		};
	});
}

/** A measured message with its content-only preview. */
function messageItem(id: string, message: RequestMessage, source: InjectionSource, redacted = false): InjectionItem {
	const { text, jsonSpan } = messagePreview(message, redacted);
	return {
		id,
		kind: "message",
		source,
		label: message.role === "custom" ? "message" : `${message.role} message`,
		chars: text.length,
		tokens: estimateTokens(message),
		text,
		jsonSpan,
	};
}

// ============================================================================
// Token diffs
// ============================================================================

/**
 * Prompt and tool items with the tokens each gained and lost against its base.
 * Rows under pi compare with pi's default prompt: the session's version of a
 * pi part without the extension lines measured in it, so saved and
 * request-only extension text both count as added. A custom section and
 * Extension Additions are extension text with no default; a deleted custom
 * section compares with the session instead, so its deletion stays visible.
 * Tools, instruction files, and skills compare with the session. A parent sums
 * its children, plus the removal of children only the session has. Each leaf
 * also learns whether it is request-only.
 */
function withPromptDiffs(items: readonly InjectionItem[], session: readonly InjectionItem[]): InjectionItem[] {
	const sessionById = new Map<string, InjectionItem>();
	for (const item of session) {
		sessionById.set(item.id, item);
		for (const child of item.children ?? []) sessionById.set(child.id, child);
	}
	const context: DiffContext = {
		sessionById,
		sessionItems: session,
		sentIds: new Set(items.map((item) => item.id)),
		forced: items.some((item) => item.id === SYSTEM_PROMPT_ITEM_ID && item.change === "forced"),
	};
	return items.map((item) => withItemDiff(item, context, false));
}

/** The session's prompt and tool items that request items compare with. */
interface DiffContext {
	/** Session items and their children, by id. */
	readonly sessionById: ReadonlyMap<string, InjectionItem>;
	/** Top-level session items, which an undivided System Prompt compares with. */
	readonly sessionItems: readonly InjectionItem[];
	/** Ids of the request's top-level items. */
	readonly sentIds: ReadonlySet<string>;
	/** True when the request carried a forced prompt, whose text the session never keeps. */
	readonly forced: boolean;
}

/**
 * One item with its diff and, for a leaf, its request-only state; `promptPart`
 * marks a System Prompt part. Its sections mirror its children one to one, so
 * preview subheaders show the same diffs and markers as the rows.
 */
function withItemDiff(item: InjectionItem, context: DiffContext, promptPart: boolean): InjectionItem {
	if (item.dropped === true) return item;
	const children = item.children ?? [];
	if (children.length === 0) {
		const request: DiffSide = item.change === "deleted" ? { text: "", tokens: 0 } : item;
		return {
			...item,
			...diffField(measureTokenDiff(itemBase(item, context, promptPart), request)),
			...(isRequestOnly(item, context) ? { requestOnly: true } : {}),
		};
	}
	const parts = item.id === SYSTEM_PROMPT_ITEM_ID;
	const diffed = children.map((child) => withItemDiff(child, context, parts));
	const sent = new Set(children.map((child) => child.id));
	const sessionOnly = (context.sessionById.get(item.id)?.children ?? []).filter((child) => !sent.has(child.id));
	const diff = sumTokenDiffs([
		...diffed.map((child) => child.diff),
		...sessionOnly.map((child) => removedDiff(defaultSide(child, parts))),
	]);
	return {
		...item,
		...diffField(diff),
		children: diffed,
		sections: item.sections?.map((section, index) => ({
			...section,
			...diffField(diffed[index]?.diff),
			...(diffed[index]?.requestOnly === true ? { requestOnly: true } : {}),
		})),
	};
}

/**
 * Whether the request sent other content than the session keeps for one leaf:
 * a request-only addition, edit, or deletion, or forced prompt text that
 * differs from the session's version. Tool changes reach a forced prompt as
 * usual, and the undivided System Prompt carries only its `forced` change.
 */
function isRequestOnly(item: InjectionItem, context: DiffContext): boolean {
	if (item.change !== undefined && item.change !== "forced") return true;
	if (!context.forced || item.kind === "tool" || item.id === SYSTEM_PROMPT_ITEM_ID) return false;
	return context.sessionById.get(item.id)?.text !== item.text;
}

/**
 * What one request item compares with: pi's default text of a pi part, no
 * base for an extension's own part unless the request deleted it, pi's whole
 * default prompt for an undivided System Prompt, or the session's version of
 * anything else. Undefined counts the whole item as added.
 */
function itemBase(item: InjectionItem, context: DiffContext, promptPart: boolean): DiffSide | undefined {
	if (item.id === SYSTEM_PROMPT_ITEM_ID) return defaultPromptSide(context);
	const session = context.sessionById.get(item.id);
	if (promptPart && !isPiPromptPart(item.id)) {
		if (item.change !== "deleted") return undefined;
		return session ?? { text: item.text, tokens: textTokens(item.text) };
	}
	return session === undefined ? undefined : defaultSide(session, promptPart);
}

/**
 * What pi's default prompt holds of one session item: a pi part without the
 * extension lines in it, nothing of an extension's own part or of a part a
 * replacement dropped, and any other item whole.
 */
function defaultSide(item: InjectionItem, promptPart: boolean): DiffSide | undefined {
	if (item.dropped === true) return undefined;
	if (!promptPart) return item;
	if (!isPiPromptPart(item.id)) return undefined;
	const references = item.injectedReferences ?? [];
	if (references.length === 0) return item;
	const text = withoutReferences(item.text, references);
	return { text, tokens: textTokens(text) };
}

/**
 * Pi's whole default prompt, for a System Prompt without parts, such as a
 * forced prompt without sections: the default text of every session part, and
 * the instruction files and skills the request does not list separately.
 */
function defaultPromptSide(context: DiffContext): DiffSide | undefined {
	const prompt = context.sessionById.get(SYSTEM_PROMPT_ITEM_ID);
	if (prompt === undefined) return undefined;
	const parts = prompt.children?.map((part) => defaultSide(part, true)) ?? [prompt];
	const records = context.sessionItems.filter((item) =>
		(item.kind === "context-file" || item.kind === "skills") && !context.sentIds.has(item.id));
	const sides = [...parts, ...records].filter((side): side is DiffSide => side !== undefined && side.text.length > 0);
	return {
		text: sides.map((side) => side.text).join("\n"),
		tokens: sides.reduce((sum, side) => sum + side.tokens, 0),
	};
}

/** Text without the extension lines its references cover. */
function withoutReferences(text: string, references: readonly InjectedReference[]): string {
	let kept = "";
	let offset = 0;
	for (const reference of [...references].sort((a, b) => a.start - b.start)) {
		kept += text.slice(offset, reference.start);
		offset = Math.max(offset, reference.end);
	}
	return kept + text.slice(offset);
}

/** The removal of a whole base, or undefined when there is none. */
function removedDiff(base: DiffSide | undefined): TokenDiff | undefined {
	return base === undefined ? undefined : measureTokenDiff(base, { text: "", tokens: 0 });
}

/** `{ diff }` when there is one, so unchanged items carry no extra key. */
function diffField(diff: TokenDiff | undefined): { readonly diff?: TokenDiff } {
	return diff === undefined ? {} : { diff };
}
