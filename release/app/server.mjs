// 大肥鱼控制台：本地网页 GUI + 进程管理（NapCat、大肥鱼）。只监听 127.0.0.1。
//   runtime\node.exe app\server.mjs [--no-open]
import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { DEFAULTS, applyAll, load, missing, napcatQrcode, napcatShellDir, paths, update } from "./config.mjs";
/** 只有控制台自己用的设置：改了不用重启大肥鱼 */
const CONSOLE_ONLY = new Set(["autoStart", "stickerReview", "stickerDailyLabel", "stickerMax", "stickerWebDaily", "memoryEnabled", "memoryExtractEvery", "memoryBudget", "memoryTopK", "memoryForgetBelow"]);
import { Mind } from "./mind.mjs";
import { Stickers } from "./stickers.mjs";

const LAUNCHER_HINT = process.env.FISH_LAUNCHER_PID ? "（在右下角托盘运行）" : "（这个窗口别关，关掉大肥鱼就下线了）";
const VERSION = JSON.parse(readFileSync(join(paths.profileDir, "node_modules", "dsh-fish", "package.json"), "utf8")).version;
const WEB = join(paths.root, "app", "web");
const TOKEN = randomBytes(16).toString("hex");
/** 插件 → 控制台的内部接口口令（只通过环境变量传给大肥鱼进程） */
const INTERNAL = randomBytes(16).toString("hex");
/** 托盘程序（大肥鱼.exe）用来让控制台体面退出的口令 */
const ADMIN = process.env.FISH_ADMIN_TOKEN || "";
const NO_OPEN = process.argv.includes("--no-open") || process.env.FISH_NO_OPEN === "1";

// ---------------- 日志 ----------------
const logs = { fish: [], napcat: [], system: [] };
let logSeq = 0;
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
function pushLog(source, text) {
	for (const line of stripAnsi(String(text)).split(/\r?\n/)) {
		if (!line.trim()) continue;
		logs[source].push({ seq: ++logSeq, text: line });
		if (logs[source].length > 1000) logs[source].shift();
		if (source === "fish") watchFishLine(line);
		if (source === "napcat") watchNapcatLine(line);
	}
}
/** 扫码后被腾讯拒绝（风控、冻结等）时，NapCat 只写日志：把原因摘出来给登录窗口和网页看 */
function watchNapcatLine(line) {
	if (/二维码已被扫描/.test(line)) napcat.loginError = ""; // 重新扫了，旧的失败原因作废
	if (!/Login Error/i.test(line)) return;
	const m = line.match(/"message":"((?:[^"\\]|\\.)*)"/);
	if (!m || !m[1]) return; // 没有说明的（如二维码过期）NapCat 会自己换新码
	const code = line.match(/"serverErrorCode":(\d+)/);
	napcat.loginError = `${m[1]}${code ? `（错误码 ${code[1]}）` : ""}`;
	sys(`QQ 登录被拒绝：${napcat.loginError}`);
}
const sys = (msg) => {
	const line = `[${new Date().toLocaleTimeString("zh-CN", { hour12: false })}] ${msg}`;
	pushLog("system", line);
	console.log(line);
};

/** NapCat 输出 UTF-8，安装器可能是 GBK：先按 UTF-8 严格解码，失败再按 GBK。 */
function decodeSmart(buf) {
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(buf);
	} catch {
		try {
			return new TextDecoder("gbk").decode(buf);
		} catch {
			return buf.toString("latin1");
		}
	}
}
function pipeLines(stream, source) {
	let rest = Buffer.alloc(0);
	stream.on("data", (chunk) => {
		const buf = Buffer.concat([rest, chunk]);
		const cut = buf.lastIndexOf(0x0a);
		if (cut < 0) {
			rest = buf;
			return;
		}
		pushLog(source, decodeSmart(buf.subarray(0, cut + 1)));
		rest = buf.subarray(cut + 1);
	});
	stream.on("end", () => rest.length && pushLog(source, decodeSmart(rest)));
}

