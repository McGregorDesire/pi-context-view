/**
 * Shared preview body rendering for content that carries labeled parts, e.g. a
 * tool's dropped prompt lines and definition. Both the Injections item preview
 * and the Usage block stream present those parts the same way: a bold
 * subheader with its token share above each part. Pure string logic.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { wrapTextWithAnsi } from "@earendil-works/pi-tui";

import type { InjectedReference, InjectionSection, JsonSpan, RequestChange, TokenDiff } from "../model.ts";
import type { PayloadChangeLine } from "../snapshot.ts";
import { normalizeInlineText, normalizePreviewText } from "../text.ts";
import { shiftJsonSpan } from "./json-preview.ts";
import { BODY_INDENT, calculateViewport, descriptionBlockRows } from "./layout.ts";
import {
	type ContextMarker,
	type DiffBase,
	diffMarker,
	guessMarker,
	markerLegendLines,
	noteBulletLines,
	partMarkers,
	stateMarkers,
} from "./markers.ts";

/**
 * Arrow introducing an extension line's source label. Non-breaking spaces bind
 * the preceding word, arrow, and label into one wrapping unit. Units wider
 * than the content width still hard-wrap, possibly just after the arrow.
 */
const SOURCE_ARROW = "\u00A0<-\u00A0";
/** Keep a normal block's worth of content visible before making room for its explanation. */
const DESCRIPTION_MIN_CONTENT_ROWS = 22;
/** Prefix of a changed line, two columns wide: `+ ` only in the payload, `- ` only in the captured request. */
const ADDED_LINE_PREFIX = "+ ";
const REMOVED_LINE_PREFIX = "- ";

/** Raw preview content plus the labeled parts it decomposes into, when known. */
export interface SectionedContent {
	readonly text: string;
	readonly jsonSpan?: JsonSpan;
	readonly sections?: readonly InjectionSection[];
	readonly injectedReferences?: readonly InjectedReference[];
	/** True when a `--system-prompt` replacement dropped this content; it reads 0 tokens. */
	readonly dropped?: boolean;
	/** True when an extension moved this content out of the region pi renders it into. */
	readonly moved?: boolean;
	/** Request-only change of this content; only `forced` has a marker. */
	readonly change?: RequestChange;
	/** Tokens this content gained and lost against its base; only Injections measures them. */
	readonly diff?: TokenDiff;
	/** True when the request sent other content than the session keeps; only Injections measures it. */
	readonly requestOnly?: boolean;
	/** Changed lines of a payload change; rendered as a diff instead of the text. */
	readonly changedLines?: readonly PayloadChangeLine[];
}

/** Space shared by uncapped preview content, its counter, and the marker legend. */
export interface PreviewDescriptionLayout {
	readonly width: number;
	/** Rows left after the view's fixed frame, before the description and counter. */
	readonly availableRows: number;
	/** Wrapped content rows, including entry headers/separators but never the footer. */
	readonly contentLineCount: number;
}

/**
 * One fixed legend for the markers a preview shows, never part of its raw
 * content, followed by `notes` that explain the shown item further. `diffBase`
 * names what the shown token diffs compare with. Collapse it whole when fewer
 * than `DESCRIPTION_MIN_CONTENT_ROWS` content rows would remain, or when a
 * shorter preview would no longer fit in full. Uncapped line counts keep the
 * collapse decision independent of the Usage cap it helps determine.
 */
export function previewLegendLines(
	theme: Theme,
	contents: readonly SectionedContent[],
	layout: PreviewDescriptionLayout,
	notes: readonly string[] = [],
	diffBase?: DiffBase,
): string[] {
	const markers = previewMarkers(contents);
	if (markers.length === 0 && notes.length === 0) return [];
	const lines = [
		...markerLegendLines(theme, markers, layout.width, diffBase),
		...notes.flatMap((note) => noteBulletLines(theme, note, layout.width)),
	];
	const availableRows = layout.availableRows - descriptionBlockRows(lines);
	const viewport = calculateViewport(layout.contentLineCount, availableRows, 0);
	const floor = Math.min(DESCRIPTION_MIN_CONTENT_ROWS, layout.contentLineCount);
	return availableRows >= floor && viewport.visibleCount >= floor ? lines : [];
}

