// 配置模块：data/config.json ⇄ DSH profile 配置
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const isWindows = process.platform === "win32";
if (!isWindows && !process.env.FISH_RUNTIME_DIR) throw new Error("请通过 node macos/start.mjs 启动控制台");
export const root = isWindows
	? resolve(dirname(fileURLToPath(import.meta.url)), "..")
	: resolve(process.env.FISH_RUNTIME_DIR);
export const paths = {
	root,
	node: isWindows ? join(root, "runtime", "node.exe") : process.execPath,
	dshBin: process.env.FISH_DSH_BIN ?? join(root, "runtime", "dsh", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"),
	dshHome: join(root, "home"),
	profileDir: join(root, "home", "profiles", "fish"),
	dataDir: join(root, "data"),
	configFile: join(root, "data", "config.json"),
	extensionsDir: join(root, "data", "extensions"),
	fishPatch: join(root, "data", "fish-console.patch.yml"),
	napcatDir: join(root, "napcat")
};

export const DEFAULTS = {
	apiKey: "",
	model: "deepseek-flash",
	chatModel: "",
	memoryModel: "",
	visionModel: "",
	chatReasoningEffort: "",
	memoryReasoningEffort: "",
	visionReasoningEffort: "",
	owners: [],
	allowUsers: [],
	allowGroups: [],
	nicknames: ["大肥鱼"],
	groupMode: "natural",
	groupChattiness: 0.15,
	groupInitiative: "mid",
	groupCooldown: 60,
	botQQ: "",
	useBuiltinNapcat: isWindows,
	onebotPort: 3001,
	onebotUrl: "",
	onebotToken: "",
	persona: "",
	extensionsFile: "",
	autoStart: true,
	// 安全：工具权限（none 只聊天 / web 只能联网 / full 完整）与防刷
	toolsOwner: "full",
	toolsOthers: "none",
	rateLimit: 8,
	// 表情包
	stickerEnabled: true,
	stickerCollect: true,
	stickerReview: true,
	stickerFrequency: "mid",
	stickerDailyLabel: 30,
	stickerMax: 500,
	stickerWeb: true,
	stickerWebDaily: 20,
	// QQ 空间（默认关：非官方接口，机器人号自动发帖有风控风险）
	qzoneEnabled: false,
	qzoneConfirm: true,
	qzoneDiaryTime: "21:30",
	qzoneDailyMax: 2,
	// 长期记忆（艾宾浩斯通道）
	memoryEnabled: true,
	memoryExtractEvery: 6,
	memoryBudget: 600,
	memoryTopK: 5,
	memoryForgetBelow: 0.03
};

export function load() {
	const saved = existsSync(paths.configFile) ? JSON.parse(readFileSync(paths.configFile, "utf8")) : {};
	const config = { ...DEFAULTS, ...saved };
	config.useBuiltinNapcat = isWindows && config.useBuiltinNapcat;
	if (isWindows && !config.onebotToken) config.onebotToken = randomBytes(16).toString("hex");
	return config;
}

export function save(config) {
	mkdirSync(paths.dataDir, { recursive: true });
	writeFileSync(paths.configFile, JSON.stringify(config, null, 2));
}

const numbers = (v) => (Array.isArray(v) ? v : String(v ?? "").split(/[,，\s]+/)).map(Number).filter((n) => Number.isInteger(n) && n > 0);
const strings = (v) => (Array.isArray(v) ? v : String(v ?? "").split(/[,，]/)).map((s) => String(s).trim()).filter(Boolean);
const clamp = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);

export function parseModelRef(value) {
	if (value === "") return null;
	if (typeof value !== "string") throw new Error("模型选择无效");
	const pair = JSON.parse(value);
	if (!Array.isArray(pair) || pair.length !== 2 || pair.some((part) => typeof part !== "string" || !part.trim() || part.length > 300)) {
		throw new Error("模型选择无效");
	}
	return { provider: pair[0], model: pair[1] };
}

export function chatSelection(config) {
	const selection = parseModelRef(config.chatModel) ??
		(config.apiKey ? { provider: "deepseek-official", model: config.model, reasoningEffort: "high" } : null);
	return selection && config.chatReasoningEffort ? { ...selection, reasoningEffort: config.chatReasoningEffort } : selection;
}

