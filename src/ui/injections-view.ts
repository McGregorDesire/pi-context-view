/**
 * Focused `/context injections` view: hierarchical rows of the latest request
 * snapshot. The Runtime label stays hidden until the runtime-inspection roadmap step.
 */
import type { ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

import {
	type InjectionItem,
	type InjectionSnapshot,
	PAYLOAD_CHANGES_SOURCE_ID,
	type RequestChange,
	type TokenDiff,
} from "../model.ts";
import type { GuardResult } from "../snapshot.ts";
import { normalizeInlineText, normalizePreviewText } from "../text.ts";
import {
	buildInjectionRows,
	collectItemsById,
	type InjectionRow,
	ListNavigator,
	PreviewScroller,
} from "./injections-model.ts";
import { expandJsonSpan } from "./json-preview.ts";
import {
	BODY_INDENT,
	calculateViewport,
	DEFAULT_TERMINAL_ROWS,
	descriptionBlockRows,
	fitLine,
	fitToTerminalHeight,
	hintRow,
	isPageBackKey,
	isPageForwardKey,
	isStepBackKey,
	isStepForwardKey,
	normalizeTerminalRows,
	spreadLine,
	STEP_KEY_HINT,
	wrapDescriptionLines,
} from "./layout.ts";
import {
	type ContextMarker,
	type DiffBase,
	diffMarker,
	formatDiffAdded,
	formatDiffRemoved,
	markerLegendLines,
	noteBulletLines,
	partMarkers,
	stateMarkers,
} from "./markers.ts";
import { previewBodyLines, previewLegendLines } from "./section-preview.ts";
import { DEFAULT_WHEEL_SCROLL_LINES, parseWheelDirection, readWheelScrollLines } from "./wheel.ts";

/**
 * List frame rows excluding the collapsible description: both borders and their
 * blank rows, one header row, and the hint row above its own blank row.
 */
const LIST_FIXED_LINE_COUNT = 8;
const PREVIEW_FIXED_LINE_COUNT = 8;
const LIST_DESCRIPTION = "Injections into the model context of the latest request, with token estimates.";
const PAYLOAD_CHANGES_NOTE = "Payload changes appear only in the provider payload. Their sources are unknown.";
/** List rows that must stay visible for the description to keep its own rows. */
const LIST_DESCRIPTION_MIN_ROWS = 26;
const CURSOR_COLUMN_WIDTH = 2;
const MAX_TOKEN_VALUE_COLUMN = 54;
const TOKEN_LEADER_GAP = 4;
/** Spaces before each diff column, after the value column. */
const DIFF_COLUMN_GAP = 2;

/** Everything the Injections view renders. */
export interface InjectionsViewInput {
	readonly snapshot: InjectionSnapshot;
	readonly degradedReason?: string;
	/** True when a silent probe captured the request, not a real turn. */
	readonly probe?: boolean;
	/** Payload comparison of the request; absent for the degraded fallback, which has no request. */
	readonly guard?: GuardResult;
}

/** Shared token-value and diff columns measured after the fixed cursor column. */
interface InjectionColumns {
	readonly value: number;
	/** Width of the largest formatted estimate in the whole tree, including TOTAL. */
	readonly valueWidth: number;
	/** Width of the widest `+N` in the whole tree; 0 when no row adds tokens. */
	readonly addedWidth: number;
	/** Width of the widest `-N` in the whole tree; 0 when no row removes tokens. */
	readonly removedWidth: number;
}

/** Open the Injections view as a fullscreen overlay. */
export async function showInjectionsView(
	context: ExtensionCommandContext,
	input: InjectionsViewInput,
): Promise<void> {
	await context.ui.custom<void>(
		(tui, theme, _keybindings, done) => {
			const view = new InjectionsView(theme, input, done, () => tui.terminal.rows, readWheelScrollLines(tui));
			return {
				render: (width: number) => view.render(width),
				invalidate: () => view.invalidate(),
				handleInput: (data: string) => {
					view.handleInput(data);
					tui.requestRender();
				},
			};
		},
		{
			overlay: true,
			overlayOptions: { width: "100%", maxHeight: "100%", margin: 0 },
		},
	);
}

/** Exported for direct render/input tests; use showInjectionsView from pi code. */
export class InjectionsView {
	private readonly theme: Theme;
	private readonly input: InjectionsViewInput;
	private readonly done: (result: undefined) => void;
	private readonly getTerminalRows: () => number;
	private readonly wheelScrollLines: number;
	private readonly rows: InjectionRow[];
	private readonly navigator: ListNavigator;
	private readonly itemsById: Map<string, InjectionItem>;
	private readonly previewScroller = new PreviewScroller();
	private previewItem: InjectionItem | undefined;
	private previewLines: string[] | undefined;
	private previewWrapWidth: number | undefined;
	private cachedWidth: number | undefined;
	private cachedTerminalRows: number | undefined;
	private cachedLines: string[] | undefined;

	public constructor(
		theme: Theme,
		input: InjectionsViewInput,
		done: (result: undefined) => void,
		getTerminalRows: () => number = () => process.stdout.rows ?? DEFAULT_TERMINAL_ROWS,
		wheelScrollLines: number = DEFAULT_WHEEL_SCROLL_LINES,
	) {
		this.theme = theme;
		this.input = input;
		this.done = done;
		this.getTerminalRows = getTerminalRows;
		this.wheelScrollLines = wheelScrollLines;
		this.rows = buildInjectionRows(input.snapshot);
		this.navigator = new ListNavigator(this.rows.length, 1, this.rows.length - 2);
		this.itemsById = collectItemsById(input.snapshot);
	}

	public handleInput(data: string): void {
		if (this.previewItem !== undefined) {
			this.handlePreviewInput(data);
			return;
		}
		if (matchesKey(data, Key.escape) || data === "q") {
			this.done(undefined);
			return;
		}
		// One notch moves the selection one row, like a single step key.
		const wheel = parseWheelDirection(data);
		if (wheel !== undefined) {
			if (this.navigator.moveBy(wheel)) this.clearCache();
			return;
		}
		if (matchesKey(data, Key.enter)) {
			this.openPreview();
		} else if (isStepBackKey(data)) {
			if (this.navigator.moveBy(-1)) this.clearCache();
		} else if (isStepForwardKey(data)) {
			if (this.navigator.moveBy(1)) this.clearCache();
		} else if (isPageBackKey(data)) {
			if (this.navigator.page(-1)) this.clearCache();
		} else if (isPageForwardKey(data)) {
			if (this.navigator.page(1)) this.clearCache();
		} else if (matchesKey(data, Key.home)) {
			if (this.navigator.moveTo(0)) this.clearCache();
		} else if (matchesKey(data, Key.end)) {
			if (this.navigator.moveTo(this.rows.length - 1)) this.clearCache();
		}
	}

	public render(width: number): string[] {
		const terminalRows = normalizeTerminalRows(this.getTerminalRows());
		if (
			this.cachedLines !== undefined &&
			this.cachedWidth === width &&
			this.cachedTerminalRows === terminalRows
		) {
			return this.cachedLines;
		}
		if (this.previewItem !== undefined) {
			const lines = this.renderPreview(width, terminalRows, this.previewItem);
			this.cachedWidth = width;
			this.cachedTerminalRows = terminalRows;
			this.cachedLines = lines;
			return lines;
		}
		const theme = this.theme;
		const border = theme.fg("border", "─".repeat(Math.max(1, width)));
		const headerLines = this.headerLines(width);
		const warningLines = this.degradedWarningLines(width);
		const availableRows = Math.max(
			1,
			terminalRows - LIST_FIXED_LINE_COUNT - (headerLines.length - 1) - warningLines.length,
		);
		const descriptionLines = this.fittedDescriptionLines(width, availableRows);
		const extraLineCount = headerLines.length - 1 + warningLines.length + descriptionBlockRows(descriptionLines);
		const viewport = calculateViewport(this.rows.length, terminalRows, LIST_FIXED_LINE_COUNT, extraLineCount);
		this.navigator.setVisibleCount(viewport.visibleCount);
		const lines: string[] = [border, "", ...headerLines, "", ...warningLines];
		const listLines = this.listLines(width);
		lines.push(...listLines);
		if (viewport.showScroll) lines.push(this.scrollLine(width));
		const paddingCount = viewport.visibleCount - listLines.length;
		for (let pad = 0; pad < paddingCount; pad++) lines.push("");
		if (descriptionLines.length > 0) lines.push("", ...descriptionLines);
		lines.push("");
		lines.push(
			this.fit(
				hintRow(this.theme, [
					[STEP_KEY_HINT, "Navigate"],
					["Enter", "Preview"],
					["Esc", "Close"],
				]),
				width,
			),
		);
		lines.push("", border);

		const fittedLines = fitToTerminalHeight(lines, terminalRows, border);
		this.cachedWidth = width;
		this.cachedTerminalRows = terminalRows;
		this.cachedLines = fittedLines;
		return fittedLines;
	}

	public invalidate(): void {
		this.clearPreviewContent();
		this.clearCache();
	}

	// === Preview mode ===

	private handlePreviewInput(data: string): void {
		if (matchesKey(data, Key.escape) || data === "q") {
			this.closePreview();
			return;
		}
		const wheel = parseWheelDirection(data);
		if (wheel !== undefined) {
			if (this.previewScroller.scrollBy(wheel * this.wheelScrollLines)) this.clearCache();
			return;
		}
		if (isStepBackKey(data)) {
			if (this.previewScroller.scrollBy(-1)) this.clearCache();
		} else if (isStepForwardKey(data)) {
			if (this.previewScroller.scrollBy(1)) this.clearCache();
		} else if (isPageBackKey(data)) {
			if (this.previewScroller.page(-1)) this.clearCache();
		} else if (isPageForwardKey(data)) {
			if (this.previewScroller.page(1)) this.clearCache();
		} else if (matchesKey(data, Key.home)) {
			if (this.previewScroller.scrollTo(0)) this.clearCache();
		} else if (matchesKey(data, Key.end)) {
			if (this.previewScroller.scrollTo(this.previewScroller.maxOffset)) this.clearCache();
		}
	}

	private openPreview(): void {
		const row = this.rows[this.navigator.selected];
		if (row?.kind !== "item") return;
		const item = this.itemsById.get(row.itemId);
		if (item === undefined) return;
		this.previewItem = item;
		this.clearPreviewContent();
		this.previewScroller.reset();
		this.clearCache();
	}

	private closePreview(): void {
		this.previewItem = undefined;
		this.clearPreviewContent();
		this.clearCache();
	}

	/** Drop width- and theme-dependent preview rendering. */
	private clearPreviewContent(): void {
		this.previewLines = undefined;
		this.previewWrapWidth = undefined;
	}

	private renderPreview(width: number, terminalRows: number, item: InjectionItem): string[] {
		const theme = this.theme;
		const border = theme.fg("border", "─".repeat(Math.max(1, width)));
		const wrapped = this.getPreviewLines(width, item);
		const descriptionLines = previewLegendLines(theme, [item], {
			width,
			availableRows: terminalRows - PREVIEW_FIXED_LINE_COUNT,
			contentLineCount: wrapped.length,
		}, findingNotes([item, ...(item.children ?? [])]), previewDiffBase(item));
		const viewport = calculateViewport(
			wrapped.length, terminalRows, PREVIEW_FIXED_LINE_COUNT, descriptionBlockRows(descriptionLines),
		);
		this.previewScroller.setExtent(wrapped.length, viewport.visibleCount);

		const lines: string[] = [border, ""];
		const title = theme.fg("accent", theme.bold(normalizeInlineText(item.label)));
		const source = normalizeInlineText(item.source.label);
		const meta = theme.fg("muted", `${source} · ${item.tokens.toLocaleString("en-US")} tokens`);
		const diff = diffMarker(theme, item.diff);
		const marker = stateMarkers(theme, { moved: item.moved, change: item.change });
		// Drop the marker first when space runs out, then the diff
		const headerWidth = visibleWidth(title) + visibleWidth(meta) + 2;
		const fitsDiff = headerWidth + visibleWidth(diff) <= width;
		const fitsMarker = fitsDiff && headerWidth + visibleWidth(diff) + visibleWidth(marker) <= width;
		lines.push(this.spread(title, `${meta}${fitsDiff ? diff : ""}${fitsMarker ? marker : ""} `, width));
		lines.push("");

		const start = this.previewScroller.offset;
		for (let index = start; index < start + viewport.visibleCount; index++) {
			lines.push(wrapped[index] ?? "");
		}

		if (viewport.showScroll) lines.push(this.previewScrollLine(width, wrapped.length));
		if (descriptionLines.length > 0) lines.push("", ...descriptionLines);
		lines.push("");
		lines.push(
			this.fit(
				hintRow(this.theme, [
					[STEP_KEY_HINT, "Scroll"],
					["PgUp/PgDn", "Page"],
					["Esc", "Back"],
				]),
				width,
			),
		);
		lines.push("", border);
		return fitToTerminalHeight(lines, terminalRows, border);
	}

	private getPreviewLines(width: number, item: InjectionItem): string[] {
		const wrapWidth = Math.max(10, width - BODY_INDENT.length - 1);
		if (this.previewLines !== undefined && this.previewWrapWidth === wrapWidth) return this.previewLines;
		// The item preview is the full-content level, so marked JSON expands here.
		const lines = previewBodyLines(
			this.theme,
			item,
			wrapWidth,
			(text, jsonSpan) => this.wrappedTextLines(expandJsonSpan(text, jsonSpan), wrapWidth),
			item.label,
		);
		this.previewLines = lines;
		this.previewWrapWidth = wrapWidth;
		return lines;
	}

	/** Wrap sanitized text into indented preview lines, keeping blank lines. */
	private wrappedTextLines(text: string, wrapWidth: number): string[] {
		const lines: string[] = [];
		for (const paragraph of normalizePreviewText(text).split("\n")) {
			const wrapped = wrapTextWithAnsi(paragraph, wrapWidth);
			if (wrapped.length === 0) {
				lines.push("");
				continue;
			}
			for (const line of wrapped) lines.push(`${BODY_INDENT}${line}`);
		}
		return lines;
	}

	private previewScrollLine(width: number, totalLines: number): string {
		if (!this.previewScroller.hasOverflow) return this.fit("", width);
		return this.fit(
			this.theme.fg("dim", `${BODY_INDENT}(${this.previewScroller.visibleEnd}/${totalLines})`),
			width,
		);
	}

	/** Keep title/label together when possible; give the narrow label its own breathing room. */
	private headerLines(width: number): string[] {
		const theme = this.theme;
		const title = theme.fg("accent", theme.bold("Context Injections"));
		const separator = theme.fg("dim", " · ");
		// Runtime remains unimplemented, so only the Latest Request label is shown.
		const tabs = theme.fg("mdHeading", theme.bold("[Latest Request]"));
		const combined = `${title}${separator}${tabs}`;
		if (visibleWidth(combined) <= width) return [this.fit(combined, width)];
		return [this.fit(title, width), "", this.fit(tabs, width)];
	}

	/** Render the current hierarchy viewport against one stable, nearby value column. */
	private listLines(width: number): string[] {
		const theme = this.theme;
		const lines: string[] = [];
		const contentWidth = Math.max(1, width - CURSOR_COLUMN_WIDTH);
		const columns = this.injectionColumns(contentWidth);
		const start = this.navigator.offset;
		const end = start + this.navigator.windowSize;
		for (let index = start; index < end; index++) {
			const row = this.rows[index];
			if (row === undefined) break;
			if (row.kind === "separator") {
				lines.push("");
				continue;
			}
			const selected = row.kind !== "total" && index === this.navigator.selected;
			const cursor = selected ? theme.fg("accent", "→ ") : BODY_INDENT;
			const content = this.injectionLine(row, columns, contentWidth, selected);
			lines.push(this.fit(`${cursor}${content}`, width));
		}
		return lines;
	}

	/**
	 * Choose the earliest useful shared value column, capped on wide terminals,
	 * and size the diff columns from the widest `+N` and `-N` in the whole tree.
	 */
	private injectionColumns(width: number): InjectionColumns {
		const contentRows = this.rows.filter((row) => row.kind !== "separator");
		const labelWidth = Math.max(1, ...contentRows.map((row) => visibleWidth(this.plainRowLabel(row))));
		const tokenWidth = Math.max(
			1,
			...contentRows.map((row) => row.tokens.toLocaleString("en-US").length),
		);
		const diffs = contentRows.map(rowDiff);
		const idealValue = Math.min(MAX_TOKEN_VALUE_COLUMN, labelWidth + TOKEN_LEADER_GAP);
		return {
			value: Math.max(1, Math.min(idealValue, width - tokenWidth)),
			valueWidth: tokenWidth,
			addedWidth: Math.max(0, ...diffs.map((diff) => diff !== undefined && diff.added > 0
				? formatDiffAdded(diff.added).length : 0)),
			removedWidth: Math.max(0, ...diffs.map((diff) => diff !== undefined && diff.removed > 0
				? formatDiffRemoved(diff.removed).length : 0)),
		};
	}

	/**
	 * One hierarchy row with dim leaders and a full token estimate when width
	 * permits, then its diff columns and state markers. Narrow widths drop the
	 * diff columns whole for every row, and a marker that does not fit.
	 */
	private injectionLine(
		row: Exclude<InjectionRow, { readonly kind: "separator" }>,
		columns: InjectionColumns,
		width: number,
		selected: boolean,
	): string {
		const labelWidth = Math.max(1, columns.value - 1);
		const left = fitLine(this.styledRowLabel(row, selected, labelWidth), labelWidth);
		const leader = this.tokenLeader(columns.value - visibleWidth(left));
		const value = row.tokens.toLocaleString("en-US").padStart(columns.valueWidth);
		const tokens = row.kind === "total"
			? this.theme.bold(this.theme.fg("text", value))
			: this.theme.fg(selected ? "accent" : "muted", value);
		const marker = this.rowMarker(row);
		const diff = rowDiff(row);
		let lineWidth = columns.value + value.length;
		let diffs = "";
		const diffWidth = diffColumnsWidth(columns);
		// Blank diff columns only keep a following marker aligned
		if (diffWidth > 0 && lineWidth + diffWidth <= width && (diff !== undefined || marker.length > 0)) {
			diffs = this.diffColumns(diff, columns, marker.length > 0);
			lineWidth += diffWidth;
		}
		const fittedMarker = lineWidth + visibleWidth(marker) <= width ? marker : "";
		return fitLine(`${left}${leader}${tokens}${diffs}${fittedMarker}`, width);
	}

	/**
	 * `+N` and `-N` right-aligned in their tree-wide columns. A blank column is
	 * padded only when `followed` by a marker, so no row ends in spaces.
	 */
	private diffColumns(diff: TokenDiff | undefined, columns: InjectionColumns, followed: boolean): string {
		const added = diff !== undefined && diff.added > 0 ? formatDiffAdded(diff.added) : "";
		const removed = diff !== undefined && diff.removed > 0 ? formatDiffRemoved(diff.removed) : "";
		let text = "";
		if (columns.addedWidth > 0 && (added.length > 0 || removed.length > 0 || followed)) {
			text += " ".repeat(DIFF_COLUMN_GAP + columns.addedWidth - added.length);
			if (added.length > 0) text += this.theme.fg("toolDiffAdded", added);
		}
		if (columns.removedWidth > 0 && (removed.length > 0 || followed)) {
			text += " ".repeat(DIFF_COLUMN_GAP + columns.removedWidth - removed.length);
			if (removed.length > 0) text += this.theme.fg("toolDiffRemoved", removed);
		}
		return text;
	}

	/**
	 * State markers after the estimate and diff columns: `Dropped`, `Moved`, and
	 * `Forced`. The diff columns replace the other request-only change markers.
	 */
	private rowMarker(row: Exclude<InjectionRow, { readonly kind: "separator" }>): string {
		return row.kind === "item" ? stateMarkers(this.theme, listMarkedState(row)) : "";
	}

	/** Fill a label/value gap with dim dots, retaining spaces at both ends. */
	private tokenLeader(width: number): string {
		if (width < 3) return " ".repeat(Math.max(0, width));
		return ` ${this.theme.fg("dim", ".".repeat(width - 2))} `;
	}

	/** Unstyled hierarchy label used to keep the value column stable while scrolling. */
	private plainRowLabel(row: Exclude<InjectionRow, { readonly kind: "separator" }>): string {
		const label = normalizeInlineText(row.label);
		return row.kind === "item" ? `${this.treePrefix(row)}${label}` : label;
	}

	/** Themed hierarchy label with connectors intentionally dim even on selection. */
	private styledRowLabel(
		row: Exclude<InjectionRow, { readonly kind: "separator" }>,
		selected: boolean,
		width: number,
	): string {
		const theme = this.theme;
		let label = normalizeInlineText(row.label);
		if (row.kind === "group" || row.kind === "total") {
			return theme.bold(theme.fg(selected ? "accent" : "text", label));
		}
		const prefix = theme.fg("dim", this.treePrefix(row));
		const item = this.itemsById.get(row.itemId);
		if (item?.kind === "context-file" && item.children === undefined) {
			label = shortenInstructionPath(label, Math.max(0, width - visibleWidth(prefix)));
		}
		const color = selected ? "accent" : row.depth === 1 ? "muted" : "dim";
		return `${prefix}${theme.fg(color, label)}`;
	}

	/** Tree branch and ancestor continuation prefix for one item row. */
	private treePrefix(row: Extract<InjectionRow, { readonly kind: "item" }>): string {
		const branch = row.isLast ? "└─ " : "├─ ";
		if (row.depth === 1) return branch;
		return `${row.parentContinues === true ? "│  " : "   "}${branch}`;
	}

	private scrollLine(width: number): string {
		if (!this.navigator.hasOverflow) return this.fit("", width);
		return this.fit(
			this.theme.fg(
				"dim",
				`${BODY_INDENT}(${this.navigator.selectedOrdinal + 1}/${this.navigator.selectableCount})`,
			),
			width,
		);
	}

	/** Wrapped degraded-capture reason placed below the dialog header. */
	private degradedWarningLines(width: number): string[] {
		const warnings: string[] = [];
		if (this.input.degradedReason !== undefined) warnings.push(normalizeInlineText(this.input.degradedReason));
		return warnings.flatMap((warning) => wrapTextWithAnsi(this.theme.fg("warning", `${BODY_INDENT}${warning}`), width));
	}

	/**
	 * Description block, collapsed whole once the list window falls below its
	 * readable floor. The injection list is unbounded and scrolls on most
	 * terminals, so the description outlives the scroll counter instead of
	 * yielding to it; a list shorter than the floor keeps every row instead.
	 */
	private fittedDescriptionLines(width: number, availableRows: number): string[] {
		const lines = this.descriptionLines(width);
		const floor = Math.min(LIST_DESCRIPTION_MIN_ROWS, this.rows.length);
		const viewport = calculateViewport(this.rows.length, availableRows - descriptionBlockRows(lines), 0);
		return viewport.visibleCount >= floor ? lines : [];
	}

	/**
	 * Wrapped dialog description: the list sentence, the degraded-capture
	 * indicator, request notes, one legend bullet per marker the rows show, and
	 * the note that explains payload changes further.
	 */
	private descriptionLines(width: number): string[] {
		const lines = wrapDescriptionLines(this.theme, LIST_DESCRIPTION, "dim", width);
		if (this.input.degradedReason !== undefined) {
			lines.push(...wrapDescriptionLines(
				this.theme,
				"[Degraded: pi-native fallback used]",
				"warning",
				width,
			));
		}
		if (this.input.probe === true) {
			const note = `Captured by a ${this.theme.fg("warning", "request probe")}` + this.theme.fg(
				"dim", " with an empty prompt. Prompt-dependent injections may be missing.",
			);
			lines.push(...noteBulletLines(this.theme, note, width));
		}
		const guardNote = payloadCheckNote(this.input.guard);
		if (guardNote !== undefined) lines.push(...noteBulletLines(this.theme, guardNote, width));
		const hiddenNote = hiddenToolsNote(this.input.snapshot.hiddenTools ?? []);
		if (hiddenNote !== undefined) lines.push(...noteBulletLines(this.theme, hiddenNote, width));
		lines.push(...markerLegendLines(this.theme, this.rowMarkers(), width));
		for (const note of findingNotes([...this.itemsById.values()])) {
			lines.push(...noteBulletLines(this.theme, note, width));
		}
		return lines;
	}

	/** Markers and diffs the hierarchy rows carry, whatever the current width leaves room to render. */
	private rowMarkers(): ContextMarker[] {
		return this.rows.flatMap((row) => {
			if (row.kind === "group") return partMarkers({ diff: row.diff });
			return row.kind === "item" ? partMarkers({ ...listMarkedState(row), diff: row.diff }) : [];
		});
	}

	private spread(left: string, right: string, width: number): string {
		return spreadLine(left, right, width);
	}

	private fit(line: string, width: number): string {
		return fitLine(line, width);
	}

	private clearCache(): void {
		this.cachedWidth = undefined;
		this.cachedTerminalRows = undefined;
		this.cachedLines = undefined;
	}
}

/**
 * Fit a sanitized path by replacing middle directories with an ellipsis. Keep
 * the root and longest whole tail that fits; give the filename priority when
 * even the root and ellipsis leave too little room.
 */
function shortenInstructionPath(path: string, width: number): string {
	if (visibleWidth(path) <= width) return path;
	const separators = [...path.matchAll(/[/\\]/g)];
	const lastSeparator = separators.at(-1);
	if (lastSeparator === undefined) return fitLine(path, width);
	const root = /^(?:~|[A-Za-z]:)?[/\\]/.exec(path)?.[0] ?? "";
	for (const separator of separators) {
		if (separator.index < root.length) continue;
		const shortened = `${root}…${path.slice(separator.index)}`;
		if (visibleWidth(shortened) <= width) return shortened;
	}
	const tail = `…${path.slice(lastSeparator.index)}`;
	return visibleWidth(tail) <= width ? tail : fitLine(path.slice(lastSeparator.index + 1), width);
}

/** Token diff a list row shows; the total and the separator have none. */
function rowDiff(row: InjectionRow): TokenDiff | undefined {
	return row.kind === "group" || row.kind === "item" ? row.diff : undefined;
}

/** Width the diff columns take after the value column, including their gaps. */
function diffColumnsWidth(columns: InjectionColumns): number {
	const added = columns.addedWidth > 0 ? DIFF_COLUMN_GAP + columns.addedWidth : 0;
	const removed = columns.removedWidth > 0 ? DIFF_COLUMN_GAP + columns.removedWidth : 0;
	return added + removed;
}

/** The marked state a list row shows: its `Forced` change, but no change the diff columns already show. */
function listMarkedState(
	row: Extract<InjectionRow, { readonly kind: "item" }>,
): { readonly dropped?: boolean; readonly moved?: boolean; readonly change?: RequestChange } {
	return { dropped: row.dropped, moved: row.moved, change: row.change === "forced" ? "forced" : undefined };
}

/**
 * What a preview's token diffs compare with: pi's default prompt for pi's
 * contributions, the captured request for a payload change, and the session
 * for everything else.
 */
function previewDiffBase(item: InjectionItem): DiffBase {
	if (item.source.id === PAYLOAD_CHANGES_SOURCE_ID) return "captured-request";
	return item.source.native ? "default-prompt" : "session";
}

/**
 * Description note for a payload comparison that is unavailable or partial, so
 * a missing comparison never reads as "no payload changes". A complete comparison
 * has none: its findings render as rows.
 */
function payloadCheckNote(guard: GuardResult | undefined): string | undefined {
	switch (guard?.status) {
		case "pending":
			return "Payload changes are not checked yet: the comparison is pending.";
		case "incomplete": {
			const reason = normalizeInlineText(guard.reason);
			// Findings, even none, mean one channel was compared
			return guard.findings === undefined
				? `Payload changes were not checked: ${reason}`
				: `Payload changes were checked only in part: ${reason}`;
		}
		default:
			return undefined;
	}
}

/** Count and sanitized names of tools Pi hid, alphabetically, with no note when none are hidden. */
function hiddenToolsNote(tools: readonly string[]): string | undefined {
	if (tools.length === 0) return undefined;
	const names = [...tools].sort().map(normalizeInlineText).join(", ");
	return `${tools.length} ${tools.length === 1 ? "tool" : "tools"} hidden by pi: ${names}.`;
}

/** The note that explains payload changes further, after the marker legend, when any of `items` is one. */
function findingNotes(items: readonly InjectionItem[]): string[] {
	return items.some((item) => item.source.id === PAYLOAD_CHANGES_SOURCE_ID) ? [PAYLOAD_CHANGES_NOTE] : [];
}