/**
 * Preview body lines for one item or entry: labeled parts under their
 * subheaders, or the raw text when no breakdown exists. The caller supplies
 * `wrapText` so each view keeps its own sanitizing, wrapping, indentation, and
 * choice of whether the marked JSON run is expanded at this level, and
 * `heading` so an undivided body can drop a line the heading already shows.
 */
export function previewBodyLines(
	theme: Theme,
	content: SectionedContent,
	wrapWidth: number,
	wrapText: (text: string, jsonSpan: JsonSpan | undefined) => string[],
	heading?: string,
): string[] {
	if (content.changedLines !== undefined) return changedLineRows(theme, content.changedLines, wrapWidth);
	const sections = content.sections ?? [];
	if (sections.length === 0) return contentBodyLines(theme, content, wrapWidth, wrapText, heading);
	const lines: string[] = [];
	for (const section of sections) {
		if (lines.length > 0) {
			// Captured trailing whitespace must not add to the subsection separator
			while (lines.length > 0 && normalizeInlineText(lines[lines.length - 1] ?? "") === "") lines.pop();
			lines.push("", "");
		}
		lines.push(...sectionHeaderLines(theme, section, wrapWidth));
		lines.push(...contentBodyLines(theme, section, wrapWidth, wrapText, section.label));
	}
	return lines;
}

/**
 * Changed lines in payload order, each wholly in its diff color after its
 * prefix; wrapped continuation lines hang under the text.
 */
function changedLineRows(theme: Theme, lines: readonly PayloadChangeLine[], wrapWidth: number): string[] {
	return lines.flatMap((line) => {
		const added = line.type === "added";
		const prefix = added ? ADDED_LINE_PREFIX : REMOVED_LINE_PREFIX;
		const color = added ? "toolDiffAdded" : "toolDiffRemoved";
		// A lone carriage return would otherwise become a line break of its own
		const text = normalizePreviewText(line.text).replaceAll("\n", " ");
		const hanging = " ".repeat(prefix.length);
		const wrapped = wrapTextWithAnsi(text, Math.max(1, wrapWidth - prefix.length));
		return (wrapped.length === 0 ? [""] : wrapped).map((part, index) => index === 0
			? `${BODY_INDENT}${theme.fg(color, `${prefix}${part}`)}`
			: `${BODY_INDENT}${hanging}${theme.fg(color, part)}`);
	});
}

/**
 * Markers one preview renders: extension lines and their inferred owners come
 * from reference metadata, while state markers follow the subheaders and
 * metadata rows that show them, whether or not that part carries references.
 */
function previewMarkers(contents: readonly SectionedContent[]): ContextMarker[] {
	const referenced = contents.flatMap((content) => referenceParts(content)).filter(hasInjectedReferences);
	const marked = contents.flatMap((content) => [content, ...(content.sections ?? [])]);
	const markers: ContextMarker[] = [];
	if (referenced.length > 0) markers.push("highlighted");
	if (referenced.some(hasGuessedReferences) || marked.some(isGuessedPart)) markers.push("guess");
	// The legend orders and deduplicates markers itself
	markers.push(...marked.flatMap(partMarkers));
	return markers;
}

/** Only metadata on rendered body parts triggers the footer, never a text or label match. */
function hasInjectedReferences(part: SectionedContent): boolean {
	return (part.injectedReferences?.length ?? 0) > 0;
}

/** Whether a rendered reference names an inferred owner needing the extra caveat. */
function hasGuessedReferences(part: SectionedContent): boolean {
	return part.injectedReferences?.some((reference) => reference.attribution === "guess") === true;
}

/** Whether a part's diff belongs to an owner inferred from the text itself, marked on its subheader. */
function isGuessedPart(part: SectionedContent | InjectionSection): boolean {
	return "attribution" in part && part.attribution === "guess";
}