/** 合并界面提交的改动（apiKey 留空表示不改），返回新配置。 */
export function update(patch) {
	const config = load();
	for (const [k, v] of Object.entries(patch)) {
		if (!(k in DEFAULTS)) continue;
		if (k === "apiKey" && !String(v ?? "").trim()) continue;
		if (["chatModel", "memoryModel", "visionModel"].includes(k)) parseModelRef(v);
		if (["chatReasoningEffort", "memoryReasoningEffort", "visionReasoningEffort"].includes(k) && (typeof v !== "string" || v.length > 80 || (v && !/^[\w.-]+$/.test(v)))) throw new Error("思考等级无效");
		config[k] = v;
	}
	config.apiKey = String(config.apiKey).trim();
	config.owners = numbers(config.owners);
	config.allowUsers = numbers(config.allowUsers);
	config.allowGroups = numbers(config.allowGroups);
	config.nicknames = strings(config.nicknames);
	if (config.nicknames.length === 0) config.nicknames = ["大肥鱼"];
	config.groupMode = config.groupMode === "mention" ? "mention" : "natural";
	config.groupInitiative = ["off", "low", "mid", "high"].includes(config.groupInitiative) ? config.groupInitiative : "mid";
	config.groupChattiness = clamp(config.groupChattiness, 0, 1, 0.15);
	config.groupCooldown = clamp(config.groupCooldown, 0, 86400, 60);
	config.toolsOwner = ["full", "web", "none"].includes(config.toolsOwner) ? config.toolsOwner : "full";
	config.toolsOthers = config.toolsOthers === "web" ? "web" : "none";
	config.rateLimit = Math.round(clamp(config.rateLimit, 0, 600, 8));
	const bool = (v) => v !== false && v !== "false";
	config.stickerEnabled = bool(config.stickerEnabled);
	config.stickerCollect = bool(config.stickerCollect);
	config.stickerReview = bool(config.stickerReview);
	config.stickerFrequency = ["low", "mid", "high"].includes(config.stickerFrequency) ? config.stickerFrequency : "mid";
	config.stickerDailyLabel = Math.round(clamp(config.stickerDailyLabel, 0, 500, 30));
	config.stickerMax = Math.round(clamp(config.stickerMax, 20, 5000, 500));
	config.stickerWeb = bool(config.stickerWeb);
	config.stickerWebDaily = Math.round(clamp(config.stickerWebDaily, 0, 200, 20));
	config.qzoneEnabled = config.qzoneEnabled === true || config.qzoneEnabled === "true";
	config.qzoneConfirm = bool(config.qzoneConfirm);
	config.qzoneDiaryTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(config.qzoneDiaryTime)) ? config.qzoneDiaryTime : "";
	config.qzoneDailyMax = Math.round(clamp(config.qzoneDailyMax, 0, 10, 2));
	config.onebotPort = clamp(config.onebotPort, 1, 65535, 3001);
	config.botQQ = String(config.botQQ ?? "").replace(/\D/g, "");
	config.useBuiltinNapcat = isWindows && config.useBuiltinNapcat !== false && config.useBuiltinNapcat !== "false";
	config.onebotToken = String(config.onebotToken ?? "").trim();
	config.autoStart = config.autoStart !== false && config.autoStart !== "false";
	config.memoryEnabled = config.memoryEnabled !== false && config.memoryEnabled !== "false";
	config.memoryExtractEvery = Math.round(clamp(config.memoryExtractEvery, 1, 50, 6));
	config.memoryBudget = Math.round(clamp(config.memoryBudget, 0, 5000, 600));
	config.memoryTopK = Math.round(clamp(config.memoryTopK, 0, 20, 5));
	config.memoryForgetBelow = clamp(config.memoryForgetBelow, 0.001, 0.5, 0.03);
	save(config);
	return config;
}

/** 还缺哪些必填项（空数组 = 可以启动）。 */
export function missing(config = load()) {
	const m = [];
	if (!isWindows && !existsSync(paths.dshBin)) m.push("DSH（运行 npm ci --prefix macos）");
	if (config.owners.length === 0) m.push("主人 QQ 号");
	if (!config.useBuiltinNapcat && !config.onebotUrl) m.push("OneBot 地址");
	return m;
}

/** YAML 是 JSON 的超集，值统一用 JSON 写，省去转义烦恼。 */
export function writeFishPatch(config = load()) {
	const selection = chatSelection(config);
	const desktopRows = [];
	if (process.env.FISH_DSH_CREDENTIALS_PATH) {
		desktopRows.push(
			"- id: credentials",
			"  config:",
			`    path: ${JSON.stringify(process.env.FISH_DSH_CREDENTIALS_PATH)}`
		);
	}
	const fish = {
		onebotUrl: missing(config).length ? "" : config.useBuiltinNapcat ? `ws://127.0.0.1:${config.onebotPort}` : config.onebotUrl,
		onebotToken: config.onebotToken,
		chatProvider: selection?.provider ?? "",
		chatModel: selection?.model ?? "",
		chatReasoningEffort: config.chatReasoningEffort || selection?.reasoningEffort || "",
		owners: config.owners,
		allowUsers: config.allowUsers,
		allowGroups: config.allowGroups,
		nicknames: config.nicknames,
		groupMode: config.groupMode,
		groupChattiness: Number(config.groupChattiness),
		groupCooldown: Number(config.groupCooldown),
		groupInitiative: config.groupInitiative,
		toolsOwner: config.toolsOwner,
		toolsOthers: config.toolsOthers,
		rateLimit: Number(config.rateLimit),
		stickerEnabled: config.stickerEnabled,
		stickerCollect: config.stickerCollect,
		stickerFrequency: config.stickerFrequency,
		stickerWeb: config.stickerWeb,
		qzoneEnabled: config.qzoneEnabled,
		qzoneConfirm: config.qzoneConfirm,
		qzoneDiaryTime: config.qzoneDiaryTime,
		qzoneDailyMax: Number(config.qzoneDailyMax),
		dataDir: paths.dataDir.replace(/\\/g, "/"),
		extensionsDir: paths.extensionsDir.replace(/\\/g, "/"),
		extensionsFile: config.extensionsFile
	};
	if (config.persona) fish.persona = config.persona;
	const yaml = [
		"# 大肥鱼控制台生成的独立覆盖层；模型路由合并在 fish profile 的 cordis.patch.yml",
		...desktopRows,
		"- id: fish-qq",
		"  config:",
		...Object.entries(fish).filter(([, value]) => value !== undefined).map(([k, v]) => `    ${k}: ${JSON.stringify(v)}`),
		""
	].join("\n");
	writeFileSync(paths.fishPatch, yaml, { mode: 0o600 });
}