const killTree = (pid) => new Promise((r) => execFile("taskkill", ["/PID", String(pid), "/T", "/F"], () => r()));
const psQuote = (s) => `'${s.replace(/'/g, "''")}'`;
const runPs = (command) => new Promise((r) => execFile("powershell.exe", ["-NoProfile", "-Command", command], { windowsHide: true }, (err, out) => r(String(out ?? "").trim())));

// ---------------- 大肥鱼进程 ----------------
const fish = { proc: null, want: false, status: "stopped", connected: false, crashes: [], lastError: "" };

/** 今天的活动统计（首页用），按日志行数出来，跨天清零 */
const today = { date: "", received: 0, replied: 0, lurked: 0, stickers: 0, lastReply: 0 };
function countActivity(line) {
	const d = new Date().toLocaleDateString("zh-CN");
	if (today.date !== d) Object.assign(today, { date: d, received: 0, replied: 0, lurked: 0, stickers: 0 });
	if (/ (group|private):\d+ <- /.test(line)) today.received++;
	else if (/ (group|private):\d+ -> （潜水/.test(line)) today.lurked++;
	else if (/ (group|private):\d+ -> \[表情包\]/.test(line)) today.stickers++;
	else if (/ (group|private):\d+ -> /.test(line)) {
		today.replied++;
		today.lastReply = Date.now();
	}
}

function watchFishLine(line) {
	countActivity(line);
	if (line.includes("已连上 QQ")) fish.connected = true;
	if (line.includes("QQ 连接断开")) fish.connected = false;
	if (/Error|error:|呛水/.test(line)) fish.lastError = line.slice(0, 300);
}

function startFish() {
	if (fish.proc) return;
	const config = load();
	const need = missing(config);
	if (need.length) {
		sys(`还不能启动大肥鱼，缺少：${need.join("、")}`);
		return;
	}
	applyAll(config);
	fish.want = true;
	fish.status = "starting";
	fish.connected = false;
	fish.lastError = "";
	sys("启动大肥鱼");
	const proc = spawn(paths.node, [paths.dshBin, "--profile", "fish"], {
		cwd: paths.dataDir,
		windowsHide: true,
		env: {
			...process.env,
			DSH_HOME: paths.dshHome,
			DSH_TELEMETRY_DISABLED: "1",
			DEEPSEEK_API_KEY: config.apiKey,
			FISH_MIND_URL: `http://127.0.0.1:${port}`,
			FISH_MIND_TOKEN: INTERNAL,
			FISH_PARENT_PID: String(process.pid),
			Path: `${join(paths.root, "runtime")};${process.env.Path ?? process.env.PATH ?? ""}`
		}
	});
	fish.proc = proc;
	pipeLines(proc.stdout, "fish");
	pipeLines(proc.stderr, "fish");
	proc.on("spawn", () => (fish.status = "running"));
	proc.on("exit", (code) => {
		fish.proc = null;
		fish.connected = false;
		fish.status = "stopped";
		if (!fish.want) return;
		const now = Date.now();
		fish.crashes = [...fish.crashes.filter((t) => now - t < 60000), now];
		if (fish.crashes.length >= 5) {
			fish.want = false;
			fish.status = "crashed";
			sys(`大肥鱼 1 分钟内崩溃了 ${fish.crashes.length} 次，已停止自动重启。看看日志里的报错。`);
			return;
		}
		sys(`大肥鱼退出了（退出码 ${code}），5 秒后自动重启`);
		setTimeout(() => fish.want && startFish(), 5000);
	});
}

async function stopFish() {
	fish.want = false;
	const proc = fish.proc;
	if (proc) {
		sys("停止大肥鱼");
		// 等进程真正退出，否则紧接着的 startFish 会以为它还在
		const exited = new Promise((r) => {
			proc.once("exit", r);
			setTimeout(r, 8000);
		});
		await killTree(proc.pid);
		await exited;
		fish.proc = null;
	}
	fish.status = "stopped";
	fish.connected = false;
}

// ---------------- NapCat ----------------
const napcat = { proc: null, status: "stopped", installing: false, login: null, external: false };

