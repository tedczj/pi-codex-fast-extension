import { type ExtensionAPI, type SessionEntry, SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import codexFastExtension from "../src/index.ts";

type ProviderRequestHandler = (event: { payload: unknown }, ctx: TestContext) => unknown;
type SessionStartHandler = (
	event: { reason: "startup" | "reload" | "new" | "resume" | "fork"; previousSessionFile?: string },
	ctx: TestContext,
) => void;
type CommandHandler = (args: string, ctx: TestContext) => Promise<void>;
type FooterFactory = (
	tui: { requestRender(): void },
	theme: { fg(color: string, text: string): string },
	footerData: {
		onBranchChange(callback: () => void): () => void;
		getGitBranch(): string | null;
		getAvailableProviderCount(): number;
	},
) => { render(width: number): string[] };

type TestContext = {
	cwd: string;
	model?: { provider: string; id: string; reasoning: boolean; contextWindow: number };
	thinkingLevel: string;
	getContextUsage(): { contextWindow: number; percent: number };
	sessionManager: { getEntries(): SessionEntry[]; getSessionName(): string | undefined };
	ui: {
		setFooter(factory: FooterFactory): void;
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
	const footerFactories: FooterFactory[] = [];
	const notifications: Array<{ message: string; level?: string }> = [];
	const ctx: TestContext = {
		cwd: "/tmp/project",
		model: { provider, id: "gpt-5.6-sol", reasoning: true, contextWindow: 1_000_000 },
		thinkingLevel: "high",
		getContextUsage: () => ({ contextWindow: 1_000_000, percent: 0 }),
		sessionManager: { getEntries: () => entries, getSessionName: () => undefined },
		ui: {
			setFooter: (factory) => footerFactories.push(factory),
			notify: (message, level) => notifications.push({ message, level }),
		},
	};
	return { ctx, footerFactories, notifications };
}

function firstFooter(factories: FooterFactory[]): FooterFactory {
	const factory = factories[0];
	if (!factory) throw new Error("footer was not installed");
	return factory;
}

function renderFooter(factory: FooterFactory): string[] {
	return factory(
		{ requestRender() {} },
		{ fg: (_color, text) => text },
		{
			onBranchChange: () => () => {},
			getGitBranch: () => "main",
			getAvailableProviderCount: () => 2,
		},
	).render(120);
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
	it("defaults to off and omits fast from the model line", () => {
		const extension = loadExtension();
		const { ctx, footerFactories } = createContext();
		extension.sessionStart({ reason: "startup" }, ctx);

		const modelLine = renderFooter(firstFooter(footerFactories)).at(-1);
		expect(modelLine).toContain("(openai-codex) gpt-5.6-sol • high");
		expect(modelLine).not.toContain("• fast");
		expect(extension.providerRequest({ payload: { model: "gpt-5.4" } }, ctx)).toBeUndefined();
	});

	it("toggles, persists, and displays fast mode on the model line", async () => {
		const extension = loadExtension();
		const { ctx, footerFactories } = createContext();
		extension.sessionStart({ reason: "startup" }, ctx);

		await extension.fastCommand("", ctx);
		expect(extension.appended.at(-1)).toEqual({ customType: "codex-fast", data: { enabled: true } });
		expect(renderFooter(firstFooter(footerFactories)).at(-1)).toContain("gpt-5.6-sol • high • fast");
		expect(extension.providerRequest({ payload: { service_tier: "default" } }, ctx)).toEqual({
			service_tier: "priority",
		});

		await extension.fastCommand("", ctx);
		expect(renderFooter(firstFooter(footerFactories)).at(-1)).not.toContain("• fast");
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
		const { ctx, footerFactories } = createContext();

		extension.sessionStart({ reason: "new", previousSessionFile: "/tmp/previous.jsonl" }, ctx);

		expect(SessionManager.open).toHaveBeenCalledWith("/tmp/previous.jsonl");
		expect(extension.appended).toEqual([{ customType: "codex-fast", data: { enabled: true } }]);
		expect(renderFooter(firstFooter(footerFactories)).at(-1)).toContain("gpt-5.6-sol • high • fast");
		expect(extension.providerRequest({ payload: {} }, ctx)).toEqual({ service_tier: "priority" });
	});

	it("does not modify requests for other providers while enabled", () => {
		const extension = loadExtension();
		const { ctx } = createContext([stateEntry(true)], "openai");
		extension.sessionStart({ reason: "startup" }, ctx);

		expect(extension.providerRequest({ payload: { model: "gpt-5.4" } }, ctx)).toBeUndefined();
	});
});
