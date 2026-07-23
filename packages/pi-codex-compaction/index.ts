import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { loadConfig } from "./config.ts";
import {
	buildCodexHeaders,
	buildCompactionRequestBody,
	buildReplacementHistory,
	buildToolPayload,
	callRemoteCompaction,
	effectiveInputForBranch,
	findNativeCheckpoint,
	isJsonObject,
	isOpenAICodexModel,
	mergeFeatureHeader,
	modelKey,
	NATIVE_COMPACTION_KIND,
	NATIVE_COMPACTION_VERSION,
	resolveCodexResponsesUrl,
	stripInputFromPayload,
	type JsonObject,
	type NativeCompactionDetails,
	type ResponseItem,
} from "./native-compaction.ts";

type CachedPayloadShape = {
	modelKey: string;
	payload: JsonObject;
};

function localMarker(): string {
	return `OpenAI Codex native compaction checkpoint (${randomUUID()}).`;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function effectiveBaseUrl(model: Model<any>): string | undefined {
	return model.baseUrl;
}

function setFeatureHeader(headers: Record<string, string | null>): void {
	const existing = Object.entries(headers).find(([name]) => name.toLowerCase() === "x-codex-beta-features");
	if (existing) {
		headers[existing[0]] = mergeFeatureHeader(existing[1]);
	} else {
		headers["x-codex-beta-features"] = mergeFeatureHeader(undefined);
	}
}

export default function codexCompactionExtension(pi: ExtensionAPI): void {
	const payloadShapeBySession = new Map<string, CachedPayloadShape>();

	const createNativeCheckpoint = async (params: {
		ctx: ExtensionContext;
		model: Model<any>;
		input: ResponseItem[];
		basePayload?: JsonObject;
		signal?: AbortSignal;
	}): Promise<{ details: NativeCompactionDetails; usage?: Awaited<ReturnType<typeof callRemoteCompaction>>["usage"] }> => {
		const auth = await params.ctx.modelRegistry.getApiKeyAndHeaders(params.model);
		if (!auth.ok || !auth.apiKey) {
			throw new Error(auth.ok ? "OpenAI Codex authentication is unavailable." : auth.error);
		}
		const sessionId = params.ctx.sessionManager.getSessionId();
		const allTools = pi.getAllTools();
		const body = buildCompactionRequestBody({
			basePayload: params.basePayload,
			model: params.model,
			input: params.input,
			instructions: params.ctx.getSystemPrompt(),
			tools: buildToolPayload(allTools, pi.getActiveTools()),
			sessionId,
		});
		const remote = await callRemoteCompaction({
			url: resolveCodexResponsesUrl(effectiveBaseUrl(params.model)),
			headers: buildCodexHeaders({ apiKey: auth.apiKey, headers: auth.headers, sessionId }),
			body,
			model: params.model,
			signal: params.signal,
		});
		return {
			details: {
				kind: NATIVE_COMPACTION_KIND,
				version: NATIVE_COMPACTION_VERSION,
				modelKey: modelKey(params.model),
				replacementHistory: buildReplacementHistory(params.input, remote.compactionItem),
			},
			usage: remote.usage,
		};
	};

	pi.on("session_start", () => {
		payloadShapeBySession.clear();
	});
	pi.on("session_shutdown", () => {
		payloadShapeBySession.clear();
	});
	pi.on("model_select", (_event, ctx) => {
		payloadShapeBySession.delete(ctx.sessionManager.getSessionId());
	});

	pi.on("context", (event, ctx) => {
		const checkpoint = findNativeCheckpoint(ctx.sessionManager.getBranch() as SessionEntry[]);
		if (checkpoint.status === "none") return undefined;
		return {
			messages: event.messages.filter((message) => message.role !== "compactionSummary"),
		};
	});

	pi.on("before_provider_headers", (event, ctx) => {
		if (!isOpenAICodexModel(ctx.model)) return;
		setFeatureHeader(event.headers);
	});

	pi.on("before_provider_request", async (event, ctx) => {
		const model = ctx.model;
		if (!isOpenAICodexModel(model) || !isJsonObject(event.payload)) return undefined;

		const sessionId = ctx.sessionManager.getSessionId();
		const basePayload = stripInputFromPayload(event.payload);
		payloadShapeBySession.set(sessionId, { modelKey: modelKey(model), payload: basePayload });

		const branch = ctx.sessionManager.getBranch() as SessionEntry[];
		const checkpoint = findNativeCheckpoint(branch);

		try {
			const input = checkpoint.status === "none" && Array.isArray(event.payload.input)
				? event.payload.input.filter(isJsonObject) as ResponseItem[]
				: effectiveInputForBranch({ branch, model, tools: pi.getAllTools() });
			const config = loadConfig(ctx.cwd, ctx.isProjectTrusted());
			const usagePercent = ctx.getContextUsage()?.percent;
			const hasPostCheckpointAssistant = checkpoint.status !== "valid" || branch
				.slice(checkpoint.checkpoint.entryIndex + 1)
				.some((entry) => entry.type === "message" && entry.message.role === "assistant");
			const shouldAutoCompact = config.autoCompact
				&& usagePercent !== null
				&& usagePercent !== undefined
				&& usagePercent >= config.thresholdRatio * 100
				&& hasPostCheckpointAssistant;

			if (shouldAutoCompact) {
				const native = await createNativeCheckpoint({
					ctx,
					model,
					input,
					basePayload,
					signal: ctx.signal,
				});
				pi.appendEntry(NATIVE_COMPACTION_KIND, native.details);
				if (config.notify && ctx.hasUI) {
					ctx.ui.notify(
						`OpenAI Codex context compacted at ${usagePercent!.toFixed(1)}% and will continue.`,
						"info",
					);
				}
				const payload: JsonObject = { ...event.payload, input: native.details.replacementHistory };
				delete payload.messages;
				delete payload.previous_response_id;
				return payload;
			}

			if (checkpoint.status === "none") return undefined;
			const payload: JsonObject = { ...event.payload, input };
			delete payload.messages;
			delete payload.previous_response_id;
			return payload;
		} catch (error) {
			ctx.abort();
			if (ctx.hasUI) {
				ctx.ui.notify(`OpenAI Codex request blocked: ${errorMessage(error)}`, "error");
			}
			const payload: JsonObject = { ...event.payload, input: [] };
			delete payload.messages;
			delete payload.previous_response_id;
			return payload;
		}
	});

	pi.on("session_before_compact", async (event, ctx) => {
		const model = ctx.model;
		if (!isOpenAICodexModel(model)) return undefined;

		try {
			const sessionId = ctx.sessionManager.getSessionId();
			const branch = event.branchEntries as SessionEntry[];
			const input = effectiveInputForBranch({
				branch,
				model,
				tools: pi.getAllTools(),
				excludeLastAssistantError: event.reason === "overflow" && event.willRetry,
			});
			const cached = payloadShapeBySession.get(sessionId);
			const native = await createNativeCheckpoint({
				ctx,
				model,
				input,
				basePayload: cached?.modelKey === modelKey(model) ? cached.payload : undefined,
				signal: event.signal,
			});

			return {
				compaction: {
					summary: localMarker(),
					firstKeptEntryId: event.preparation.firstKeptEntryId,
					tokensBefore: event.preparation.tokensBefore,
					usage: native.usage,
					details: native.details,
				},
			};
		} catch (error) {
			if (!event.signal.aborted && ctx.hasUI) {
				ctx.ui.notify(`OpenAI Codex native compaction failed: ${errorMessage(error)}`, "error");
			}
			return { cancel: true };
		}
	});
}
