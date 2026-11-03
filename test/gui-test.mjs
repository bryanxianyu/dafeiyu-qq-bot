// 控制台端到端测试：node gui-test.mjs <解压目录>
// 起假 QQ（3901）→ 起控制台 → 通过 API 完成配置 → 对话 → 启用扩展 → 再对话 → 检查记忆文件
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("[test]", ...a);

const server = spawn(join(root, "runtime", "node.exe"), ["app/server.mjs", "--no-open"], { cwd: root, env: { ...process.env, FISH_PORT: "5199" } });
let serverOut = "";
server.stdout.on("data", (d) => (serverOut += d));
server.stderr.on("data", (d) => (serverOut += d));
await sleep(2500);
const port = serverOut.match(/127\.0\.0\.1:(\d+)/)?.[1];
if (port !== "5199") throw new Error("测试控制台没起在 5199，拒绝继续（防止误连正在运行的实例）：\n" + serverOut);
const base = `http://127.0.0.1:${port}`;
const html = await (await fetch(base + "/")).text();
const token = html.match(/FISH_TOKEN = "(\w+)"/)[1];
const api = async (path, body) => {
	const r = await fetch(base + path, {
		method: body === undefined ? "GET" : "POST",
		headers: { "X-Fish-Token": token, "Content-Type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	return r.json();
};

// 安全检查
log("无 token 访问 API:", (await fetch(base + "/api/state")).status);
const http = await import("node:http");
log("伪造 Host:", await new Promise((r) => http.get({ host: "127.0.0.1", port, path: "/api/ping", headers: { Host: "evil.com" } }, (res) => r(res.statusCode))));
log("路径穿越:", (await fetch(base + "/ext/persona-template/..%2f..%2fconfig.json")).status);

let s = await api("/api/state");
log("首次状态 missing =", s.missing, "extensions =", (await api("/api/extensions")).map((e) => `${e.id}:${e.enabled}`));

const mock = spawn(process.execPath, [join(import.meta.dirname, "mock-onebot.mjs"), "3901"], { env: { ...process.env, MOCK_GUI: "1" } });
let mockOut = "";
mock.stdout.on("data", (d) => (mockOut += d));

s = await api("/api/config", {
	apiKey: process.env.TEST_KEY,
	owners: "10001",
	allowGroups: "888",
	useBuiltinNapcat: false,
	onebotUrl: "ws://127.0.0.1:3901",
	groupMode: "mention"
});
log("保存后 missing =", s.missing, "fish =", s.fish.status, "apiKeySet =", s.config.apiKeySet, "泄露key?", JSON.stringify(s).includes(process.env.TEST_KEY));

for (let i = 0; i < 60 && !mockOut.includes("ROUND1"); i++) await sleep(1000);
log("第一轮：\n" + mockOut.split("\n").filter((l) => l.includes("send_")).join("\n"));

// 启用扩展 + 配人格卡
await api("/api/extensions/persona-template/enabled", { enabled: true });
await api("/api/extensions/memory-template/enabled", { enabled: true });
await api("/api/extensions/persona-template/config", { defaultCard: "你是一只叫“泡泡”的金鱼，每句话结尾都带“咕噜”。", bindings: [] });
await api("/api/fish/restart", {});
await sleep(8000);
for (let i = 0; i < 90 && !mockOut.includes("DONE"); i++) await sleep(1000);
log("第二轮：\n" + mockOut.split("ROUND1")[1]?.split("\n").filter((l) => l.includes("send_")).join("\n"));

const fishLog = (await api("/api/logs?source=fish&after=0")).lines.map((l) => l.text);
log("扩展加载日志：", fishLog.filter((l) => l.includes("扩展")).join(" | "));
const memDir = join(root, "data", "extensions", "memory-template", "memory");
log("记忆文件：", existsSync(memDir) ? readdirSync(memDir).map((f) => `${f} (${readFileSync(join(memDir, f), "utf8").trim().split("\n").length} 条)`) : "无");
s = await api("/api/state");
log("控制台日志：\n" + (await api("/api/logs?source=system&after=0")).lines.map((l) => l.text).join("\n"));
log("大肥鱼日志尾：\n" + fishLog.slice(-25).join("\n"));
log("最终 fish =", s.fish.status, "connected =", s.fish.connected);

await api("/api/fish/stop", {});
await sleep(1000);
server.kill();
mock.kill();
process.exit(0);
