import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import codexFastExtension from "../src/index.ts";

type ProviderRequestHandler = (event: { payload: unknown }, ctx: { model?: { provider: string } }) => unknown;

function loadHandler(): ProviderRequestHandler {
	let captured: unknown;
	const pi = {
		on(event: string, handler: unknown) {
			if (event === "before_provider_request") captured = handler;
		},
	} as unknown as ExtensionAPI;

	codexFastExtension(pi);
	if (typeof captured !== "function") throw new Error("before_provider_request handler was not registered");
	return captured as ProviderRequestHandler;
}

describe("codex fast extension", () => {
	it("requests the priority service tier for openai-codex", () => {
		const handler = loadHandler();
		const payload = { model: "gpt-5.4", input: "hello", service_tier: "default" };

		expect(handler({ payload }, { model: { provider: "openai-codex" } })).toEqual({
			model: "gpt-5.4",
			input: "hello",
			service_tier: "priority",
		});
		expect(payload.service_tier).toBe("default");
	});

	it("does not modify requests for other providers", () => {
		const handler = loadHandler();

		expect(handler({ payload: { model: "gpt-5.4" } }, { model: { provider: "openai" } })).toBeUndefined();
		expect(handler({ payload: { model: "gpt-5.4" } }, {})).toBeUndefined();
	});
});
