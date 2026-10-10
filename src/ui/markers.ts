/**
 * State markers rendered after a token estimate, token diffs, and the bullet
 * legend that explains the ones a frame shows. Markers name how pi accounts
 * for a part rather than a usage category, so their colors are fixed instead
 * of configurable. Pure string logic shared by both views.
 */
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { wrapTextWithAnsi } from "@earendil-works/pi-tui";

import type { RequestChange, TokenDiff } from "../model.ts";
import { BODY_INDENT, fitLine } from "./layout.ts";

/** Dim separator introducing a state marker after the estimate it explains. */
const MARKER_SEPARATOR = " · ";

/** Markers a frame can show, in the fixed order their legend bullets render. */
const MARKER_ORDER = [
	"highlighted", "guess", "dropped", "moved", "forced", "diff", "added", "modified", "deleted",
] as const;

/** One marked state a description bullet explains; `diff` stands for `+N`/`-N` token diffs. */
export type ContextMarker = (typeof MARKER_ORDER)[number];

/**
 * What the token diffs of a preview compare with:
 *   default-prompt     pi's default prompt, for contributions under pi
 *   session            the session, for extension tools and messages
 *   captured-request   the captured request, for payload changes
 */
export type DiffBase = "default-prompt" | "session" | "captured-request";

/** Diff legend sentence by base; the list compares rows with different bases, so it names none. */
const DIFF_EXPLANATIONS: Record<DiffBase | "list", string> = {
	list: " Tokens extensions added or removed.",
	"default-prompt": " Tokens extensions added or removed, compared with pi’s default prompt.",
	session: " Tokens extensions added or removed, compared with the session.",
	"captured-request": " Tokens added or removed, compared with the captured request.",
};

/** Bullet marker and hanging indent of a legend entry, both two columns wide. */
const BULLET_MARKER = "- ";
const BULLET_INDENT = `${BODY_INDENT}  `;

/** Keyword opening a legend bullet, its fixed color, and the sentence it heads. */
interface MarkerLegend {
	readonly keyword: string;
	readonly color: ThemeColor;
	readonly explanation: string;
}

/** One fixed sentence per marker: each states its own accounting, independent of the others. */
const MARKER_LEGENDS: Record<Exclude<ContextMarker, "diff">, MarkerLegend> = {
	highlighted: {
		keyword: "Highlighted",
		// Extension lines carry this color, so the bullet opens in it too.
		color: "syntaxNumber",
		explanation: " parts are injected by extensions into pi’s system prompt. They are counted in the" +
			" System Prompt token count.",
	},
	guess: {
		keyword: "(guess)",
		color: "dim",
		explanation: " sources are inferred from the injected text itself.",
	},
	dropped: {
		keyword: "Dropped",
		color: "toolDiffRemoved",
		explanation: " parts were replaced by a custom system prompt and are counted nowhere.",
	},
	moved: {
		keyword: "Moved",
		color: "warning",
		explanation: " blocks appear in a different position in the system prompt than usual." +
			" Their token counts are unchanged.",
	},
	forced: {
		keyword: "Forced",
		color: "warning",
		explanation: " prompts replace pi’s system prompt for this request.",
	},
	added: {
		keyword: "Added",
		color: "toolDiffAdded",
		explanation: " parts exist only in this request: an extension added them, and the session does not" +
			" keep them. They are counted.",
	},
	modified: {
		keyword: "Modified",
		color: "warning",
		explanation: " parts were changed by an extension for this request only; the session keeps the" +
			" original. The request version is counted.",
	},
	deleted: {
		keyword: "Deleted",
		color: "toolDiffRemoved",
		explanation: " parts were removed by an extension for this request only; the session keeps them." +
			" They are counted nowhere.",
	},
};

/** Themed marker naming content pi never sent, for a preview subheader or a hierarchy row. */
export function droppedMarker(theme: Theme): string {
	return stateMarker(theme, MARKER_LEGENDS.dropped);
}

/** Themed marker naming content pi sends from elsewhere in the prompt than it wrote it. */
export function movedMarker(theme: Theme): string {
	return stateMarker(theme, MARKER_LEGENDS.moved);
}

/** `+N` with thousands separators; the plain text of a diff column. */
export function formatDiffAdded(tokens: number): string {
	return `+${tokens.toLocaleString("en-US")}`;
}

/** `-N` with thousands separators; the plain text of a diff column. */
export function formatDiffRemoved(tokens: number): string {
	return `-${tokens.toLocaleString("en-US")}`;
}

