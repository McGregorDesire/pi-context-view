/**
 * Injections composition from a request snapshot: the rebuilt baseline at the
 * snapshot's leaf with its request-only changes applied and marked.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { Tool } from "@earendil-works/pi-ai";
import { SessionManager, type ToolInfo } from "@earendil-works/pi-coding-agent";

import { buildFallbackInjectionsSnapshot, buildInjectionsSnapshot, type InjectionsInput } from "../src/injections.ts";
import { AGGREGATE_SOURCE_ID, type InjectionItem, type InjectionSnapshot } from "../src/model.ts";
import type {
	ConversationChange,
	GuardFinding,
	GuardResult,
	RequestMessage,
	RequestSnapshot,
	SystemChange,
} from "../src/snapshot.ts";

const READ: Tool = { name: "read", description: "Read files", parameters: { type: "object", properties: {} } } as Tool;
const BASH: Tool = { name: "bash", description: "Run commands", parameters: { type: "object", properties: {} } } as Tool;
const SECTIONS = {
	preamble: "You are a test assistant.",
	tools: "<tools>\n- read: Read files\n- bash: Run commands\n</tools>",
	docs: "<docs>\nPi documentation lives here.\n</docs>",
	cwd: "<cwd>\n/tmp/project\n</cwd>",
};
const BUILTIN_TOOLS = [READ, BASH].map((tool) => ({
	...tool,
	sourceInfo: { source: "builtin", path: `<builtin:${tool.name}>` },
})) as unknown as ToolInfo[];

/** A session with a recorded system state, a custom message, and two user prompts. */
function createSession(): { session: SessionManager; entries: Record<"custom" | "first" | "second", string> } {
	const session = SessionManager.inMemory("/tmp/project");
	session.appendMessage({ role: "system", content: "", sections: SECTIONS, toolsAdded: [READ, BASH], timestamp: 1 });
	const custom = session.appendCustomMessageEntry("fixture-notes", "stored note", false);
	const first = session.appendMessage({ role: "user", content: "first prompt", timestamp: 3 });
	const second = session.appendMessage({ role: "user", content: "second prompt", timestamp: 4 });
	return { session, entries: { custom, first, second } };
}

/** Composition input for a snapshot taken at the session's current leaf. */
function input(
	session: SessionManager,
	changes: { conversation?: ConversationChange[]; system?: SystemChange[] } = {},
	extra: Partial<RequestSnapshot> = {},
): InjectionsInput {
	const snapshot: RequestSnapshot = {
		id: 1,
		origin: "real-turn",
		leafId: session.getLeafId(),
		changes: { conversation: changes.conversation ?? [], system: changes.system ?? [] },
		guard: { status: "incomplete", reason: "No payload." },
		...extra,
	};
	return {
		snapshot,
		entries: session.getEntries(),
		filterMessages: (messages) => messages,
		options: { cwd: "/tmp/project" },
		allTools: BUILTIN_TOOLS,
		systemPrompt: "live prompt",
		activeToolNames: ["read"],
	};
}

/** Every item and child, keyed by id. */
function itemsById(snapshot: InjectionSnapshot): Map<string, InjectionItem> {
	const items = new Map<string, InjectionItem>();
	for (const item of snapshot.groups.flatMap((group) => group.items)) {
		items.set(item.id, item);
		for (const child of item.children ?? []) items.set(child.id, child);
	}
	return items;
}

/** `group / label · tokens · change` lines for message items. */
function describeMessages(snapshot: InjectionSnapshot): string[] {
	return snapshot.groups.flatMap((group) => group.items.filter((item) => item.kind === "message")
		.map((item) => `${group.source.label} / ${item.label} · ${item.tokens}${item.change ? ` · ${item.change}` : ""}`));
}

/** A user message as a request carries it. */
function user(content: string): Extract<RequestMessage, { role: "user" }> {
	return { role: "user", content, timestamp: 5 };
}

