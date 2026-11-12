import { existsSync, mkdirSync, readFileSync, renameSync, statSync, watch, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const providerFields = new Set([
	"apiKeyEnv", "displayName", "api", "baseURL", "models", "modelOverrides", "reasoning", "compat",
	"requestImagePixelBudget", "requestImageMaxBytes", "maxRequestImageBytes", "defaultContextWindow",
	"defaultMaxTokens", "retryPolicy", "thinkingTokenBudgetField", "vllmPriority", "supportsMaxOutputTokens"
]);
const modelFields = new Set([
	"id", "name", "input", "contextWindow", "maxTokens", "reasoning", "reasoningEfforts", "cost", "output"
]);

function hasSecretInUrl(value) {
	try {
		const url = new URL(value);
		if (url.username || url.password) return true;
		for (const key of url.searchParams.keys()) if (/(key|token|secret|password|auth)/i.test(key)) return true;
		return false;
	} catch {
		return false;
	}
}

function safeProvider(provider) {
	if (!provider || typeof provider !== "object" || Array.isArray(provider)) return null;
	// Custom headers and inline keys can carry credentials, so do not import such routes.
	if (Object.hasOwn(provider, "headers") || Object.hasOwn(provider, "apiKey")) return null;
	if (typeof provider.baseURL === "string" && hasSecretInUrl(provider.baseURL)) return null;
	if (provider.apiKeyEnv !== undefined && !/^[A-Z][A-Z0-9_]*$/.test(provider.apiKeyEnv)) return null;
	const result = {};
	for (const [key, value] of Object.entries(provider)) {
		if (!providerFields.has(key)) continue;
		if (key === "models") {
			if (!Array.isArray(value)) return null;
			const models = value.map((model) => {
				if (!model || typeof model !== "object" || Array.isArray(model) || typeof model.id !== "string") return null;
				return Object.fromEntries(Object.entries(model).filter(([field]) => modelFields.has(field)));
			});
			if (models.some((model) => model === null)) return null;
			result.models = models;
		} else {
			result[key] = value;
		}
	}
	return result;
}

/** Read model routes from the desktop profile without reading credential values. */
export function loadDesktopModelImport(dshHome, yaml) {
	const profilePath = join(dshHome, "profiles", "desktop", "cordis.patch.yml");
	const credentialsPath = join(dshHome, ".credentials.yaml");
	let rows = [];
	if (existsSync(profilePath)) {
		try {
			rows = yaml.parse(readFileSync(profilePath, "utf8")) ?? [];
		} catch {
			throw new Error(`无法解析 DSH 桌面版模型配置：${profilePath}`);
		}
	}
	if (!Array.isArray(rows)) rows = [rows];
	const providers = {};
	const skipped = [];
	for (const row of rows) {
		if (row?.id !== "llm-pi-ai") continue;
		for (const [id, config] of Object.entries(row.config?.providers ?? {})) {
			if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
				skipped.push(id);
				continue;
			}
			const safe = safeProvider(config);
			if (safe) providers[id] = safe;
			else skipped.push(id);
		}
	}
	const hasCredentials = existsSync(credentialsPath);
	if (hasCredentials && process.platform !== "win32") {
		const mode = statSync(credentialsPath).mode & 0o777;
		if (mode & 0o077) throw new Error(`DSH 凭据文件权限过宽，请运行 chmod 600 "${credentialsPath}"`);
	}
	return {
		providers,
		providerIds: Object.keys(providers),
		skipped,
		credentialsPath: hasCredentials ? credentialsPath : ""
	};
}

