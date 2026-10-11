/**
 * Demo extension: a `context` handler that adds a request-only custom
 * message. Nothing is persisted, so only the request contains it.
 *
 * Expected result:
 *   before the monitor   structured addition under unattributed messages
 *   after the monitor    same as before
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const CONTEXT_ADD_TYPE = "context-view-fixture-add";
export const CONTEXT_ADD_TEXT = "Focus the review on error handling and test coverage.";

/** Add the note before the prompt so it cannot pair with a deleted note after it. */
export default function (pi: ExtensionAPI): void {
	pi.on("context", (event) => ({
		messages: [{
			role: "custom",
			customType: CONTEXT_ADD_TYPE,
			content: CONTEXT_ADD_TEXT,
			display: false,
			timestamp: Date.now(),
		}, ...event.messages],
	}));
}