test("the composition replays the recorded prompt and tools and lists session custom messages", () => {
	const { session } = createSession();
	const filtered: number[] = [];
	const snapshot = buildInjectionsSnapshot({
		...input(session),
		filterMessages: (messages) => {
			filtered.push(messages.length);
			return messages;
		},
	});
	const items = itemsById(snapshot);

	assert.ok(filtered.length > 0, "baseline messages pass through the probe filter");
	assert.deepEqual(items.get("base-prompt")?.children?.map((child) => child.label),
		["Preamble", "Available Tools", "Documentation", "Current Dir"]);
	assert.equal(items.get("tool:builtin")?.label, "Built-in Tools (2)");
	assert.deepEqual(describeMessages(snapshot), ["fixture-notes / message · 3"], "user prompts are not injections");
	assert.ok([...items.values()].every((item) => item.change === undefined));
	assert.equal(snapshot.totalTokens, snapshot.groups.reduce((sum, group) => sum + group.totalTokens, 0));
});

test("conversation changes stay in place with their markers", () => {
	const { session, entries } = createSession();
	const added: RequestMessage = {
		role: "custom", customType: "fixture-add", content: "added note", display: false, timestamp: 5,
	};
	const modifiedNote: RequestMessage = {
		role: "custom", customType: "fixture-notes", content: "rewritten stored note", display: false, timestamp: 2,
	};
	const snapshot = buildInjectionsSnapshot(input(session, {
		conversation: [
			{ type: "added", message: added, attribution: { customType: "fixture-add" } },
			{ type: "added", message: user("added user text"), attribution: {} },
			{ type: "modified", entryId: entries.custom, message: modifiedNote, attribution: { customType: "fixture-notes" } },
			{ type: "modified", entryId: entries.second, message: user("edited second prompt"), attribution: {} },
			{ type: "deleted", entryId: entries.first, attribution: {} },
		],
	}));

	assert.deepEqual(describeMessages(snapshot).sort(), [
		"fixture-add / message · 3 · added",
		"fixture-notes / message · 6 · modified",
		"unattributed / user message · 0 · deleted",
		"unattributed / user message · 4 · added",
		"unattributed / user message · 5 · modified",
	], "the modified session custom message replaces its unchanged row");

	const items = [...itemsById(snapshot).values()];
	const modified = items.find((item) => item.change === "modified" && item.label === "user message");
	assert.deepEqual(modified?.sections?.map((part) => [part.label, part.text, part.tokens]), [
		["Request", "edited second prompt", 5],
		["Session", "second prompt", 0],
	]);
	const deleted = items.find((item) => item.change === "deleted");
	assert.equal(deleted?.text, "first prompt", "a deletion previews the session original");
	assert.equal(deleted?.sections, undefined);
});

test("system changes apply to the measured prompt and tools and mark what they touched", () => {
	const { session } = createSession();
	const edit: Tool = { ...READ, description: "Read files, edited for this request" };
	const grep: Tool = { name: "grep", description: "Search files", parameters: { type: "object" } } as Tool;
	const snapshot = buildInjectionsSnapshot(input(session, {
		system: [
			{ type: "content", text: "Appended instructions." },
			{ type: "section", name: "cwd", text: "<cwd>\n/tmp/project\nwith a note\n</cwd>" },
			{ type: "section", name: "fixture_notes", text: "<fixture_notes>\nRequest-only section.\n</fixture_notes>" },
			{ type: "section", name: "docs", text: null },
			{ type: "tool", name: "read", declaration: edit },
			{ type: "tool", name: "grep", declaration: grep },
			{ type: "tool", name: "bash", declaration: null },
		],
	}));
	const items = itemsById(snapshot);
	const prompt = items.get("base-prompt");

	assert.deepEqual(prompt?.children?.map((child) => [child.label, child.change, child.tokens > 0]), [
		["Preamble", "modified", true],
		["Available Tools", undefined, true],
		["Current Dir", "modified", true],
		["fixture_notes", "added", true],
		["Documentation", "deleted", false],
	], "the deleted section follows the sent parts");
	assert.equal(items.get("base-prompt:documentation")?.text, "Pi documentation lives here.");
	assert.deepEqual(prompt?.sections?.map((part) => part.change), ["modified", undefined, "modified", "added", "deleted"]);
	assert.ok(items.get("base-prompt:preamble")?.text.startsWith("Appended instructions."));
	assert.equal(prompt?.tokens, prompt?.children?.reduce((sum, child) => sum + child.tokens, 0));

	assert.equal(items.get("tool:builtin")?.label, "Built-in Tools (1)", "the count names declared tools only");
	assert.equal(items.get("tool:builtin:read")?.change, "modified");
	const bash = items.get("tool:builtin:bash");
	assert.deepEqual([bash?.change, bash?.tokens], ["deleted", 0]);
	assert.match(bash?.sections?.[0]?.text ?? "", /^bash: Run commands/, "a deleted tool previews its session definition");
	assert.equal(items.get("tool:unattributed:grep")?.change, "added");
});

