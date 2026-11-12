// Optional real-provider smoke test. Requires --run-real-model-requests because
// each request leaves the machine and may consume the provider account's quota.
import { spawn } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import YAML from "yaml";
import { loadDesktopModelImport, syncFishProfileModelRoutes } from "../release/app/dsh-desktop-models.mjs";

if (!process.argv.includes("--run-real-model-requests")) {
	console.error("此脚本会向配置的模型服务发送请求，可能消耗额度。确认后运行：node macos/model-smoke.mjs --run-real-model-requests");
	process.exit(2);
}

const repo = resolve(import.meta.dirname, "..");
const runtime = mkdtempSync(join(tmpdir(), "fish-dsh-model-smoke-"));
process.once("exit", () => rmSync(runtime, { recursive: true, force: true }));
const home = join(runtime, "home");
const profile = join(home, "profiles", "fish");
const modules = join(profile, "node_modules");
const dependencies = join(repo, "macos", "node_modules", "@deepseek-ai");
const dshHome = resolve(process.env.FISH_DESKTOP_DSH_HOME || join(homedir(), ".dsh"));
const existingRuntime = resolve(process.env.FISH_RUNTIME_DIR || join(repo, "macos", "data", "runtime"));
const imported = loadDesktopModelImport(dshHome, YAML);
if (!Object.keys(imported.providers).length) throw new Error("DSH 桌面版 desktop profile 中没有可导入的模型提供方");

mkdirSync(modules, { recursive: true });
symlinkSync(dependencies, join(modules, "@deepseek-ai"), "dir");
cpSync(join(repo, "plugin"), join(modules, "dsh-fish"), { recursive: true });
mkdirSync(profile, { recursive: true });
copyFileSync(join(repo, "release", "profile", "package.json"), join(profile, "package.json"));
const existingFishPatch = join(existingRuntime, "home", "profiles", "fish", "cordis.patch.yml");
if (existsSync(existingFishPatch)) copyFileSync(existingFishPatch, join(profile, "cordis.patch.yml"));
syncFishProfileModelRoutes(profile, imported, join(runtime, "data", "dsh-desktop-model-import.json"), YAML);

process.env.FISH_RUNTIME_DIR = runtime;
process.env.FISH_DSH_BIN = join(dependencies, "dsh", "lib", "bin.js");
process.env.FISH_DSH_CREDENTIALS_PATH = imported.credentialsPath;
const { paths, writeFishPatch } = await import(`../release/app/config.mjs?smoke=${randomUUID()}`);
mkdirSync(paths.dataDir, { recursive: true });
writeFishPatch();

const child = spawn(process.execPath, [paths.dshBin, "--profile", "fish", "--patch", paths.fishPatch], {
	cwd: runtime,
	env: { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: "1" },
	stdio: ["ignore", "ignore", "ignore", "ipc"]
});
const pending = new Map();
child.on("message", (message) => {
	const request = pending.get(message?.fishModelResult);
	if (!request) return;
	pending.delete(message.fishModelResult);
	clearTimeout(request.timer);
	message.error ? request.reject(new Error(message.error)) : request.resolve(message.result);
});
function rpc(operation, input = {}, timeoutMs = 65000) {
	const id = randomUUID();
	return new Promise((resolveRpc, rejectRpc) => {
		const timer = setTimeout(() => {
			pending.delete(id);
			rejectRpc(new Error("DSH 模型服务响应超时"));
		}, timeoutMs);
		pending.set(id, { resolve: resolveRpc, reject: rejectRpc, timer });
		child.send({ fishModelRequest: id, operation, input }, (error) => {
			if (!error) return;
			clearTimeout(timer);
			pending.delete(id);
			rejectRpc(error);
		});
	});
}

const safeError = (error) => String(error?.message ?? error)
	.replace(/\bBearer\s+[^\s"']+/gi, "Bearer [已隐藏]")
	.replace(/[?&][^=]*(?:key|token|secret|auth)[^=]*=[^&\s]+/gi, "[凭据已隐藏]")
	.replace(/\b(?:sk-|AIza)[A-Za-z0-9_-]{8,}/g, "[密钥已隐藏]")
	.slice(0, 260);

try {
	let catalog;
	const expected = Object.entries(imported.providers).flatMap(([provider, config]) => (config.models || []).map((model) => `${provider}/${model.id}`));
	for (let attempt = 0; attempt < 60; attempt++) {
		if (child.exitCode !== null) throw new Error(`DSH 进程已退出：${child.exitCode}`);
		try {
			catalog = await rpc("catalog", {}, 5000);
			const detected = new Set(catalog.providers.flatMap((provider) => provider.models.map((model) => `${provider.id}/${model.id}`)));
			if (expected.every((model) => detected.has(model))) break;
		} catch {}
		await delay(500);
	}
	if (!catalog) throw new Error("DSH 模型目录启动超时");
	const providers = new Map(catalog.providers.map((provider) => [provider.id, provider]));
	const targets = expected.map((item) => {
		const [provider, model] = item.split("/");
		return { provider, model };
	});
	for (const model of providers.get("deepseek-account")?.models || []) {
		targets.push({ provider: "deepseek-account", model: model.id });
	}
	const only = process.argv.find((argument) => argument.startsWith("--models="))?.slice("--models=".length);
	const selected = only ? new Set(only.split(",").filter(Boolean)) : null;
	const runTargets = selected ? targets.filter((target) => selected.has(`${target.provider}/${target.model}`)) : targets;
	if (selected && runTargets.length !== selected.size) throw new Error("--models 中包含当前目录没有的模型");
	console.log("模型目录：", JSON.stringify(catalog.providers.map((provider) => ({
		provider: provider.id,
		models: provider.models.map((model) => model.id),
		unavailable: Boolean(provider.unavailable)
	}))));
	const results = [];
	for (const target of runTargets) {
		const detected = Boolean(providers.get(target.provider)?.models.some((model) => model.id === target.model));
		if (!detected) {
			results.push({ ...target, detected, called: false, error: "目录未检测到" });
			continue;
		}
		try {
			const result = await rpc("generate", {
				selection: target,
				prompt: "只回复 OK",
				maxTokens: 128
			});
			results.push({ ...target, detected, called: true, tokens: result.tokens, response: result.text.trim().slice(0, 40) });
		} catch (error) {
			results.push({ ...target, detected, called: false, error: safeError(error) });
		}
		const latest = results.at(-1);
		console.log("调用进度：", `${target.provider}/${target.model} ${latest.called ? "成功" : `失败：${latest.error}`}`);
	}
	const failed = results.filter((result) => !result.called);
	console.log("调用汇总：", JSON.stringify({
		total: results.length,
		detected: results.filter((result) => result.detected).length,
		called: results.filter((result) => result.called).length,
		failed
	}));
	if (failed.length) process.exitCode = 1;
} finally {
	for (const request of pending.values()) {
		clearTimeout(request.timer);
		request.reject(new Error("smoke test stopped"));
	}
	child.kill("SIGTERM");
	await Promise.race([new Promise((done) => child.once("exit", done)), delay(2500)]);
	if (child.exitCode === null) child.kill("SIGKILL");
	rmSync(runtime, { recursive: true, force: true });
}
