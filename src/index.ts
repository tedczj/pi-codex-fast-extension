import { isAbsolute, relative, resolve, sep } from "node:path";
import {
	type ExtensionAPI,
	type ExtensionContext,
	type SessionEntry,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const STATE_ENTRY_TYPE = "codex-fast";

type FastState = {
	enabled: boolean;
};

type Usage = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: { total: number };
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

function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	return `${(count / 1000000).toFixed(1)}M`;
}

function formatCwd(cwd: string): string {
	const home = process.env.HOME ?? process.env.USERPROFILE;
	if (!home) return cwd;
	const relativeToHome = relative(resolve(home), resolve(cwd));
	const insideHome =
		relativeToHome === "" ||
		(relativeToHome !== ".." && !relativeToHome.startsWith(`..${sep}`) && !isAbsolute(relativeToHome));
	if (!insideHome) return cwd;
	return relativeToHome === "" ? "~" : `~${sep}${relativeToHome}`;
}

function getUsage(entries: readonly SessionEntry[]): Usage {
	const total: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } };
	for (const entry of entries) {
		let usage: Usage | undefined;
		if (entry.type === "message" && entry.message.role === "assistant") usage = entry.message.usage;
		else if (entry.type === "message" && entry.message.role === "toolResult") usage = entry.message.usage;
		else if (entry.type === "compaction" || entry.type === "branch_summary") usage = entry.usage;
		if (!usage) continue;
		total.input += usage.input;
		total.output += usage.output;
		total.cacheRead += usage.cacheRead;
		total.cacheWrite += usage.cacheWrite;
		total.cost.total += usage.cost.total;
	}
	return total;
}

export default function codexFastExtension(pi: ExtensionAPI) {
	let fastEnabled = false;
	let requestFooterRender: (() => void) | undefined;

	function installFooter(ctx: ExtensionContext): void {
		ctx.ui.setFooter((tui, theme, footerData) => {
			requestFooterRender = () => tui.requestRender();
			const unsubscribe = footerData.onBranchChange(requestFooterRender);
			return {
				dispose() {
					unsubscribe();
					requestFooterRender = undefined;
				},
				invalidate() {},
				render(width: number): string[] {
					let pwd = formatCwd(ctx.cwd);
					const branch = footerData.getGitBranch();
					if (branch) pwd += ` (${branch})`;
					const sessionName = ctx.sessionManager.getSessionName();
					if (sessionName) pwd += ` • ${sessionName}`;

					const usage = getUsage(ctx.sessionManager.getEntries());
					const leftParts: string[] = [];
					if (usage.input) leftParts.push(`↑${formatTokens(usage.input)}`);
					if (usage.output) leftParts.push(`↓${formatTokens(usage.output)}`);
					if (usage.cacheRead) leftParts.push(`R${formatTokens(usage.cacheRead)}`);
					if (usage.cacheWrite) leftParts.push(`W${formatTokens(usage.cacheWrite)}`);
					if (usage.cost.total || ctx.model?.provider === "openai-codex") {
						leftParts.push(`$${usage.cost.total.toFixed(3)}${ctx.model?.provider === "openai-codex" ? " (sub)" : ""}`);
					}
					const context = ctx.getContextUsage();
					const contextWindow = context?.contextWindow ?? ctx.model?.contextWindow ?? 0;
					const percent =
						context?.percent === null || context?.percent === undefined ? "?" : `${context.percent.toFixed(1)}%`;
					leftParts.push(`${percent}/${formatTokens(contextWindow)} (auto)`);

					const modelParts = [ctx.model?.id ?? "no-model"];
					if (ctx.model?.reasoning) modelParts.push(ctx.thinkingLevel || "off");
					if (fastEnabled) modelParts.push("fast");
					let right = modelParts.join(" • ");
					if (footerData.getAvailableProviderCount() > 1 && ctx.model) right = `(${ctx.model.provider}) ${right}`;

					const left = leftParts.join(" ");
					const availableRight = Math.max(0, width - visibleWidth(left) - 2);
					if (visibleWidth(left) + 2 + visibleWidth(right) > width) right = truncateToWidth(right, availableRight, "");
					const padding = " ".repeat(Math.max(0, width - visibleWidth(left) - visibleWidth(right)));
					return [
						truncateToWidth(theme.fg("dim", pwd), width, theme.fg("dim", "...")),
						theme.fg("dim", left + padding + right),
					];
				},
			};
		});
	}

	function setFastEnabled(enabled: boolean, ctx: ExtensionContext): void {
		fastEnabled = enabled;
		pi.appendEntry<FastState>(STATE_ENTRY_TYPE, { enabled });
		requestFooterRender?.();
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
		installFooter(ctx);

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