async function napcatRunningExternally() {
	const out = await runPs(`@(Get-Process NapCatWinBootMain,QQ -ErrorAction SilentlyContinue | Where-Object { $_.Path -like (${psQuote(paths.napcatDir)} + '\\*') }).Count`);
	return Number(out) > 0;
}

async function installNapcat() {
	if (napcatShellDir() || napcat.installing) return;
	napcat.installing = true;
	napcat.status = "installing";
	sys("首次运行：安装 NapCat（从腾讯官方下载 QQ，约 200MB，请耐心等待）");
	await new Promise((done) => {
		const proc = spawn(join(paths.napcatDir, "NapCatInstaller.exe"), [], { cwd: paths.napcatDir, windowsHide: true });
		pipeLines(proc.stdout, "napcat");
		pipeLines(proc.stderr, "napcat");
		proc.on("exit", done);
		proc.on("error", (e) => {
			sys(`NapCat 安装器启动失败：${e.message}`);
			done();
		});
	});
	// 安装器留下的下载文件（QQ 安装包约 300MB）用完即删
	for (const f of ["QQ.exe", "NapCat.Shell.zip"]) rmSync(join(paths.napcatDir, f), { force: true });
	const shell = napcatShellDir();
	if (shell && !existsSync(join(shell, "NapCatWinBootMain.exe"))) cpSync(join(paths.napcatDir, "bootmain"), shell, { recursive: true });
	napcat.installing = false;
	napcat.status = "stopped";
	sys(shell ? "NapCat 安装完成" : "NapCat 安装失败：检查网络后在「运行状态」页点「安装 NapCat」重试");
}

async function startNapcat() {
	const config = load();
	if (!config.useBuiltinNapcat || napcat.proc || napcat.installing) return;
	if (!napcatShellDir()) await installNapcat();
	const shell = napcatShellDir();
	if (!shell) return;
	if (await napcatRunningExternally()) {
		napcat.external = true;
		napcat.status = "running";
		sys("NapCat 已经在运行（由之前的窗口启动）");
		return;
	}
	applyAll(config);
	sys(config.botQQ ? `启动 NapCat（自动登录 ${config.botQQ}）` : "启动 NapCat（需要扫码登录）");
	const proc = spawn(join(shell, "NapCatWinBootMain.exe"), config.botQQ ? [config.botQQ] : [], { cwd: shell, windowsHide: true });
	napcat.proc = proc;
	napcat.startedAt = Date.now();
	napcat.loginError = "";
	napcat.external = false;
	napcat.status = "running";
	pipeLines(proc.stdout, "napcat");
	pipeLines(proc.stderr, "napcat");
	proc.on("exit", (code) => {
		if (napcat.proc === proc) {
			napcat.proc = null;
			// 启动器拉起 QQ 后自己可能先退出，QQ 进程还在就仍算运行中
			napcatRunningExternally().then((alive) => {
				napcat.external = alive;
				napcat.status = alive ? "running" : "stopped";
				if (!alive) sys(`NapCat 退出了（退出码 ${code}）`);
			});
		}
	});
}

async function stopNapcat() {
	sys("停止 NapCat");
	if (napcat.proc) await killTree(napcat.proc.pid);
	napcat.proc = null;
	await runPs(`Get-Process NapCatWinBootMain,QQ -ErrorAction SilentlyContinue | Where-Object { $_.Path -like (${psQuote(paths.napcatDir)} + '\\*') } | Stop-Process -Force`);
	napcat.status = "stopped";
	napcat.external = false;
	napcat.login = null;
}

