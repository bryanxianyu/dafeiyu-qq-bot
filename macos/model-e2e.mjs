// 使用临时 fish profile、模拟 OneBot 和模型服务。无需 QQ 登录或 API Key。
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocketServer } from "ws";
import YAML from "yaml";

const runtime = mkdtempSync(join(tmpdir(), "dafeiyu-model-e2e-"));
const profile = join(runtime, "home", "profiles", "fish");
const patchFile = join(profile, "cordis.patch.yml");
const manifestFile = join(profile, "package.json");
const desktopHome = join(runtime, "fake-desktop-dsh");
const desktopProfile = join(desktopHome, "profiles", "desktop");
const desktopPatchFile = join(desktopProfile, "cordis.patch.yml");
let server;
let output = "";
let readLogs;
let connection;
let connections = 0;
let messageId = 0;
const messages = [];
const modelRequests = [];
const onebotActions = [];
let malformedVision = false;
const png = "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGMQ7DgDRwzEcQA4whZRK97LlwAAAABJRU5ErkJggg==";
const qqFile = Buffer.from("hello from QQ file\n");

const onebot = new WebSocketServer({ host: "127.0.0.1", port: 0 });
onebot.on("connection", (ws) => {
	connection = ws;
	connections++;
	ws.on("message", (raw) => {
		const req = JSON.parse(raw);
		onebotActions.push(req.action);
		if (req.action === "send_private_msg") messages.push(req.params.message.map(({ data }) => data.text ?? "").join(""));
		const data = req.action === "get_image" ? { file: `base64://${Buffer.from(png, "base64").toString("base64")}` }
			: req.action === "get_file" ? req.params.type === "base64"
				? { file: "/napcat/cache/notes.txt", base64: qqFile.toString("base64"), file_name: "notes.txt" }
				: { file: "/napcat/cache/notes.txt", file_name: "notes.txt" }
				: { message_id: 1, user_id: 99999 };
		ws.send(JSON.stringify({ status: "ok", retcode: 0, data, echo: req.echo }));
	});
});
const model = createServer(async (req, res) => {
	let body = "";
	for await (const chunk of req) body += chunk;
	if (req.method !== "POST" || req.url !== "/v1/chat/completions") return res.writeHead(404).end();
	const input = JSON.parse(body);
	modelRequests.push(input);
	const event = { id: "test", object: "chat.completion.chunk", created: 1, model: input.model };
	const sse = (delta, finish_reason) => "data: " + JSON.stringify({ ...event, choices: [{ index: 0, delta, finish_reason }] }) + "\n\n";
	res.writeHead(200, { "Content-Type": "text/event-stream" });
	const memory = input.messages.some(({ content }) => typeof content === "string" && content.includes("记忆整理器"));
	const vision = input.messages.some(({ content }) => Array.isArray(content) && content.some(({ type }) => type === "image_url"));
	const ordinaryPhoto = JSON.stringify(input.messages).includes("QQ 给它的名字：照片");
	const flatten = (value) => typeof value === "string" ? value : Array.isArray(value) ? value.map((part) => part.text ?? JSON.stringify(part)).join(" ") : "";
	const transcript = input.messages.map(({ content }) => flatten(content)).join("\n");
	const hasFile = transcript.includes("notes.txt") && transcript.includes("verbatim read-only copy saved at");
	const fileReadResult = input.messages.some(({ role, content }) => role === "tool" && flatten(content).includes(qqFile.toString().trim()));
	const groupMemory = memory && transcript.includes("我每周都去游泳") && transcript.includes("我周末练习素描");
	const content = memory
		? JSON.stringify({ memories: groupMemory
			? [{ text: "群友每周都去游泳", importance: 3, about: "user", userId: 10002, from: 10002, keywords: ["游泳"] }]
			: [{ text: "主人喜欢草莓", importance: 4, about: "user", userId: 10001, from: 10001, keywords: ["草莓"] }], core: [] })
		: vision ? (malformedVision ? "{}" : ordinaryPhoto
			? JSON.stringify({ sticker: false, safe: true, desc: "一只猫", emotions: ["好奇"], tags: ["猫"] })
			: JSON.stringify({ sticker: true, safe: true, desc: "晚安表情", emotions: ["开心"], tags: ["晚安"] }))
			: hasFile && fileReadResult ? "文件内容：hello from QQ file"
			: transcript.includes("我周末练习素描") ? "[沉默]" : `来自${input.model}`;
	if (hasFile && !fileReadResult) {
		const path = transcript.match(/verbatim read-only copy saved at "([^"]+)"/)?.[1];
		const readTool = JSON.stringify(input.tools ?? []).includes('"name":"read"');
		if (path && readTool) {
			const call = { index: 0, id: "call-file-read", type: "function", function: { name: "read", arguments: JSON.stringify({ file_path: path }) } };
			res.end(sse({ role: "assistant", content: null, tool_calls: [call] }, "tool_calls") + "data: [DONE]\n\n");
			return;
		}
	}
	res.end(sse({ role: "assistant", content }, null) + sse({}, "stop") + "data: [DONE]\n\n");
});