/** Merge desktop routes into the fish profile while retaining its other DSH settings. */
export function syncFishProfileModelRoutes(profileDir, desktopModels, manifestPath, yaml) {
	const patchPath = join(profileDir, "cordis.patch.yml");
	const source = existsSync(patchPath) ? readFileSync(patchPath, "utf8") : "";
	let previous = [];
	if (existsSync(manifestPath)) {
		try {
			const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
			if (Array.isArray(manifest.providerIds)) previous = manifest.providerIds.filter((id) => /^[a-z0-9][a-z0-9-]*$/.test(id));
		} catch {}
	}
	const imported = desktopModels.providers ?? {};
	if (!previous.length && !Object.keys(imported).length) return false;

	const doc = yaml.parseDocument(source);
	if (doc.errors.length) throw new Error(`无法安全更新 fish profile 模型配置：${patchPath}`);
	if (doc.contents === null) doc.contents = doc.createNode([]);
	if (!yaml.isSeq(doc.contents)) throw new Error(`fish profile 配置根节点必须是列表：${patchPath}`);
	let rowIndex = doc.contents.items.findIndex((row) => row.get?.("id") === "llm-pi-ai");
	if (rowIndex < 0) {
		rowIndex = doc.contents.items.length;
		doc.contents.items.push(doc.createNode({ id: "llm-pi-ai", config: { providers: {} } }));
	}
	let providersNode = doc.getIn([rowIndex, "config", "providers"], true);
	if (providersNode === undefined || providersNode === null) {
		doc.setIn([rowIndex, "config", "providers"], {});
		providersNode = doc.getIn([rowIndex, "config", "providers"], true);
	}
	if (!yaml.isMap(providersNode)) throw new Error(`fish profile 的 llm-pi-ai.providers 必须是映射：${patchPath}`);
	for (const id of previous) providersNode.delete(id);
	const synced = [];
	for (const [id, config] of Object.entries(imported)) {
		if (providersNode.has(id)) continue;
		providersNode.set(id, config);
		synced.push(id);
	}
	const updated = doc.toString();
	if (updated !== source) {
		mkdirSync(profileDir, { recursive: true });
		const tempPath = `${patchPath}.${process.pid}.tmp`;
		writeFileSync(tempPath, updated, { mode: 0o600 });
		renameSync(tempPath, patchPath);
	}
	mkdirSync(dirname(manifestPath), { recursive: true });
	writeFileSync(manifestPath, JSON.stringify({ providerIds: synced }, null, 2), { mode: 0o600 });
	return updated !== source;
}

export function startDesktopModelSync(paths, writeFishPatch, log) {
	const desktopHome = resolve(process.env.FISH_DESKTOP_DSH_HOME || join(homedir(), ".dsh"));
	const desktopProfile = join(desktopHome, "profiles", "desktop");
	const manifest = join(paths.dataDir, "dsh-desktop-model-import.json");
	let syncTimer;
	const sync = () => {
		try {
			const yaml = createRequire(paths.dshBin)("yaml");
			const models = loadDesktopModelImport(desktopHome, yaml);
			const updated = syncFishProfileModelRoutes(paths.profileDir, models, manifest, yaml);
			const credentialsChanged = (process.env.FISH_DSH_CREDENTIALS_PATH ?? "") !== models.credentialsPath;
			process.env.FISH_DSH_CREDENTIALS_PATH = models.credentialsPath;
			if (updated || credentialsChanged) {
				writeFishPatch();
				log("已同步 DSH 桌面版模型配置");
			}
			if (models.skipped.length) log(`已跳过不适合导入的 DSH 模型路由：${models.skipped.join("、")}`);
		} catch (error) {
			log(`DSH 桌面版模型配置同步失败：${error.message}`);
		}
	};
	if (existsSync(desktopProfile) || existsSync(manifest)) sync();
	for (const directory of [desktopProfile, paths.profileDir, desktopHome]) {
		if (!existsSync(directory)) continue;
		try {
			watch(directory, { persistent: false }, (_event, filename) => {
				const watchedFile = directory === desktopHome ? ".credentials.yaml" : "cordis.patch.yml";
				if (String(filename) !== watchedFile) return;
				clearTimeout(syncTimer);
				syncTimer = setTimeout(sync, 200);
			}).on("error", (error) => log(`无法监控 DSH 配置：${error.message}`));
		} catch (error) {
			log(`无法监控 DSH 配置：${error.message}`);
		}
	}
}