test("a forced prompt is measured whole and ignores section changes", () => {
	const { session } = createSession();
	const snapshot = buildInjectionsSnapshot(input(session, {
		system: [{ type: "section", name: "docs", text: null }, { type: "tool", name: "bash", declaration: null }],
	}, { forcedPrompt: "Forced prompt text." }));
	const items = itemsById(snapshot);

	assert.equal(items.get("base-prompt")?.text, "Forced prompt text.");
	assert.equal(items.get("base-prompt")?.children, undefined);
	assert.equal(items.get("tool:builtin:bash")?.change, "deleted", "tool changes still reach a forced prompt");
});

test("a branch with no recorded system state uses the live prompt", () => {
	const session = SessionManager.inMemory("/tmp/project");
	session.appendMessage({ role: "user", content: "first prompt", timestamp: 1 });
	const snapshot = buildInjectionsSnapshot(input(session));

	assert.equal(itemsById(snapshot).get("base-prompt")?.text, "live prompt");
	assert.equal(itemsById(snapshot).get("tool:builtin")?.label, "Built-in Tools (1)");

	const live = input(session, {}, { hiddenTools: ["read"] });
	const hidden = buildInjectionsSnapshot({ ...live, options: { ...live.options, hiddenTools: ["bash"] } });
	assert.equal(itemsById(hidden).get("tool:builtin"), undefined, "the snapshot's hidden tools apply, not the live ones");
	assert.deepEqual(hidden.hiddenTools, ["read"]);
});

test("Injections uses the snapshot's leaf after later edits, branching, and tool changes", () => {
	const { session, entries } = createSession();
	const captured = input(session);
	session.appendContextEdit(entries.custom, { content: "newer content" });
	session.appendMessage({ role: "system", content: "", sections: { cwd: "<cwd>\n/new\n</cwd>" },
		toolsRemoved: [{ name: "read" }], timestamp: 8 });
	session.branch(entries.first);
	session.appendMessage(user("another branch"));
	const snapshot = buildInjectionsSnapshot({ ...captured, entries: session.getEntries() });
	const items = itemsById(snapshot);
	assert.equal(items.get("message:fixture-notes:0")?.text, "stored note");
	assert.equal(items.get("base-prompt:current-dir")?.text, "/tmp/project");
	assert.equal(items.get("tool:builtin")?.label, "Built-in Tools (2)");
});

test("changed section layout comes from replay even with duplicate text, inline tags, or no XML", () => {
	const { session } = createSession();
	const snapshot = buildInjectionsSnapshot(input(session, { system: [
		{ type: "content", text: "same text" },
		{ type: "section", name: "extra", text: "same text" },
		{ type: "section", name: "inline", text: "<inline>inline body</inline>" },
		{ type: "section", name: "empty", text: "" },
		...Object.keys(SECTIONS).filter((name) => name !== "preamble")
			.map((name): SystemChange => ({ type: "section", name, text: null })),
	] }));
	const items = itemsById(snapshot);
	assert.equal(items.get("base-prompt:section:extra")?.text, "same text");
	assert.equal(items.get("base-prompt:section:extra")?.change, "added");
	assert.equal(items.get("base-prompt:section:inline")?.text, "inline body");
	assert.equal(items.get("base-prompt:section:empty")?.change, "added");
	assert.equal(items.get("base-prompt:current-dir")?.change, "deleted");
	assert.equal(items.get("base-prompt:documentation")?.tokens, 0);
	assert.match(items.get("base-prompt:preamble")?.text ?? "", /^same text/);
});

