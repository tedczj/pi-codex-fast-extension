import {
	type ExtensionAPI,
	type ExtensionContext,
	type SessionEntry,
	SessionManager,
} from "@earendil-works/pi-coding-agent";

const STATE_ENTRY_TYPE = "codex-fast";
const STATUS_ID = "codex-fast";

type FastState = {
	enabled: boolean;
};

function readFastState(entries: readonly SessionEntry[]): boolean | undefined {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if (entry?.type !== "custom" || entry.customType !== STATE_ENTRY_TYPE) continue;

		const data = entry.data as Partial<FastState> | undefined;
		if (typeof data?.enabled === "boolean") return data.enabled;
	}
	return undefined;
}

function readPreviousSessionState(sessionFile: string): boolean | undefined {
	try {
		return readFastState(SessionManager.open(sessionFile).getEntries());
	} catch {
		return undefined;
	}
}

export default function codexFastExtension(pi: ExtensionAPI) {
	let fastEnabled = false;

	function updateStatus(ctx: ExtensionContext): void {
		const text = fastEnabled ? "⚡ fast: on" : "fast: off";
		const color = fastEnabled ? "success" : "dim";
		ctx.ui.setStatus(STATUS_ID, ctx.ui.theme.fg(color, text));
	}

	function setFastEnabled(enabled: boolean, ctx: ExtensionContext): void {
		fastEnabled = enabled;
		pi.appendEntry<FastState>(STATE_ENTRY_TYPE, { enabled });
		updateStatus(ctx);
		ctx.ui.notify(`Codex fast mode ${enabled ? "enabled" : "disabled"}.`, "info");
	}

	pi.registerCommand("fast", {
		description: "Toggle Codex fast mode for this session",
		handler: async (_args, ctx) => setFastEnabled(!fastEnabled, ctx),
	});

	pi.on("session_start", (event, ctx) => {
		const savedState = readFastState(ctx.sessionManager.getEntries());
		const inheritedState =
			event.reason === "new" && event.previousSessionFile
				? readPreviousSessionState(event.previousSessionFile)
				: undefined;

		fastEnabled = savedState ?? inheritedState ?? false;
		updateStatus(ctx);

		// A new session needs its own state entry so subsequent /new sessions
		// inherit the same value even if the user never toggles it again.
		if (event.reason === "new" && savedState === undefined) {
			pi.appendEntry<FastState>(STATE_ENTRY_TYPE, { enabled: fastEnabled });
		}
	});

	pi.on("before_provider_request", (event, ctx) => {
		if (!fastEnabled || ctx.model?.provider !== "openai-codex") return;

		return {
			...(event.payload as Record<string, unknown>),
			service_tier: "priority",
		};
	});
}