/** 通过 OneBot 查询机器人登录状态。 */
function pollLogin() {
	const config = load();
	if (napcat.status !== "running" || !config.useBuiltinNapcat) {
		napcat.login = null;
		return;
	}
	let ws;
	const timer = setTimeout(() => ws?.close(), 3000);
	try {
		ws = new WebSocket(`ws://127.0.0.1:${config.onebotPort}/?access_token=${config.onebotToken}`);
	} catch {
		return;
	}
	ws.onopen = () => ws.send(JSON.stringify({ action: "get_login_info", params: {}, echo: "gui" }));
	ws.onmessage = (e) => {
		const d = JSON.parse(e.data);
		if (d.echo === "gui") {
			napcat.login = d.data?.user_id ? { uin: d.data.user_id, nickname: d.data.nickname } : null;
			clearTimeout(timer);
			ws.close();
		}
	};
	ws.onerror = () => (napcat.login = null);
}
setInterval(pollLogin, 4000);

// ---------------- 扩展 ----------------
const readJson = (p, d) => {
	try {
		return JSON.parse(readFileSync(p, "utf8"));
	} catch {
		return d;
	}
};
function extDir(id) {
	if (!/^[\w.-]+$/.test(id)) return null;
	const dir = join(paths.extensionsDir, id);
	return existsSync(join(dir, "manifest.json")) ? dir : null;
}
function listExtensions() {
	if (!existsSync(paths.extensionsDir)) return [];
	return readdirSync(paths.extensionsDir, { withFileTypes: true })
		.filter((e) => e.isDirectory() && existsSync(join(paths.extensionsDir, e.name, "manifest.json")))
		.map((e) => {
			const m = readJson(join(paths.extensionsDir, e.name, "manifest.json"), {});
			return {
				id: e.name,
				name: m.name || e.name,
				type: m.type || "other",
				version: m.version || "",
				description: m.description || "",
				enabled: m.enabled !== false,
				panel: m.panel && existsSync(join(paths.extensionsDir, e.name, m.panel)) ? m.panel : null
			};
		});
}

// ---------------- 心智（人格卡 + 记忆） ----------------
const mind = new Mind({ dataDir: paths.dataDir, getConfig: load, log: sys });

function mindApi(p, method, body) {
	if (p === "/api/mind/cards") return method === "POST" ? mind.saveCards(body) : mind.cards;
	if (p === "/api/mind/memories") return mind.listMemories();
	if (p === "/api/mind/preview" && method === "POST") return { anchor: mind.anchor(body.chat || "private:0"), recall: mind.recall(body.chat || "private:0", body.userId, body.text || "") };
	if (method !== "POST") return undefined;
	// 运行状态页的快捷切换：chat 为 "default" 时改默认卡
	if (p === "/api/mind/switch") {
		const r = body.chat === "default" ? mind.setDefaultCard(body.card) : mind.switchCard(body.chat, body.card);
		if (r.ok) sys(`${body.chat === "default" ? "默认" : body.chat} 切换人格卡：${r.card.name}`);
		return { ...r, cards: mind.cards };
	}
	const [, , , kind, mid, action] = p.split("/");
	if (kind === "memory" && mid === "add") return { ok: mind.addMemory(body) };
	if (kind === "memory" && action === "edit") return { ok: mind.editMemory(mid, body) };
	if (kind === "memory" && action === "delete") return { ok: (mind.deleteMemory(mid), true) };
	if (kind === "memory" && action === "pin") return { ok: mind.pinMemory(mid) };
	if (kind === "archive" && action === "restore") return { ok: mind.restoreMemory(mid) };
	if (kind === "pending" && action === "approve") return { ok: mind.resolvePending(mid, true, body.text) };
	if (kind === "pending" && action === "reject") return { ok: mind.resolvePending(mid, false) };
	return undefined;
}

// ---------------- 表情包 ----------------
const stickers = new Stickers({ dataDir: paths.dataDir, getConfig: load, log: sys });

async function stickerApi(p, method, body) {
	if (p === "/api/stickers") return stickers.list();
	if (method !== "POST") return undefined;
	if (p === "/api/stickers/upload") return stickers.upload(body.data, body.name);
	if (p === "/api/stickers/try") return { ranked: stickers.rank(String(body.query ?? "")) };
	const [, , , sid, action] = p.split("/");
	if (action === "approve") return { ok: stickers.approve(sid) };
	if (action === "reject") return { ok: stickers.reject(sid) };
	if (action === "delete") return { ok: stickers.remove(sid) };
	if (action === "edit") return { ok: stickers.edit(sid, body) };
	return undefined;
}