test("a request deleting every prompt section keeps uncounted originals", () => {
	const { session } = createSession();
	const snapshot = buildInjectionsSnapshot(input(session, { system: Object.keys(SECTIONS)
		.map((name): SystemChange => ({ type: "section", name, text: null })) }));
	const prompt = itemsById(snapshot).get("base-prompt");
	assert.equal(prompt?.tokens, 0);
	assert.equal(prompt?.text, "");
	assert.equal(prompt?.children?.length, Object.keys(SECTIONS).length);
	assert.ok(prompt?.children?.every((child) => child.change === "deleted" && child.tokens === 0 && child.chars === 0));
});

test("current customPrompt keeps Dropped markers, distinct from request deletions", () => {
	const session = SessionManager.inMemory("/tmp");
	session.appendMessage({ role: "system", content: "", sections: { preamble: "custom", cwd: SECTIONS.cwd },
		toolsAdded: [READ], timestamp: 1 });
	const snapshot = buildInjectionsSnapshot({ ...input(session), options: { cwd: "/tmp", customPrompt: "custom" } });
	const items = itemsById(snapshot);
	assert.equal(items.get("base-prompt:documentation")?.dropped, true);
	assert.equal(items.get("base-prompt:documentation")?.change, undefined);
});

test("raw session and redacted request images keep their original size markers in previews", () => {
	const { session } = createSession();
	const raw: RequestMessage = { role: "user", timestamp: 9,
		content: [{ type: "image", data: "x".repeat(1_000), mimeType: "image/png" }] };
	const id = session.appendMessage(raw);
	const request: RequestMessage = { ...raw, content: [{ type: "image", data: "<2.0KB omitted>", mimeType: "image/png" }] };
	const snapshot = buildInjectionsSnapshot(input(session, { conversation: [
		{ type: "modified", entryId: id, message: request, attribution: {} },
	] }));
	const changed = itemsById(snapshot).get("change:0");
	assert.match(changed?.sections?.[0]?.text ?? "", /<2.0KB omitted>/);
	assert.match(changed?.sections?.[1]?.text ?? "", /<1000B omitted>/);
	assert.ok(!JSON.stringify(snapshot).includes("x".repeat(1_000)));
	assert.ok(Array.isArray(raw.content));
	assert.ok(raw.content[0]?.type === "image");
	assert.equal(raw.content[0].data.length, 1_000, "the source message is unchanged");
});

/** A complete guard with the given findings. */
function complete(findings: GuardFinding[]): { guard: GuardResult } {
	const dispatch = { provider: "mock", api: "openai-completions", model: "m" };
	return { guard: { status: "complete", dispatch, findings } };
}

test("payload changes form the last group and count only the lines the payload added", () => {
	const { session } = createSession();
	const snapshot = buildInjectionsSnapshot(input(session, {
		conversation: [{ type: "added", message: user("added user text"), attribution: {} }],
	}, complete([
		{ type: "payload-change", change: "added", part: "user", lines: [
			{ type: "added", text: "XYZZY edit line" }, { type: "added", text: "second" },
		] },
		{ type: "payload-change", change: "modified", part: "system", lines: [
			{ type: "removed", text: "old rule" }, { type: "added", text: "new rule!" },
		] },
		{ type: "payload-change", change: "deleted", part: "tool-result", lines: [{ type: "removed", text: "gone" }] },
		{ type: "payload-tool-change", change: "added", name: "edit_tool", lines: [{ type: "added", text: "Edit tool." }] },
		{ type: "payload-tool-change", change: "deleted", name: "bash", lines: [{ type: "removed", text: "Run commands" }] },
	])));

	assert.deepEqual(snapshot.groups.map((group) => group.source.label),
		["pi", "fixture-notes", "unattributed", "payload changes"]);
	assert.equal(itemsById(snapshot).get("tool:builtin:bash")?.change, undefined, "a payload removal does not stay in place");
	const changes = snapshot.groups.at(-1);
	assert.deepEqual(changes?.items.map((item) => [item.label, item.kind, item.tokens, item.change]), [
		["edit_tool", "tool", 3, "added"],
		["bash", "tool", 0, "deleted"],
		["user message", "message", 6, "added"],
		["system message", "message", 3, "modified"],
		["tool result", "message", 0, "deleted"],
	], "tools come first, then messages by size");
	assert.equal(changes?.totalTokens, 12);
	const modified = changes?.items.find((item) => item.change === "modified");
	assert.equal(modified?.text, "new rule!", "the counted text holds only the added lines");
	assert.deepEqual(modified?.changedLines, [
		{ type: "removed", text: "old rule" }, { type: "added", text: "new rule!" },
	]);
	assert.equal(snapshot.totalTokens, snapshot.groups.reduce((sum, group) => sum + group.totalTokens, 0));
});

