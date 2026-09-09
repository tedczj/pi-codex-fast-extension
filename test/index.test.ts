import { type ExtensionAPI, type SessionEntry, SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import codexFastExtension from "../src/index.ts";

type ProviderRequestHandler = (event: { payload: unknown }, ctx: TestContext) => unknown;
type SessionStartHandler = (
	event: { reason: "startup" | "reload" | "new" | "resume" | "fork"; previousSessionFile?: string },
	ctx: TestContext,
) => void;
type CommandHandler = (args: string, ctx: TestContext) => Promise<void>;

type TestContext = {
	model?: { provider: string };
	sessionManager: { getEntries(): SessionEntry[] };
	ui: {
		theme: { fg(color: string, text: string): string };
		setStatus(id: string, value: string | undefined): void;
		notify(message: string, level?: string): void;
	};
};

type Harness = {
	providerRequest: ProviderRequestHandler;
	sessionStart: SessionStartHandler;
	fastCommand: CommandHandler;
	appended: Array<{ customType: string; data: unknown }>;
};

function stateEntry(enabled: boolean): SessionEntry {
	return {
		type: "custom",
		id: `state-${enabled}`,
		parentId: null,
		timestamp: new Date(0).toISOString(),
		customType: "codex-fast",
		data: { enabled },
	} as SessionEntry;
}

function createContext(entries: SessionEntry[] = [], provider = "openai-codex") {
	const statuses: Array<{ id: string; value: string | undefined }> = [];
	const notifications: Array<{ message: string; level?: string }> = [];
	const ctx: TestContext = {
		model: { provider },
		sessionManager: { getEntries: () => entries },
		ui: {
			theme: { fg: (color, text) => `${color}:${text}` },
			setStatus: (id, value) => statuses.push({ id, value }),
			notify: (message, level) => notifications.push({ message, level }),
		},
	};
	return { ctx, statuses, notifications };
}

function loadExtension(): Harness {
	const handlers = new Map<string, unknown>();
	let fastCommand: CommandHandler | undefined;
	const appended: Array<{ customType: string; data: unknown }> = [];
	const pi = {
		on(event: string, handler: unknown) {
			handlers.set(event, handler);
		},
		registerCommand(name: string, options: { handler: CommandHandler }) {
			if (name === "fast") fastCommand = options.handler;
		},
		appendEntry(customType: string, data: unknown) {
			appended.push({ customType, data });
		},
	} as unknown as ExtensionAPI;

	codexFastExtension(pi);
	const providerRequest = handlers.get("before_provider_request");
	const sessionStart = handlers.get("session_start");
	if (typeof providerRequest !== "function" || typeof sessionStart !== "function" || !fastCommand) {
		throw new Error("extension handlers were not registered");
	}
	return {
		providerRequest: providerRequest as ProviderRequestHandler,
		sessionStart: sessionStart as SessionStartHandler,
		fastCommand,
		appended,
	};
}

afterEach(() => vi.restoreAllMocks());

describe("codex fast extension", () => {
	it("defaults to off and displays that state", () => {
		const extension = loadExtension();
		const { ctx, statuses } = createContext();
		extension.sessionStart({ reason: "startup" }, ctx);

		expect(statuses.at(-1)).toEqual({ id: "codex-fast", value: "dim:fast: off" });
		expect(extension.providerRequest({ payload: { model: "gpt-5.4" } }, ctx)).toBeUndefined();
	});

	it("toggles and persists fast mode for the current session", async () => {
		const extension = loadExtension();
		const { ctx, statuses } = createContext();
		extension.sessionStart({ reason: "startup" }, ctx);

		await extension.fastCommand("", ctx);
		expect(extension.appended.at(-1)).toEqual({ customType: "codex-fast", data: { enabled: true } });
		expect(statuses.at(-1)).toEqual({ id: "codex-fast", value: "success:⚡ fast: on" });
		expect(extension.providerRequest({ payload: { service_tier: "default" } }, ctx)).toEqual({
			service_tier: "priority",
		});

		await extension.fastCommand("", ctx);
		expect(extension.providerRequest({ payload: {} }, ctx)).toBeUndefined();
	});

	it("restores the latest state saved in a resumed session", () => {
		const extension = loadExtension();
		const { ctx } = createContext([stateEntry(true), stateEntry(false), stateEntry(true)]);
		extension.sessionStart({ reason: "resume" }, ctx);

		expect(extension.providerRequest({ payload: { input: "hello" } }, ctx)).toEqual({
			input: "hello",
			service_tier: "priority",
		});
	});

	it("inherits and records the state when /new creates a session", () => {
		vi.spyOn(SessionManager, "open").mockReturnValue({
			getEntries: () => [stateEntry(true)],
		} as SessionManager);
		const extension = loadExtension();
		const { ctx, statuses } = createContext();

		extension.sessionStart({ reason: "new", previousSessionFile: "/tmp/previous.jsonl" }, ctx);

		expect(SessionManager.open).toHaveBeenCalledWith("/tmp/previous.jsonl");
		expect(extension.appended).toEqual([{ customType: "codex-fast", data: { enabled: true } }]);
		expect(statuses.at(-1)?.value).toBe("success:⚡ fast: on");
		expect(extension.providerRequest({ payload: {} }, ctx)).toEqual({ service_tier: "priority" });
	});

	it("does not modify requests for other providers while enabled", () => {
		const extension = loadExtension();
		const { ctx } = createContext([stateEntry(true)], "openai");
		extension.sessionStart({ reason: "startup" }, ctx);

		expect(extension.providerRequest({ payload: { model: "gpt-5.4" } }, ctx)).toBeUndefined();
	});
});
