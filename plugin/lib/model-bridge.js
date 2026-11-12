// 控制台通过私有 IPC 读取当前 fish profile，并委托无工具的模型请求。
export function attachModelBridge(ctx, getSelection) {
	if (!process.send) return;
	const llm = ctx.get("llm");
	const safeError = (error) => String(error?.message ?? error)
		.replace(/\bBearer\s+[^\s"']+/gi, "Bearer [已隐藏]")
		.replace(/[?&][^=]*(?:key|token|secret|auth)[^=]*=[^&\s]+/gi, "[凭据已隐藏]")
		.replace(/\b(?:sk-|AIza)[A-Za-z0-9_-]{8,}/g, "[密钥已隐藏]");
	ctx.effect(() => {
		const pending = new Map();

		async function receive(message) {
			if (message?.fishModelCancel) {
				pending.get(message.fishModelCancel)?.abort();
				return;
			}
			const id = message?.fishModelRequest;
			if (!id || pending.has(id)) return;
			const controller = new AbortController();
			pending.set(id, controller);
			const reply = (payload) => {
				if (process.connected && !controller.signal.aborted) {
					process.send({ fishModelResult: id, ...payload }, () => {});
				}
			};
			try {
				if (message.operation === "catalog") {
					const providers = await Promise.all(llm.listProviders().map(async ({ id, name }) => {
						try {
							const models = await llm.listModels(id);
							return { id, name, models: await Promise.all(models.map(async ({ id: modelId, name: modelName, inputModalities }) => {
								const info = await llm.resolveModelInfo(id, modelId).catch(() => null);
								return { id: modelId, name: modelName, inputModalities, reasoning: info?.reasoning };
							})) };
						} catch {
							return { id, name, models: [], unavailable: true };
						}
					}));
					reply({ result: { providers, chat: getSelection() } });
				} else if (message.operation === "generate") {
					const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]);
					const result = await generate(ctx, llm, message.input, getSelection, signal);
					reply({ result });
				} else {
					throw new Error("未知模型操作");
				}
			} catch (error) {
				reply({ error: safeError(error) });
			} finally {
				pending.delete(id);
			}
		}
		process.on("message", receive);
		return () => {
			process.off("message", receive);
			for (const controller of pending.values()) controller.abort();
		};
	}, "fish-model-bridge");
}

export async function resolveAuxEffort(llm, chat, effort, signal) {
	let reasoningEffort = effort === "follow" ? chat?.reasoningEffort : effort === "default" ? undefined : effort;
	if (effort === "follow" && !reasoningEffort && chat?.provider && chat?.model) {
		const chatInfo = await llm.resolveModelInfo(chat.provider, chat.model, signal);
		reasoningEffort = chatInfo.reasoning?.defaultEffort;
	}
	return reasoningEffort;
}

async function generate(ctx, llm, { selection, effort, prompt, image, maxTokens }, getSelection, signal) {
	const chat = getSelection();
	const { provider, model } = selection ?? chat;
	const reasoningEffort = await resolveAuxEffort(llm, chat, effort, signal);
	const content = [{ type: "text", text: prompt }];
	if (image) {
		const info = await llm.resolveModelInfo(provider, model, signal);
		if (!info.inputModalities?.includes("image")) throw new Error("此模型未声明支持图片，请选择视觉模型");
		signal.throwIfAborted();
		const attachment = await ctx.get("attachments").saveImage({
			data: Buffer.from(image.base64, "base64"),
			mediaType: image.mime
		});
		content.push({ type: "image", attachment });
	}
	let text = "";
	let tokens = 0;
	let stopped = false;
	for await (const chunk of llm.stream({ provider, model, ...(reasoningEffort ? { reasoningEffort } : {}), maxTokens, signal, messages: [{ role: "user", content }] })) {
		if (chunk.type === "text-delta") text += chunk.text;
		if (chunk.type === "usage") tokens = chunk.usage.totalTokens ?? chunk.usage.inputTokens + chunk.usage.outputTokens;
		if (chunk.type === "finish") {
			if (chunk.reason.kind !== "stop") {
				const failure = chunk.reason.failure;
				const detail = failure ? `：${failure.code}${failure.message ? ` - ${failure.message}` : ""}` : "";
				throw new Error(`DSH 模型未正常完成（${chunk.reason.kind}${detail}）`);
			}
			stopped = true;
		}
	}
	if (!stopped || !text.trim()) throw new Error("DSH 模型没有返回文本");
	return { text, tokens };
}
