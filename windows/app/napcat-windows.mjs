// Windows 安装包将此模块与共享控制台放在同一目录。
import { execFile, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { load, paths } from "./config.mjs";

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

export const killTree = (pid) => new Promise((r) => execFile("taskkill", ["/PID", String(pid), "/T", "/F"], () => r()));
const psQuote = (s) => `'${s.replace(/'/g, "''")}'`;
const runPs = (command) => new Promise((r) => execFile("powershell.exe", ["-NoProfile", "-Command", command], { windowsHide: true }, (err, out) => r(String(out ?? "").trim())));

export function openBrowser(url) {
	openDetached("cmd.exe", ["/c", "start", "", url]);
}

export function openFolder(dir) {
	openDetached("explorer.exe", [dir]);
}

function openDetached(command, args) {
	const proc = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
	proc.on("error", (e) => console.error(e.message));
	proc.unref();
}

export function createNapcatManager({ napcat, pipeLines, sys, applyAll }) {
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

	return { installNapcat, startNapcat, stopNapcat, napcatRunningExternally };
}