test("tools Pi hid are left out and their names are retained for the description", () => {
	const { session } = createSession();
	const grep: Tool = { name: "grep", description: "Search files", parameters: { type: "object" } } as Tool;
	const snapshot = buildInjectionsSnapshot(input(session, {
		system: [{ type: "tool", name: "grep", declaration: grep }, { type: "tool", name: "read", declaration: null }],
	}, { ...complete([]), hiddenTools: ["bash", "grep", "unknown"] }));
	const items = itemsById(snapshot);

	assert.equal(items.get("tool:builtin")?.label, "Built-in Tools (0)", "the count names declared tools only");
	assert.deepEqual(items.get("tool:builtin")?.sections?.map((part) => [part.label, part.change, part.tokens]), [
		["read", "deleted", 0],
	], "a deleted tool keeps its row");
	assert.equal(items.get("tool:builtin:bash"), undefined);
	assert.equal(items.get("tool:unattributed:grep"), undefined, "hiding wins over the structured addition");
	assert.deepEqual(snapshot.hiddenTools, ["bash", "grep"], "a hidden name the request did not declare is left out");
	assert.deepEqual(buildInjectionsSnapshot(input(session)).hiddenTools, []);
	assert.ok(snapshot.groups.every((group) => group.source.label !== "payload changes"));
});

test("only compared channels contribute findings; a pending guard has none", () => {
	const { session } = createSession();
	const finding: GuardFinding = {
		type: "payload-change", change: "added", part: "user", lines: [{ type: "added", text: "x" }],
	};
	const partial = buildInjectionsSnapshot(input(session, {}, {
		guard: { status: "incomplete", reason: "Message channel failed.", findings: [finding] },
	}));
	assert.equal(partial.groups.at(-1)?.source.label, "payload changes");
	const pending = buildInjectionsSnapshot(input(session, {}, { guard: { status: "pending" } }));
	assert.ok(pending.groups.every((group) => group.source.label !== "payload changes"));
});

// ============================================================================
// Token diffs
// ============================================================================

const SEARCH: Tool = { name: "search", description: "Search the web", parameters: { type: "object" } } as Tool;
const SEARCH_INFO = {
	...SEARCH, promptGuidelines: ["Use search to verify claims"], sourceInfo: { source: "npm:web", path: "/ext/web" },
} as unknown as ToolInfo;

/** A session whose saved prompt carries an extension tool's lines and two extension sections. */
function createExtensionSession(): SessionManager {
	const session = SessionManager.inMemory("/tmp/project");
	session.appendMessage({
		role: "system",
		content: "",
		sections: {
			...SECTIONS,
			tools: "<tools>\n- read: Read files\n- bash: Run commands\n- search: Search the web\n</tools>",
			rules: "<rules>\n- Use search to verify claims\n</rules>",
			"fixture-review": "<fixture-review>\nReview the changed files.\n</fixture-review>",
			"fixture-obsolete": "<fixture-obsolete>\nAn obsolete note.\n</fixture-obsolete>",
		},
		toolsAdded: [READ, BASH, SEARCH],
		timestamp: 1,
	});
	session.appendMessage({ role: "user", content: "first prompt", timestamp: 2 });
	return session;
}