/** 空间：发帖记录由大肥鱼进程写在 data/qzone.json，这里只读 */
const qzoneState = () => readJson(join(paths.dataDir, "qzone.json"), { history: [], draft: null, lastError: "" });

// ---------------- 状态 ----------------
function state() {
	const config = load();
	const { apiKey, onebotToken, ...rest } = config;
	const qr = napcatQrcode();
	return {
		version: VERSION,
		config: { ...rest, apiKeySet: Boolean(apiKey), apiKeyTail: apiKey ? apiKey.slice(-4) : "" },
		missing: missing(config),
		pathWarning: /[^\x00-\x7F]| /.test(paths.root) ? paths.root : "",
		fish: { status: fish.status, connected: fish.connected, lastError: fish.lastError },
		napcat: {
			enabled: config.useBuiltinNapcat,
			installed: Boolean(napcatShellDir()),
			status: napcat.status,
			login: napcat.login,
			loginError: napcat.login ? "" : napcat.loginError || "",
			qrcode: qr ? qr.mtime : 0
		},
		today: { ...today, stickerTokens: stickers.usage.date === new Date().toISOString().slice(0, 10) ? stickers.usage.tokens : 0, persona: mind.cards.cards.find((c) => c.id === mind.cards.defaultCard)?.name ?? "" },
		extensions: listExtensions().filter((e) => e.enabled).length,
		stickerPending: stickers.items.filter((i) => i.status === "pending").length,
		pending: mind.pending.length
	};
}

// ---------------- HTTP ----------------
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".ico": "image/x-icon" };
/** FISH_PORT：指定端口并跳过“已有实例就转交”（测试用，避免连到正在运行的那份） */
const FIXED_PORT = Number(process.env.FISH_PORT) || 0;
let port = FIXED_PORT || 5140;

