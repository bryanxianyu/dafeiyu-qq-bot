// 心智系统端到端测试：TEST_KEY=sk-... node mind-test.mjs <解压目录>
// 1 人格卡 + 绝对记忆进入锚定通道 → 2 改卡不用 /重置 立即生效 → 3 对话自动整理成长期记忆
// → 4 /重置 清空会话后靠长期记忆想起 → 5 被想起的记忆得到加固
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";

const root = process.argv[2];
const require = createRequire(process.env.USERPROFILE + "/.dsh/profiles/node_modules/");
const { WebSocketServer } = require("ws");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("[test]", ...a);
let failures = 0;
const check = (name, ok, detail = "") => {
	if (!ok) failures++;
	log(`${ok ? "✅" : "❌"} ${name}${detail ? "：" + detail : ""}`);
};

// ---- 假 QQ ----
const wss = new WebSocketServer({ port: 3901 });
let sock;
let waiter;
wss.on("connection", (ws) => {
	sock = ws;
	ws.on("message", (raw) => {
		const req = JSON.parse(raw);
		ws.send(JSON.stringify({ status: "ok", retcode: 0, data: { message_id: 1 }, echo: req.echo }));
		const text = req.params.message.filter((s) => s.type === "text").map((s) => s.data.text).join("");
		waiter?.(text);
	});
});
let mid = 100;
async function say(text) {
	for (let i = 0; i < 60 && !sock; i++) await sleep(500);
	const reply = new Promise((r) => {
		waiter = r;
		setTimeout(() => r("（超时）"), 120000);
	});
	sock.send(JSON.stringify({ post_type: "message", message_type: "private", self_id: 99999, user_id: 10001, message_id: ++mid, sender: { nickname: "阿青" }, message: text }));
	const r = await reply;
	log(`  主人：${text}\n          鱼：${r}`);
	return r;
}

// ---- 控制台 ----
const server = spawn(join(root, "runtime", "node.exe"), ["app/server.mjs", "--no-open"], { cwd: root, env: { ...process.env, FISH_PORT: "5199" } });
let out = "";
server.stdout.on("data", (d) => (out += d));
server.stderr.on("data", (d) => (out += d));
await sleep(2500);
const port = out.match(/127\.0\.0\.1:(\d+)/)?.[1];
if (port !== "5199") {
	console.error("测试控制台没起在 5199，拒绝继续（防止误连正在运行的实例）：\n" + out);
	process.exit(2);
}
const base = `http://127.0.0.1:${port}`;
const token = (await (await fetch(base + "/")).text()).match(/FISH_TOKEN = "(\w+)"/)[1];
const api = async (path, body) =>
	(await fetch(base + path, { method: body === undefined ? "GET" : "POST", headers: { "X-Fish-Token": token, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })).json();

try {
	const card = (style, absolute) => ({
		defaultCard: "c1",
		bindings: {},
		cards: [{ id: "c1", name: "泡泡", identity: "你是一条叫“泡泡”的金鱼，住在主人的电脑里。", personality: "温柔、话少", style, rules: "", examples: "", absolute }]
	});
	await api("/api/mind/cards", card("每句话结尾都必须带上“咕噜”两个字。", [{ text: "主人的名字叫阿青，是一名插画师。" }]));
	await api("/api/config", { apiKey: process.env.TEST_KEY, owners: "10001", useBuiltinNapcat: false, onebotUrl: "ws://127.0.0.1:3901", memoryExtractEvery: 3 });

	log("—— 1. 锚定通道：人格卡 + 绝对记忆");
	let r = await say("你是谁？主人是做什么的？一句话");
	check("人格卡生效（泡泡/咕噜）", /泡泡/.test(r) && /咕噜/.test(r));
	check("绝对记忆生效（插画）", /插画/.test(r));

	log("—— 2. 改卡不用 /重置，下一句就生效");
	await api("/api/mind/cards", card("每句话结尾都必须带上“喵”字，不要再说咕噜。", [{ text: "主人的名字叫阿青，是一名插画师。" }]));
	r = await say("随便跟我说一句话");
	check("新风格立即生效（喵）", /喵/.test(r) && !/咕噜/.test(r));

	log("—— 3. 对话 → 自动整理成长期记忆（每 3 轮一次）");
	await say("跟你说，我养了一只叫豆包的柯基，三岁了");
	await say("我最讨厌吃香菜，闻到就难受");
	await say("下周三我要去杭州出差两天");
	let mem;
	for (let i = 0; i < 40; i++) {
		mem = await api("/api/mind/memories");
		if (mem.memories.some((m) => /豆包/.test(m.text))) break;
		await sleep(1500);
	}
	check("整理出长期记忆（豆包）", mem.memories.some((m) => /豆包/.test(m.text)), `${mem.memories.length} 条`);
	for (const m of mem.memories) log(`  · [${m.scope}] ${m.text}  重要度${m.importance} 清晰度${Math.round(m.r * 100)}% S=${m.stability}天`);

	log("—— 4. /重置 清空会话后，靠长期记忆想起");
	await say("/重置");
	const before = mem.memories.find((m) => /豆包/.test(m.text));
	r = await say("我家狗叫什么名字？一句话");
	check("想起狗的名字（豆包）", /豆包/.test(r));
	r = await say("我有什么不爱吃的东西吗？一句话");
	check("想起忌口（香菜）", /香菜/.test(r));

	log("—— 5. 被想起的记忆得到加固");
	mem = await api("/api/mind/memories");
	const after = mem.memories.find((m) => m.id === before?.id);
	check("复习次数增加、稳定度上升", after && after.reviews > before.reviews && after.stability > before.stability, after ? `想起 ${before.reviews}→${after.reviews} 次，S ${before.stability}→${after.stability.toFixed(2)} 天` : "找不到");

	log("—— 6. 遗忘：把一条记忆的上次复习时间改到很久以前，清晰度应接近 0");
	const preview = await api("/api/mind/preview", { chat: "private:10001", userId: 10001, text: "杭州出差" });
	check("预览接口返回锚定文本", preview.anchor.includes("喵") && preview.anchor.includes("阿青"));
	log(`  stats: ${JSON.stringify(mem.stats)}`);
} catch (e) {
	failures++;
	log("异常：", e.stack);
} finally {
	const L = async (src) => (await api(`/api/logs?source=${src}&after=0`)).lines.map((l) => l.text).filter((t) => !t.startsWith("[llm")).slice(-15).join("\n");
	if (failures) log("控制台日志：\n" + (await L("system")) + "\n大肥鱼日志：\n" + (await L("fish")));
	await api("/api/fish/stop", {});
	server.kill();
	wss.close();
	log(failures ? `❌ ${failures} 项失败` : "✅ 全部通过");
	process.exit(failures ? 1 : 0);
}
