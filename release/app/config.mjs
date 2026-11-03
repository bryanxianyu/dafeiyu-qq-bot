// 配置模块：data/config.json ⇄ DSH profile 配置 + NapCat WebSocket 配置
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const paths = {
	root,
	node: join(root, "runtime", "node.exe"),
	dshBin: join(root, "runtime", "dsh", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"),
	dshHome: join(root, "home"),
	profileDir: join(root, "home", "profiles", "fish"),
	dataDir: join(root, "data"),
	configFile: join(root, "data", "config.json"),
	extensionsDir: join(root, "data", "extensions"),
	napcatDir: join(root, "napcat")
};

export const DEFAULTS = {
	apiKey: "",
	model: "deepseek-v4-flash",
	owners: [],
	allowUsers: [],
	allowGroups: [],
	nicknames: ["大肥鱼"],
	groupMode: "natural",
	groupChattiness: 0.15,
	groupInitiative: "mid",
	groupCooldown: 60,
	botQQ: "",
	useBuiltinNapcat: true,
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
	if (!config.onebotToken) config.onebotToken = randomBytes(16).toString("hex");
	return config;
}

export function save(config) {
	mkdirSync(paths.dataDir, { recursive: true });
	writeFileSync(paths.configFile, JSON.stringify(config, null, 2));
}

const numbers = (v) => (Array.isArray(v) ? v : String(v ?? "").split(/[,，\s]+/)).map(Number).filter((n) => Number.isInteger(n) && n > 0);
const strings = (v) => (Array.isArray(v) ? v : String(v ?? "").split(/[,，]/)).map((s) => String(s).trim()).filter(Boolean);
const clamp = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : d);

/** 合并界面提交的改动（apiKey 留空表示不改），返回新配置。 */
export function update(patch) {
	const config = load();
	for (const [k, v] of Object.entries(patch)) {
		if (!(k in DEFAULTS)) continue;
		if (k === "apiKey" && !String(v ?? "").trim()) continue;
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
	config.useBuiltinNapcat = config.useBuiltinNapcat !== false && config.useBuiltinNapcat !== "false";
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
	if (!config.apiKey) m.push("DeepSeek API Key");
	if (config.owners.length === 0) m.push("主人 QQ 号");
	if (!config.useBuiltinNapcat && !config.onebotUrl) m.push("OneBot 地址");
	return m;
}

/** YAML 是 JSON 的超集，值统一用 JSON 写，省去转义烦恼。 */
export function writeProfile(config = load()) {
	const fish = {
		onebotUrl: config.useBuiltinNapcat ? `ws://127.0.0.1:${config.onebotPort}` : config.onebotUrl,
		onebotToken: config.onebotToken,
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
		"# 自动生成：由控制台按 data/config.json 重写，请在控制台里修改",
		"- id: agent-default-model",
		"  name: \"@deepseek-ai/dsh-agent-default-model\"",
		"  config:",
		"    provider: deepseek-official",
		`    model: ${JSON.stringify(config.model)}`,
		"    reasoningEffort: high",
		"",
		"- id: fish-qq",
		"  config:",
		...Object.entries(fish).map(([k, v]) => `    ${k}: ${JSON.stringify(v)}`),
		""
	].join("\n");
	writeFileSync(join(paths.profileDir, "cordis.patch.yml"), yaml);
}

// ---------------- NapCat ----------------

/** 安装后的 NapCat.<版本>.Shell 目录（QQ.exe 和 NapCatWinBootMain.exe 所在处），没装返回 null。 */
export function napcatShellDir() {
	if (!existsSync(paths.napcatDir)) return null;
	const dirs = readdirSync(paths.napcatDir, { withFileTypes: true })
		.filter((e) => e.isDirectory() && /^NapCat\..*\.Shell$/.test(e.name))
		.map((e) => join(paths.napcatDir, e.name))
		.sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs);
	return dirs.at(-1) ?? null;
}

/** 找 NapCat 的程序目录（…\resources\app\napcat），可能有多个版本。 */
export function napcatAppDirs(dir = paths.napcatDir, depth = 0) {
	if (depth > 7 || !existsSync(dir)) return [];
	const found = [];
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		if (!e.isDirectory()) continue;
		const p = join(dir, e.name);
		if (e.name === "napcat" && existsSync(join(p, "napcat.mjs"))) found.push(p);
		else if (!["node_modules", "static", "native", "worker", "config", "cache"].includes(e.name)) found.push(...napcatAppDirs(p, depth + 1));
	}
	return found;
}

export function writeNapcat(config = load()) {
	if (!config.useBuiltinNapcat) return 0;
	const server = {
		name: "dafeiyu",
		enable: true,
		host: "127.0.0.1",
		port: config.onebotPort,
		messagePostFormat: "array",
		reportSelfMessage: false,
		token: config.onebotToken,
		enableForcePushEvent: true,
		debug: false,
		heartInterval: 30000
	};
	const dirs = napcatAppDirs().map((d) => join(d, "config"));
	for (const dir of dirs) {
		mkdirSync(dir, { recursive: true });
		// WebUI 默认监听所有网卡且口令很短：只允许本机访问；填了机器人号就自动登录
		const webuiFile = join(dir, "webui.json");
		if (existsSync(webuiFile)) {
			try {
				const webui = JSON.parse(readFileSync(webuiFile, "utf8"));
				webui.host = "127.0.0.1";
				webui.autoLoginAccount = config.botQQ ? String(config.botQQ) : "";
				writeFileSync(webuiFile, JSON.stringify(webui, null, 4));
			} catch {}
		}
		// onebot11.json 是新账号的默认配置；已登录过的账号有自己的 onebot11_<QQ号>.json，一并修正
		const files = readdirSync(dir).filter((f) => /^onebot11(_\d+)?\.json$/.test(f));
		if (!files.includes("onebot11.json")) files.push("onebot11.json");
		for (const f of files) {
			const p = join(dir, f);
			let cfg = {};
			try {
				cfg = JSON.parse(readFileSync(p, "utf8"));
			} catch {}
			cfg.network ??= {};
			for (const k of ["httpServers", "httpSseServers", "httpClients", "websocketServers", "websocketClients", "plugins"]) cfg.network[k] ??= [];
			cfg.network.websocketServers = [...cfg.network.websocketServers.filter((s) => s.name !== "dafeiyu"), server];
			cfg.musicSignUrl ??= "";
			cfg.enableLocalFile2Url ??= false;
			cfg.parseMultMsg ??= false;
			writeFileSync(p, JSON.stringify(cfg, null, 2));
		}
	}
	return dirs.length;
}

/** 最新的登录二维码图片路径。 */
export function napcatQrcode() {
	let best = null;
	for (const d of napcatAppDirs()) {
		const p = join(d, "cache", "qrcode.png");
		if (existsSync(p) && (!best || statSync(p).mtimeMs > best.mtime)) best = { path: p, mtime: statSync(p).mtimeMs };
	}
	return best;
}

export function applyAll(config = load()) {
	save(config); // 落盘自动生成的 token
	writeProfile(config);
	return writeNapcat(config);
}