/**
 * A token diff after an estimate in preview metadata, behind a dim separator:
 * `+N` in `toolDiffAdded` and `-N` in `toolDiffRemoved`, leaving out a zero
 * side. Empty without a diff.
 */
export function diffMarker(theme: Theme, diff: TokenDiff | undefined): string {
	const sides: string[] = [];
	if (diff !== undefined && diff.added > 0) sides.push(theme.fg("toolDiffAdded", formatDiffAdded(diff.added)));
	if (diff !== undefined && diff.removed > 0) sides.push(theme.fg("toolDiffRemoved", formatDiffRemoved(diff.removed)));
	return sides.length === 0 ? "" : `${theme.fg("dim", MARKER_SEPARATOR)}${sides.join(" ")}`;
}

/** Themed marker naming how a request-only change touched a part. */
export function changeMarker(theme: Theme, change: RequestChange): string {
	return stateMarker(theme, MARKER_LEGENDS[change]);
}

/**
 * Every state marker of one part, in legend order: dropped, moved, then its
 * request-only change. Empty when the part carries none.
 */
export function stateMarkers(
	theme: Theme,
	part: { readonly dropped?: boolean; readonly moved?: boolean; readonly change?: RequestChange },
): string {
	let markers = part.dropped === true ? droppedMarker(theme) : part.moved === true ? movedMarker(theme) : "";
	if (part.change !== undefined) markers += changeMarker(theme, part.change);
	return markers;
}

/** Markers one part carries, including its token diff, for the legend of the frame showing it. */
export function partMarkers(
	part: {
		readonly dropped?: boolean;
		readonly moved?: boolean;
		readonly change?: RequestChange;
		readonly diff?: TokenDiff;
	},
): ContextMarker[] {
	const markers: ContextMarker[] = [];
	if (part.dropped === true) markers.push("dropped");
	if (part.moved === true) markers.push("moved");
	if (part.change !== undefined) markers.push(part.change);
	if (part.diff !== undefined && (part.diff.added > 0 || part.diff.removed > 0)) markers.push("diff");
	return markers;
}

/** Themed suffix naming an owner this extension inferred rather than one pi reported. */
export function guessMarker(theme: Theme): string {
	const { color, keyword } = MARKER_LEGENDS.guess;
	return theme.fg(color, ` ${keyword}`);
}

/**
 * Description bullets explaining the markers one frame shows, in fixed order
 * and without duplicates. Callers pass only the markers actually visible there,
 * so a view never explains a state it does not render. `diffBase` names what
 * the frame's token diffs compare with; the list leaves it out.
 */
export function markerLegendLines(
	theme: Theme,
	markers: Iterable<ContextMarker>,
	width: number,
	diffBase?: DiffBase,
): string[] {
	const shown = new Set(markers);
	return MARKER_ORDER.filter((marker) => shown.has(marker)).flatMap((marker) => {
		if (marker === "diff") {
			const keyword = `${theme.fg("toolDiffAdded", "+N")} ${theme.fg("toolDiffRemoved", "-N")}`;
			return bulletLines(theme, keyword, DIFF_EXPLANATIONS[diffBase ?? "list"], width);
		}
		const legend = MARKER_LEGENDS[marker];
		return bulletLines(theme, theme.fg(legend.color, legend.keyword), legend.explanation, width);
	});
}

/** One dim description bullet with a hanging indent, for a note that is not a marker legend. */
export function noteBulletLines(theme: Theme, text: string, width: number): string[] {
	return bulletLines(theme, "", text, width);
}

/** Dim separator plus the keyword in the one fixed color its legend bullet also opens with. */
function stateMarker(theme: Theme, legend: MarkerLegend): string {
	return `${theme.fg("dim", MARKER_SEPARATOR)}${theme.fg(legend.color, legend.keyword)}`;
}

/** One bullet: dim marker, styled keyword in the colors it explains, dim sentence, hanging indent. */
function bulletLines(theme: Theme, keyword: string, explanation: string, width: number): string[] {
	const text = `${keyword}${theme.fg("dim", explanation)}`;
	const wrapped = wrapTextWithAnsi(text, Math.max(1, width - BULLET_INDENT.length));
	const lead = `${BODY_INDENT}${theme.fg("dim", BULLET_MARKER)}`;
	return wrapped.map((line, index) => fitLine(`${index === 0 ? lead : BULLET_INDENT}${line}`, width));
}