function listening(http) {
	return new Promise((resolve, reject) => http.once("listening", resolve).once("error", reject));
}

async function until(check) {
	let lastError;
	const deadline = Date.now() + 20000;
	while (Date.now() < deadline) {
		const value = await check().catch((error) => { lastError = error; });
		if (value) return value;
		if (server && server.exitCode !== null) break;
		await delay(100);
	}
	throw new Error("等待测试结果超时：" + (lastError?.message ?? "") + "\n" + output);
}

function sendQQ(message, groupId, userId = 10001) {
	connection.send(JSON.stringify({
		post_type: "message", message_type: groupId ? "group" : "private", group_id: groupId, self_id: 99999, user_id: userId,
		message_id: ++messageId, time: Math.floor(Date.now() / 1000), message
	}));
}

try {
	const botListening = listening(onebot);
	const modelListening = listening(model);
	model.listen(0, "127.0.0.1");
	await Promise.all([botListening, modelListening]);
	mkdirSync(profile, { recursive: true });
	const patch = `# 本文件由 DSH 用户管理
- id: llm-pi-ai
  config:
    providers:
      fish-local:
        api: openai-completions
        baseURL: http://127.0.0.1:${model.address().port}/v1
        apiKeyEnv: FISH_TEST_MODEL_KEY
        models:
          - id: fish-a
          - id: fish-b
            input: [text, image]
            reasoningEfforts: { low: low, high: high }
`;
	writeFileSync(patchFile, patch);
	mkdirSync(desktopProfile, { recursive: true });
	const desktopPatch = `- id: llm-pi-ai
  config:
    providers:
      desktop-local:
        api: openai-completions
        baseURL: http://127.0.0.1:${model.address().port}/v1
        apiKeyEnv: FISH_TEST_MODEL_KEY
        models:
          - id: desktop-a
`;
	writeFileSync(desktopPatchFile, desktopPatch);
	const manifest = JSON.stringify({
		name: "dsh-profile-fish", private: true, description: "keep DSH settings",
		dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "dsh-fish"] } }
	});
	writeFileSync(manifestFile, manifest);
	const reservation = createServer().listen(0, "127.0.0.1");
	await listening(reservation);
	const port = reservation.address().port;
	await new Promise((resolve) => reservation.close(resolve));
	server = spawn(process.execPath, [join(import.meta.dirname, "start.mjs"), "--no-open"], {
		env: { ...process.env, FISH_RUNTIME_DIR: runtime, FISH_DESKTOP_DSH_HOME: desktopHome, FISH_PORT: String(port), FISH_TEST_MODEL_KEY: "local-test" },
	});
	server.stdout.on("data", (chunk) => output += chunk);
	server.stderr.on("data", (chunk) => output += chunk);
	const base = `http://127.0.0.1:${port}`;
	const html = await until(async () => (await fetch(base)).text());
	const token = html.match(/FISH_TOKEN = "(\w+)"/)[1];
	const api = async (url, body) => {
		const r = await fetch(base + url, {
			signal: AbortSignal.timeout(3000),
			method: body === undefined ? "GET" : "POST",
			headers: { "X-Fish-Token": token, "Content-Type": "application/json" },
			body: body === undefined ? undefined : JSON.stringify(body)
		});
		assert.equal(r.status, 200, await r.clone().text());
		return r.json();
	};
	readLogs = () => api("/api/logs?source=fish");
	const models = async () => (await api("/api/models")).providers.find((provider) => provider.id === "fish-local")?.models;
	const desktopModels = async () => (await api("/api/models")).providers.find((provider) => provider.id === "desktop-local")?.models;
	assert.deepEqual((await until(models)).map(({ id }) => id), ["fish-a", "fish-b"]);
	assert.deepEqual((await until(desktopModels)).map(({ id }) => id), ["desktop-a"]);
	const updated = patch + "          - id: fish-c\n            reasoningEfforts: { low: low, high: high }\n          - id: fish-vision\n            input: [text, image]\n            reasoningEfforts: { low: low, high: high }\n";
	writeFileSync(patchFile, updated);
	await until(async () => (await models())?.some(({ id }) => id === "fish-c"));
	const desktopUpdated = desktopPatch + "          - id: desktop-b\n";
	writeFileSync(desktopPatchFile, desktopUpdated);
	await until(async () => (await desktopModels())?.some(({ id }) => id === "desktop-b"));
	assert.equal(connections, 0, "配置 QQ 前应能读目录");
	const modelRef = (id) => JSON.stringify(["fish-local", id]);
	await api("/api/config", {
		owners: "10001", onebotUrl: `ws://127.0.0.1:${onebot.address().port}`,
		chatModel: modelRef("fish-a"), toolsOwner: "full", memoryEnabled: false
	});
	await until(async () => connections >= 1);
	sendQQ("你好");
	await until(async () => messages.some((text) => text.includes("来自fish-a")));
	const sessionsFile = join(runtime, "data", "fish-sessions.json");
	const session = JSON.parse(readFileSync(sessionsFile, "utf8"))["private:10001"];
	await api("/api/config", { chatModel: modelRef("fish-b"), chatReasoningEffort: "high" });
	await until(async () => connections >= 2);
	sendQQ("再说一句");
	await until(async () => messages.some((text) => text.includes("来自fish-b")));
	assert.ok(modelRequests.some((r) => r.model === "fish-b" && r.reasoning_effort === "high"), "聊天请求应携带 high 思考等级");
	assert.equal(JSON.parse(readFileSync(sessionsFile, "utf8"))["private:10001"], session);
	const profileRows = YAML.parse(readFileSync(patchFile, "utf8"));
	const profileProviders = profileRows.find((row) => row.id === "llm-pi-ai").config.providers;
	assert.deepEqual(profileProviders["fish-local"].models.map(({ id }) => id), ["fish-a", "fish-b", "fish-c", "fish-vision"]);
	assert.deepEqual(profileProviders["desktop-local"].models.map(({ id }) => id), ["desktop-a", "desktop-b"]);
	assert.equal(readFileSync(desktopPatchFile, "utf8"), desktopUpdated, "桌面版配置保持不变");
	console.log("模型目录热更新、桌面路由同步、QQ 切换、会话续接和 DSH 配置保留通过");

	const configured = await api("/api/config", {
		memoryEnabled: true, memoryExtractEvery: 1, memoryModel: modelRef("fish-c"), memoryReasoningEffort: "low", visionModel: modelRef("fish-vision")
	});
	assert.equal(configured.restarted, false, "辅助模型切换无需重启 QQ");
	sendQQ("我喜欢草莓");
	const memoriesFile = join(runtime, "data", "mind", "memories.json");
	await until(async () => JSON.parse(readFileSync(memoriesFile, "utf8")).some(({ text }) => text === "主人喜欢草莓"));
	assert.ok(modelRequests.some(({ model }) => model === "fish-c"));
	assert.ok(modelRequests.some((r) => r.model === "fish-c" && r.reasoning_effort === "low"), "记忆应使用独立的 low 思考等级");
	malformedVision = true;
	const rejected = await api("/api/stickers/upload", { name: "无效模型结果", data: png });
	assert.match(rejected.error, /未明确返回/);
	assert.equal((await api("/api/stickers")).items.length, 0);
	malformedVision = false;
	const sticker = await api("/api/stickers/upload", { name: "测试表情", data: png });
	assert.equal(sticker.status, "approved", JSON.stringify(sticker));
	assert.ok(modelRequests.some(({ model, messages }) => model === "fish-vision" &&
		messages.some(({ content }) => Array.isArray(content) && content.some(({ type }) => type === "image_url"))));
	assert.ok(modelRequests.some((r) => r.model === "fish-vision" && r.reasoning_effort === "high"), "看图默认跟随聊天的 high 思考等级");

	const visionRequestsBeforePrivateImage = modelRequests.filter(({ model, messages }) => model === "fish-vision" && JSON.stringify(messages).includes("image_url")).length;
	const beforeImageResponse = messages.length;
	sendQQ([{ type: "image", data: { file: "incoming-image", sub_type: 1, summary: "[动画表情]" } }]);
	await until(async () => modelRequests.some(({ model, messages }) => model === "fish-b" && JSON.stringify(messages).includes("【图片识别】")));
	assert.ok(onebotActions.includes("get_image"), `私聊图片应通过 OneBot get_image 取回：${onebotActions.join(",")}`);
	const visionRequestsAfterPrivateImage = modelRequests.filter(({ model, messages }) => model === "fish-vision" && JSON.stringify(messages).includes("image_url")).length;
	assert.ok(visionRequestsAfterPrivateImage > visionRequestsBeforePrivateImage,
		`私聊图片必须进入配置的 DSH 视觉模型：${visionRequestsBeforePrivateImage}→${visionRequestsAfterPrivateImage}，调用=${modelRequests.map(({ model, messages }) => `${model}:${JSON.stringify(messages).slice(-120)}`).join(" | ")}`);
	const imageChatRequest = [...modelRequests].reverse().find(({ model, messages }) => model === "fish-b" && JSON.stringify(messages).includes("【图片识别】"));
	assert.ok(imageChatRequest && JSON.stringify(imageChatRequest.messages).includes("晚安表情"),
		"图片识别结果必须进入 QQ 聊天模型上下文");
	await until(async () => messages.length > beforeImageResponse);
	const stickerItemsAfterPrivateImage = (await api("/api/stickers")).items;
	assert.ok(stickerItemsAfterPrivateImage.some(({ desc, status, seen }) => desc === "晚安表情" && status === "approved" && seen === 2), "私聊识别表情应复用已存在条目并计入去重命中");
	console.log("私聊图片进入视觉模型、识别结果进入聊天、相同表情去重通过");
	const beforePhotoImageRequest = modelRequests.length;
	const beforePhotoResponse = messages.length;
	sendQQ([{ type: "image", data: { file: "incoming-photo", sub_type: 0, summary: "照片" } }]);
	await until(async () => modelRequests.slice(beforePhotoImageRequest).some(({ model, messages }) => model === "fish-b" && JSON.stringify(messages).includes("一只猫")));
	assert.ok(modelRequests.slice(beforePhotoImageRequest).some(({ model, messages }) => model === "fish-vision" && JSON.stringify(messages).includes("image_url")), "普通私聊照片也应由视觉模型识别");
	await until(async () => messages.length > beforePhotoResponse);
	console.log("普通私聊照片识别通过");

	const beforeFileReply = messages.length;
	sendQQ([{ type: "file", data: { file_id: "incoming-file", file: "incoming-file", name: "notes.txt", size: qqFile.length } }]);
	await until(async () => messages.slice(beforeFileReply).some((text) => text.includes("hello from QQ file")));
	const fileChatRequest = [...modelRequests].reverse().find(({ model, messages }) => model === "fish-b" && JSON.stringify(messages).includes("notes.txt"));
	assert.ok(fileChatRequest, "QQ 文件应进入 DSH 模型上下文");
	assert.match(JSON.stringify(fileChatRequest.messages), /verbatim read-only copy saved at/, "模型应收到 DSH 可读的只读附件路径");
	assert.ok(JSON.stringify(fileChatRequest.tools ?? []).includes('"name":"read"'), "主人私聊应具备 DSH read 工具以读取文本附件");
	assert.ok(modelRequests.some(({ messages }) => messages.some(({ role, content }) => role === "tool" && JSON.stringify(content).includes("hello from QQ file"))), "DSH read 工具应能读取附件并返回真实内容");
	assert.ok(messages.some((text) => text.includes("hello from QQ file")), "聊天模型应根据读取到的文件内容回复");
	const digest = createHash("sha256").update(qqFile).digest("hex");
	const savedFile = join(runtime, "home", "attachments", "v1", "files", digest.slice(0, 2), digest, "notes.txt");
	assert.equal(readFileSync(savedFile).toString(), qqFile.toString(), "附件内容应保存在隔离的 DSH runtime 中");
	console.log("私聊文件通过 OneBot 下载并作为 DSH 只读附件提供给 read 工具");
	assert.deepEqual(YAML.parse(readFileSync(patchFile, "utf8")).find((row) => row.id === "llm-pi-ai").config.providers["fish-local"].models.map(({ id }) => id), ["fish-a", "fish-b", "fish-c", "fish-vision"]);
	assert.equal(readFileSync(desktopPatchFile, "utf8"), desktopUpdated, "桌面版配置保持不变");
	assert.equal(readFileSync(manifestFile, "utf8"), manifest);
	console.log("记忆经 DSH 提取、视觉经 DSH 看图、无效判定不入库通过");

	const previousConnections = connections;
	await api("/api/config", { allowGroups: "12345", groupMode: "natural", groupChattiness: 0, groupInitiative: "off", memoryExtractEvery: 2 });
	await until(async () => connections > previousConnections);
	const groupRequestsStart = modelRequests.length;
	sendQQ("我每周都去游泳", 12345, 10002);
	const queueFile = join(runtime, "data", "mind", "queued-turns.json");
	await until(async () => JSON.parse(readFileSync(queueFile, "utf8")).some(([key, buf]) =>
		key === "group:12345" && buf.turns.some(({ text }) => text === "我每周都去游泳")));
	assert.ok(!modelRequests.slice(groupRequestsStart).some((request) =>
		JSON.stringify(request.messages).includes("我每周都去游泳")), "潜水消息应进入待整理队列，不触发聊天");
	sendQQ("我周末练习素描", 12345);
	await until(async () => (await readLogs()).lines.some(({ text }) => text.includes("group:12345 -> （潜水，没接话）")));
	await until(async () => JSON.parse(readFileSync(memoriesFile, "utf8")).some(({ text, scope }) =>
		text === "群友每周都去游泳" && scope === "user:10002"));
	const groupMemoryRequest = modelRequests.slice(groupRequestsStart).find((request) =>
		request.model === "fish-c" && JSON.stringify(request.messages).includes("我每周都去游泳"));
	const groupTranscript = JSON.stringify(groupMemoryRequest?.messages);
	assert.equal(groupTranscript.split("我每周都去游泳").length, 2, "潜水消息只整理一次");
	assert.equal(groupTranscript.split("我周末练习素描").length, 2, "选择沉默的消息也只整理一次");
	assert.ok(!onebotActions.includes("send_group_msg"), "记忆收集不应让咕宝在群里发言");
	console.log("潜水和选择沉默的群消息进入同一批记忆整理，没有触发群回复");
} catch (error) {
	if (readLogs) console.error((await readLogs().catch(() => null))?.lines.map(({ text }) => text).join("\n"));
	throw error;
} finally {
	if (server && server.exitCode === null && !server.signalCode) {
		const closed = new Promise((resolve) => server.once("close", resolve));
		server.kill("SIGTERM");
		await closed;
	}
	for (const ws of onebot.clients) ws.terminate();
	await new Promise((resolve) => onebot.close(resolve));
	model.closeAllConnections();
	await new Promise((resolve) => model.close(resolve));
	rmSync(runtime, { recursive: true, force: true });
}