/** `[label, value, +N, -N]` of an item and each of its children. */
function diffRows(item: InjectionItem | undefined): Array<[string, number, number, number]> {
	return [item, ...(item?.children ?? [])].filter((entry) => entry !== undefined)
		.map((entry) => [entry.label, entry.tokens, entry.diff?.added ?? 0, entry.diff?.removed ?? 0]);
}

test("pi's rows compare with pi's default prompt, so saved and request-only extension text both count", () => {
	const session = createExtensionSession();
	const edit: Tool = { ...READ, description: "Read files, edited" };
	const snapshot = buildInjectionsSnapshot({
		...input(session, { system: [
			{ type: "section", name: "cwd", text: "<cwd>\n/tmp/project\nwith a note\n</cwd>" },
			{ type: "section", name: "docs", text: null },
			{ type: "section", name: "fixture-obsolete", text: null },
			{ type: "section", name: "fixture-added", text: "<fixture-added>\nRequest-only section.\n</fixture-added>" },
			{ type: "tool", name: "read", declaration: edit },
		] }),
		allTools: [...BUILTIN_TOOLS, SEARCH_INFO],
	});
	const items = itemsById(snapshot);

	// Shares round cumulatively, so the search line's 25 characters add 6 tokens to a 10-token default
	assert.deepEqual(diffRows(items.get("base-prompt")), [
		["System Prompt", 48, 28, 11],
		["Preamble", 7, 0, 0],
		["Available Tools", 16, 6, 0],
		["Current Dir", 6, 3, 0],
		["Guidelines", 7, 7, 0],
		["fixture-review", 7, 7, 0],
		["fixture-added", 5, 5, 0],
		["Documentation", 0, 0, 7],
		["fixture-obsolete", 0, 0, 4],
	], "saved extension text counts as added: the tool's lines and its own section");
	assert.equal(items.get("base-prompt:section:fixture-obsolete")?.change, "deleted",
		"a deleted extension section compares with the session, so its deletion stays visible");
	const prompt = items.get("base-prompt");
	assert.deepEqual(prompt?.sections?.map((section) => section.diff), prompt?.children?.map((child) => child.diff),
		"preview subheaders show the rows' diffs");

	assert.deepEqual(diffRows(items.get("tool:builtin")).map(([label, , added, removed]) => [label, added > 0, removed]),
		[["Built-in Tools (2)", true, 0], ["read", true, 0], ["bash", false, 0]]);
	assert.equal(items.get("tool:npm:web:search")?.diff, undefined, "a saved extension tool matches the session");
	const pi = snapshot.groups.find((group) => group.source.label === "pi");
	assert.deepEqual(pi?.diff, {
		added: (prompt?.diff?.added ?? 0) + (items.get("tool:builtin")?.diff?.added ?? 0),
		removed: prompt?.diff?.removed,
	}, "a group sums its items");
	assert.equal(snapshot.groups.find((group) => group.source.label === "web")?.diff, undefined);
});

test("tool and message rows compare with the session; deletions remove the session estimate", () => {
	const { session, entries } = createSession();
	const added: RequestMessage = {
		role: "custom", customType: "fixture-add", content: "added note", display: false, timestamp: 5,
	};
	const grep: Tool = { name: "grep", description: "Search files", parameters: { type: "object" } } as Tool;
	const snapshot = buildInjectionsSnapshot(input(session, {
		conversation: [
			{ type: "added", message: added, attribution: { customType: "fixture-add" } },
			{ type: "modified", entryId: entries.second, message: user("edited second prompt"), attribution: {} },
			{ type: "deleted", entryId: entries.first, attribution: {} },
		],
		system: [{ type: "tool", name: "grep", declaration: grep }, { type: "tool", name: "bash", declaration: null }],
	}));
	const messages = snapshot.groups.flatMap((group) => group.items).filter((item) => item.kind === "message");

	assert.deepEqual(messages.map((item) => [item.label, item.change, item.tokens, item.diff]), [
		["message", undefined, 3, undefined],
		["message", "added", 3, { added: 3, removed: 0 }],
		["user message", "modified", 5, { added: 1, removed: 0 }],
		["user message", "deleted", 0, { added: 0, removed: 3 }],
	], "the modification reconciles with the 4-token session prompt");
	const items = itemsById(snapshot);
	assert.deepEqual(items.get("tool:unattributed:grep")?.diff, { added: items.get("tool:unattributed:grep")?.tokens,
		removed: 0 });
	assert.deepEqual(items.get("tool:builtin:bash")?.diff, { added: 0, removed: 13 });
	assert.deepEqual(snapshot.groups.find((group) => group.source.id === AGGREGATE_SOURCE_ID)?.diff,
		{ added: 1, removed: 3 });
});