const send = (res, code, body, type = "application/json; charset=utf-8") => {
	res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
	res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const readBody = (req) => new Promise((r) => {
	let s = "";
	req.on("data", (c) => (s += c));
	req.on("end", () => {
		try {
			r(s ? JSON.parse(s) : {});
		} catch {
			r({});
		}
	});
});
/** 只在目录内取文件，防路径穿越。 */
function safeFile(base, rel) {
	const p = resolve(base, normalize(rel).replace(/^([/\\])+/, ""));
	return p.startsWith(resolve(base) + sep) && existsSync(p) ? p : null;
}

async function handle(req, res) {
	// 防 DNS rebinding：只认本机地址
	if (!new Set([`127.0.0.1:${port}`, `localhost:${port}`]).has(req.headers.host)) return send(res, 403, { error: "forbidden" });
	const url = new URL(req.url, `http://127.0.0.1:${port}`);
	const p = url.pathname;

	if (p === "/" || p === "/index.html") {
		return send(res, 200, readFileSync(join(WEB, "index.html"), "utf8").replace("__TOKEN__", TOKEN), MIME[".html"]);
	}
	if (p === "/sdk.js" || p === "/sdk.css" || p === "/style.css" || p === "/app.js" || p === "/mind.js" || p === "/fun.js") {
		return send(res, 200, readFileSync(join(WEB, p.slice(1))), MIME[extname(p)]);
	}
	if (p === "/api/ping") return send(res, 200, { app: "dafeiyu" });
	if (p.startsWith("/ext/")) {
		const [, , id, ...rest] = p.split("/");
		const dir = extDir(decodeURIComponent(id));
		const file = dir && safeFile(dir, decodeURIComponent(rest.join("/")));
		if (!file || !MIME[extname(file)]) return send(res, 404, { error: "not found" });
		return send(res, 200, readFileSync(file), MIME[extname(file)]);
	}
	// 表情图片：<img> 带不了请求头，用查询参数里的 token
	if (p.startsWith("/sticker-img/")) {
		if (url.searchParams.get("t") !== TOKEN) return send(res, 401, { error: "unauthorized" });
		const item = stickers.find(decodeURIComponent(p.slice("/sticker-img/".length)));
		if (!item || !existsSync(stickers.path(item))) return send(res, 404, { error: "not found" });
		return send(res, 200, readFileSync(stickers.path(item)), item.mime);
	}
	if (p.startsWith("/internal/stickers/") && req.method === "POST") {
		if (req.headers["x-fish-internal"] !== INTERNAL) return send(res, 401, { error: "unauthorized" });
		const b = await readBody(req);
		if (p === "/internal/stickers/collect") {
			// 看图要几秒，不让大肥鱼等
			stickers.collect(b).then((r) => r.skipped && !["off", "busy", "daily limit", "blocked", "not a sticker"].includes(r.skipped) && sys(`表情包收集跳过：${r.skipped}`)).catch((e) => sys(`表情包收集失败：${e.message}`));
			return send(res, 200, { ok: true });
		}
		if (p === "/internal/stickers/pick") {
			// 库里有很准、最近没发过的就用库里的；只是沾边或刚发过，就去网上找张新的，找不到再退回库里勉强匹配的
			// web=true：有人明确让它去网上找，直接搜
			const strong = b.web ? null : stickers.pick(b.query, b.chat, { minScore: 0.8 });
			const sticker = strong ?? (await stickers.searchWeb(b.query, b.chat)) ?? stickers.pick(b.query, b.chat);
			return send(res, 200, { sticker });
		}
		if (p === "/internal/stickers/tags") return send(res, 200, { tags: stickers.tags() });
		return send(res, 404, { error: "not found" });
	}
	if (p.startsWith("/internal/mind/") && req.method === "POST") {
		if (req.headers["x-fish-internal"] !== INTERNAL) return send(res, 401, { error: "unauthorized" });
		const b = await readBody(req);
		if (p === "/internal/mind/anchor") return send(res, 200, { text: mind.anchor(b.chat), card: mind.cardFor(b.chat).name });
		if (p === "/internal/mind/cards") return send(res, 200, mind.cardMenu(b.chat));
		if (p === "/internal/mind/switch") {
			const r = mind.switchCard(b.chat, b.card);
			if (r.ok) sys(`${b.chat} 切换人格卡：${r.card.name}`);
			return send(res, 200, r);
		}
		if (p === "/internal/mind/recall") return send(res, 200, { text: mind.recall(b.chat, b.userId, b.text) });
		if (p === "/internal/mind/flush") {
			await mind.flush(b.chat);
			return send(res, 200, { ok: true });
		}
		if (p === "/internal/mind/observe") {
			mind.observe(b.chat, b.sender, b.text, b.reply);
			return send(res, 200, { ok: true });
		}
		return send(res, 404, { error: "not found" });
	}
	if (p === "/api/shutdown" && req.method === "POST") {
		if (!ADMIN || req.headers["x-fish-admin"] !== ADMIN) return send(res, 401, { error: "unauthorized" });
		send(res, 200, { ok: true });
		sys("收到退出指令：停止大肥鱼和 NapCat");
		await stopFish();
		if (load().useBuiltinNapcat) await stopNapcat();
		process.exit(0);
	}
	// 托盘启动器的扫码登录窗口（用启动器的管理令牌，不经过浏览器）
	if (p.startsWith("/api/launcher/")) {
		if (!ADMIN || req.headers["x-fish-admin"] !== ADMIN) return send(res, 401, { error: "unauthorized" });
		const qr = napcatQrcode();
		// 只认这次启动 NapCat 之后生成的二维码，旧文件留在磁盘上不算
		const fresh = qr && qr.mtime >= (napcat.startedAt || 0) - 2000 ? qr : null;
		if (p === "/api/launcher/login") {
			const config = load();
			return send(res, 200, {
				enabled: config.useBuiltinNapcat,
				napcat: napcat.installing ? "installing" : napcat.status,
				login: napcat.login,
				loginError: napcat.login ? "" : napcat.loginError || "",
				qrcode: !napcat.login && fresh ? fresh.mtime : 0,
				connected: fish.connected,
				botQQ: config.botQQ
			});
		}
		if (p === "/api/launcher/qrcode") return fresh ? send(res, 200, readFileSync(fresh.path), MIME[".png"]) : send(res, 404, { error: "no qrcode" });
		if (p === "/api/launcher/refresh" && req.method === "POST") {
			sys("重新获取登录二维码：重启 NapCat");
			await stopNapcat();
			await startNapcat();
			return send(res, 200, { ok: true });
		}
		return send(res, 404, { error: "not found" });
	}
	if (!p.startsWith("/api/")) return send(res, 404, { error: "not found" });
	if (req.headers["x-fish-token"] !== TOKEN) return send(res, 401, { error: "unauthorized" });

	const body = req.method === "POST" ? await readBody(req) : {};
	const ok = () => send(res, 200, state());

	if (p === "/api/state") return ok();
	if (p === "/api/logs") {
		const after = Number(url.searchParams.get("after")) || 0;
		const source = logs[url.searchParams.get("source")] ? url.searchParams.get("source") : "fish";
		return send(res, 200, { lines: logs[source].filter((l) => l.seq > after) });
	}
	if (p === "/api/config" && req.method === "POST") {
		const before = load();
		const config = update(body);
		applyAll(config);
		// 只有大肥鱼（插件）自己要读的设置变了才重启它；表情库上限、记忆参数这类控制台自己用的，改了立即生效
		const changed = Object.keys(DEFAULTS).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(config[k]));
		const needRestart = changed.some((k) => !CONSOLE_ONLY.has(k));
		sys(`配置已保存${changed.length ? `（${changed.join("、")}）` : "（没有变化）"}`);
		let restarted = false;
		if (fish.proc) {
			if (needRestart) {
				await stopFish();
				startFish();
				restarted = true;
			}
		} else if (config.autoStart && missing(config).length === 0 && fish.status !== "crashed") {
			if (config.useBuiltinNapcat) await startNapcat();
			startFish();
		}
		if (napcat.status === "running" && before.botQQ !== config.botQQ) sys("机器人 QQ 改了：重启 NapCat 后生效");
		return send(res, 200, { ...state(), restarted, changed });
	}
	if (p === "/api/napcat/qrcode") {
		const qr = napcatQrcode();
		return qr ? send(res, 200, readFileSync(qr.path), MIME[".png"]) : send(res, 404, { error: "no qrcode" });
	}
	const actions = {
		"/api/fish/start": async () => {
			fish.crashes = [];
			startFish();
		},
		"/api/fish/stop": stopFish,
		"/api/fish/restart": async () => {
			await stopFish();
			fish.crashes = [];
			startFish();
		},
		"/api/napcat/start": startNapcat,
		"/api/napcat/stop": stopNapcat,
		"/api/napcat/restart": async () => {
			await stopNapcat();
			await startNapcat();
		},
		"/api/napcat/install": installNapcat,
		"/api/open-folder": async () => {
			const target = { extensions: paths.extensionsDir, data: paths.dataDir, root: paths.root }[body.which] ?? paths.root;
			mkdirSync(target, { recursive: true });
			spawn("explorer.exe", [target], { detached: true, stdio: "ignore" }).unref();
		}
	};
	if (actions[p] && req.method === "POST") {
		actions[p]().catch((e) => sys(`操作失败：${e.message}`));
		await new Promise((r) => setTimeout(r, 300));
		return ok();
	}

	if (p === "/api/stickers" || p.startsWith("/api/stickers/")) {
		try {
			const r = await stickerApi(p, req.method, body);
			if (r !== undefined) return send(res, 200, r);
		} catch (e) {
			return send(res, 200, { error: e.message });
		}
	}
	if (p === "/api/qzone") return send(res, 200, qzoneState());
	if (p.startsWith("/api/mind/")) {
		const r = mindApi(p, req.method, body);
		if (r !== undefined) return send(res, 200, r);
	}

	const m = p.match(/^\/api\/extensions(?:\/([^/]+)\/(config|enabled))?$/);
	if (m) {
		if (!m[1]) return send(res, 200, listExtensions());
		const dir = extDir(decodeURIComponent(m[1]));
		if (!dir) return send(res, 404, { error: "no such extension" });
		if (m[2] === "config") {
			if (req.method === "POST") writeFileSync(join(dir, "config.json"), JSON.stringify(body, null, 2));
			return send(res, 200, readJson(join(dir, "config.json"), {}));
		}
		if (m[2] === "enabled" && req.method === "POST") {
			const manifest = readJson(join(dir, "manifest.json"), {});
			manifest.enabled = Boolean(body.enabled);
			writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
			sys(`扩展 ${manifest.name || m[1]} 已${manifest.enabled ? "启用" : "停用"}，重启大肥鱼后生效`);
			return send(res, 200, listExtensions());
		}
	}
	return send(res, 404, { error: "not found" });
}