/** Body parts carrying reference metadata: the item's sections, or the item itself. */
function referenceParts(content: SectionedContent): readonly SectionedContent[] {
	return content.sections?.length ? content.sections : [content];
}

/** Render annotated extension lines locally; other content keeps the caller's JSON/skill transformations. */
function contentBodyLines(
	theme: Theme,
	content: SectionedContent,
	wrapWidth: number,
	wrapText: (text: string, jsonSpan: JsonSpan | undefined) => string[],
	heading: string | undefined,
): string[] {
	const references = content.injectedReferences ?? [];
	if (references.length === 0) return bodyLines(content.text, content.jsonSpan, heading, wrapText);
	let text = "";
	let offset = 0;
	for (const reference of references) {
		text += normalizePreviewText(content.text.slice(offset, reference.start));
		const captured = content.text.slice(reference.start, reference.end);
		// A part that opens with an extension line drops its captured lead, as plain text does.
		const line = text.trim().length === 0 ? captured.replace(/^\n+/, "") : captured;
		text += theme.fg("syntaxNumber", normalizePreviewText(line));
		text += theme.fg("borderMuted", SOURCE_ARROW);
		text += theme.fg("mdLink", normalizeInlineText(reference.source.label));
		if (reference.tool !== undefined) {
			text += theme.fg("mdLinkUrl", `:${normalizeInlineText(reference.tool)}`);
		}
		if (reference.attribution === "guess") text += guessMarker(theme);
		offset = reference.end;
	}
	text += normalizePreviewText(content.text.slice(offset));
	const body = withoutRepeatedHeading(text.replace(/^\n+/, ""), heading);
	return wrapTextWithAnsi(body, wrapWidth)
		.map((line) => line === "" ? "" : `${BODY_INDENT}${line}`);
}

/**
 * One body part, wrapped after dropping the lead its heading already carries:
 * the newline that separated a prompt line, and a first line repeating
 * the heading itself, as a skill block opens with its own name.
 */
function bodyLines(
	text: string,
	jsonSpan: JsonSpan | undefined,
	heading: string | undefined,
	wrapText: (text: string, jsonSpan: JsonSpan | undefined) => string[],
): string[] {
	const body = withoutRepeatedHeading(text.replace(/^\n+/, ""), heading);
	return wrapText(body, shiftJsonSpan(jsonSpan, text.length - body.length));
}

/**
 * Text without a first line that only repeats the heading rendered above it.
 * The dropped line stays part of the estimate; it is redundant on screen only.
 */
function withoutRepeatedHeading(text: string, heading: string | undefined): string {
	if (heading === undefined) return text;
	const lineEnd = text.indexOf("\n");
	if (lineEnd === -1 || headingKey(text.slice(0, lineEnd)) !== headingKey(heading)) return text;
	return text.slice(lineEnd + 1);
}

/**
 * Comparable form of a heading or a first content line: case and a trailing
 * colon carry no information here, so pi's own block headers ("Available
 * tools:", "Guidelines:") read as repeats of the part labels above them.
 */
function headingKey(text: string): string {
	return text.trim().replace(/:$/, "").toLowerCase();
}

/**
 * Bold subheader naming one part, its share of the parent estimate, its token
 * diff, a guessed owner, and its markers. A diff-only part has no share.
 * Parts use `syntaxKeyword` rather than the usual `mdHeading` subheader color,
 * because they nest under item and entry headings that already carry `mdHeading`.
 */
function sectionHeaderLines(theme: Theme, section: InjectionSection, wrapWidth: number): string[] {
	const label = theme.fg("syntaxKeyword", theme.bold(normalizeInlineText(section.label)));
	const tokens = section.diffOnly === true
		? ""
		: theme.fg("muted", ` · ${section.tokens.toLocaleString("en-US")} tokens`);
	const guess = section.attribution === "guess" ? guessMarker(theme) : "";
	const header = `${label}${tokens}${diffMarker(theme, section.diff)}${guess}${stateMarkers(theme, section)}`;
	return wrapTextWithAnsi(header, wrapWidth).map((line) => `${BODY_INDENT}${line}`);
}