test("a payload change compares its added lines with the captured request's removed lines", () => {
	const { session } = createSession();
	const snapshot = buildInjectionsSnapshot(input(session, {}, complete([
		{ type: "payload-change", change: "modified", part: "system", lines: [
			{ type: "removed", text: "old rule" }, { type: "added", text: "new rule!" },
		] },
		{ type: "payload-change", change: "added", part: "user", lines: [{ type: "added", text: "XYZZY edit line" }] },
		{ type: "payload-tool-change", change: "deleted", name: "bash", lines: [{ type: "removed", text: "Run commands" }] },
	])));
	const changes = snapshot.groups.at(-1);

	assert.deepEqual(changes?.items.map((item) => [item.label, item.tokens, item.diff]), [
		["bash", 0, { added: 0, removed: 3 }],
		["user message", 4, { added: 4, removed: 0 }],
		["system message", 3, { added: 2, removed: 1 }],
	]);
	assert.deepEqual(changes?.diff, { added: 6, removed: 4 });
});

test("a forced prompt without sections compares with pi's whole default prompt", () => {
	const session = createExtensionSession();
	const forced = "Forced prompt text.";
	const snapshot = buildInjectionsSnapshot({
		...input(session, {}, { forcedPrompt: forced }), allTools: [...BUILTIN_TOOLS, SEARCH_INFO],
	});
	const prompt = itemsById(snapshot).get("base-prompt");

	assert.equal(prompt?.children, undefined);
	assert.equal(prompt?.change, "forced");
	// Pi's default prompt holds pi's parts without the extension's lines and sections
	const defaultText = [
		"You are a test assistant.", "\n- read: Read files\n- bash: Run commands", "Pi documentation lives here.", "/tmp/project",
	].join("\n");
	assert.deepEqual(prompt?.diff, { added: prompt?.tokens, removed: Math.ceil(defaultText.length / 4) });
});

test("a branch with no recorded system state and the degraded fallback compare with pi's default prompt", () => {
	const session = SessionManager.inMemory("/tmp/project");
	session.appendMessage({ role: "user", content: "first prompt", timestamp: 1 });
	const live = [
		"You are a test assistant.",
		"<tools>\n- read: Read files\n- search: Search the web\n</tools>",
		"<cwd>\n/tmp/project\n</cwd>",
	].join("\n\n");
	const native = {
		systemPrompt: live, options: { cwd: "/tmp/project", toolSnippets: { search: "Search the web" } },
		allTools: [...BUILTIN_TOOLS, SEARCH_INFO], activeToolNames: ["read", "search"],
	};
	const fromBranch = buildInjectionsSnapshot({ ...input(session), ...native });
	const fallback = buildFallbackInjectionsSnapshot(native);

	for (const snapshot of [fromBranch, fallback]) {
		const items = itemsById(snapshot);
		assert.deepEqual(items.get("base-prompt:available-tools")?.diff, { added: 6, removed: 0 });
		assert.equal(items.get("base-prompt:current-dir")?.diff, undefined);
		assert.equal(items.get("tool:npm:web:search")?.diff, undefined);
		assert.deepEqual(snapshot.groups[0]?.diff, { added: 6, removed: 0 });
	}
});