// ---------------- 启动 ----------------
const openBrowser = () => !NO_OPEN && spawn("cmd.exe", ["/c", "start", "", `http://127.0.0.1:${port}/`], { detached: true, stdio: "ignore", windowsHide: true }).unref();

async function alreadyRunning(p) {
	try {
		const r = await fetch(`http://127.0.0.1:${p}/api/ping`, { signal: AbortSignal.timeout(1000) });
		return (await r.json()).app === "dafeiyu";
	} catch {
		return false;
	}
}

function listen(p) {
	return new Promise((ok, fail) => {
		const server = createServer((req, res) => handle(req, res).catch((e) => send(res, 500, { error: e.message })));
		server.once("error", fail);
		server.listen(p, "127.0.0.1", () => ok(server));
	});
}

async function main() {
	// 首次运行：把扩展模板放进 data/extensions
	const templates = join(paths.root, "app", "extensions");
	if (existsSync(templates)) {
		for (const e of readdirSync(templates, { withFileTypes: true })) {
			const dest = join(paths.extensionsDir, e.name);
			if (e.isDirectory() && !existsSync(dest)) cpSync(join(templates, e.name), dest, { recursive: true });
		}
	}
	for (; port < (FIXED_PORT ? FIXED_PORT + 1 : 5160); port++) {
		if (!FIXED_PORT && (await alreadyRunning(port))) {
			console.log(`控制台已经在运行，打开 http://127.0.0.1:${port}/`);
			openBrowser();
			setTimeout(() => process.exit(0), 500);
			return;
		}
		try {
			await listen(port);
			break;
		} catch {}
	}
	sys(`大肥鱼控制台 v${VERSION} 已启动：http://127.0.0.1:${port}/  ${LAUNCHER_HINT}`);
	openBrowser();

	const config = load();
	applyAll(config);
	if (config.useBuiltinNapcat && napcatShellDir() && (await napcatRunningExternally())) {
		napcat.status = "running";
		napcat.external = true;
	}
	if (config.autoStart && missing(config).length === 0) {
		if (config.useBuiltinNapcat) await startNapcat();
		startFish();
	} else if (missing(config).length) {
		sys(`请在浏览器里完成设置：还缺 ${missing(config).join("、")}`);
	}
}

// 关掉窗口时把子进程一起带走（NapCat 保留，避免重复扫码；下次启动会接管）
let exiting = false;
const shutdown = async () => {
	if (exiting) return;
	exiting = true;
	fish.want = false;
	if (fish.proc) await killTree(fish.proc.pid);
	process.exit(0);
};
for (const sig of ["SIGINT", "SIGHUP", "SIGTERM", "SIGBREAK"]) process.on(sig, shutdown);

// 托盘程序（大肥鱼.exe）意外消失时，控制台跟着收尾，不留无人管理的进程
const LAUNCHER = Number(process.env.FISH_LAUNCHER_PID);
if (LAUNCHER) {
	setInterval(() => {
		try {
			process.kill(LAUNCHER, 0);
		} catch {
			sys("托盘程序已退出，控制台跟着退出");
			shutdown();
		}
	}, 3000).unref();
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
