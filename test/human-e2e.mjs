// 像真人 / 主动冒泡 / 上网找表情 端到端（真模型、假 QQ）：TEST_KEY=sk-... node test/human-e2e.mjs <安装目录>
// 控制台固定 5199、假 QQ 固定 3902，绝不碰正在运行的实例。FISH_TEST_INITIATIVE=1 让“安静 10 秒就冒泡”。
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";

const [root] = process.argv.slice(2);
const require = createRequire(process.env.USERPROFILE + "/.dsh/profiles/node_modules/");
const { WebSocketServer } = require("ws");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (name, ok, detail = "") => {
	if (!ok) fail++;
	console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "：" + detail : ""}`);
};

// ---- 假 QQ ----
const outbox = [];
let sock;
let mid = 100;
const wss = new WebSocketServer({ port: 3902 });
wss.on("connection", (ws) => {
	sock = ws;
	ws.on("message", (raw) => {
		const req = JSON.parse(raw);
		if (req.action.startsWith("send_")) {
			const segs = req.params.message;
			outbox.push({ at: Date.now(), to: req.params.group_id ?? req.params.user_id, quoted: segs.some((s) => s.type === "reply"), image: segs.some((s) => s.type === "image"), text: segs.filter((s) => s.type === "text").map((s) => s.data.text).join("") });
		}
		ws.send(JSON.stringify({ status: "ok", retcode: 0, data: { message_id: ++mid }, echo: req.echo }));
	});
});
const group = (uid, card, text, at = false) => {
	const t = Date.now();
	sock.send(JSON.stringify({ post_type: "message", message_type: "group", self_id: 99999, group_id: 888, user_id: uid, message_id: ++mid, time: t / 1000, sender: { card },
		message: [...(at ? [{ type: "at", data: { qq: "99999" } }] : []), { type: "text", data: { text: (at ? " " : "") + text } }] }));
	return t;
};
async function waitFor(pred, ms = 90000) {
	const start = outbox.length;
	for (let t = 0; t < ms; t += 300) {
		if (outbox.slice(start).some(pred)) {
			await sleep(6000); // 等后面连发的几条 / 表情
			return outbox.slice(start);
		}
		await sleep(300);
	}
	return outbox.slice(start);
}
const show = (msgs) => msgs.map((m) => `${m.quoted ? "[引用]" : ""}${m.image ? "[图]" : ""}${m.text}`).join(" ｜ ");

// ---- 控制台 ----
const server = spawn(join(root, "runtime", "node.exe"), ["app/server.mjs", "--no-open"], { cwd: root, env: { ...process.env, FISH_PORT: "5199", FISH_TEST_INITIATIVE: "1" } });
let out = "";
server.stdout.on("data", (d) => (out += d));
server.stderr.on("data", (d) => (out += d));
await sleep(3000);
if (!out.includes("127.0.0.1:5199")) throw new Error("控制台没起在 5199，停止");
const base = "http://127.0.0.1:5199";
const token = (await (await fetch(base + "/")).text()).match(/FISH_TOKEN = "(\w+)"/)[1];
const api = async (p, b) => (await fetch(base + p, { method: b ? "POST" : "GET", headers: { "X-Fish-Token": token, "Content-Type": "application/json" }, body: b && JSON.stringify(b) })).json();

try {
	await api("/api/config", {
		apiKey: process.env.TEST_KEY, owners: "10001", allowGroups: "888", useBuiltinNapcat: false, onebotUrl: "ws://127.0.0.1:3902",
		groupMode: "natural", groupChattiness: 0, groupInitiative: "mid", stickerFrequency: "high", stickerWeb: true, stickerCollect: false
	});
	for (let i = 0; i < 60 && !sock; i++) await sleep(1000);
	check("大肥鱼连上假 QQ", Boolean(sock));
	await sleep(2000);

	// 1. @ 它：要有打字延迟；没人插话就不引用
	let t0 = group(30006, "小紫", "今天好无聊啊，干点啥好", true);
	let got = (await waitFor((m) => m.to === 888)).filter((m) => m.to === 888);
	check("被 @ 会回", got.length > 0, show(got));
	check("回复不是秒回（有打字时间）", got.length > 0 && got[0].at - t0 >= 600, `${got[0] ? got[0].at - t0 : "-"}ms`);
	check("没人插话时不引用原消息", got.length > 0 && !got[0].quoted);

	// 2. 刚聊完，接一句不 @ 的：也要被看到（话多程度是 0，正常不会看）
	group(30006, "小紫", "你倒是说句话啊");
	got = (await waitFor((m) => m.to === 888, 40000)).filter((m) => m.to === 888);
	const logs1 = (await api("/api/logs?source=fish&after=0")).lines.map((l) => l.text);
	check("刚聊完时接着说的话会被看到", logs1.some((l) => l.includes("你倒是说句话啊（旁观）")), show(got));

	// 3. 让它上网找表情
	group(30007, "老王", "去网上给我找个熊猫头的表情包", true);
	got = (await waitFor((m) => m.to === 888 && m.image, 90000)).filter((m) => m.to === 888);
	const logs2 = (await api("/api/logs?source=fish&after=0")).lines.map((l) => l.text);
	check("让它上网找表情 → 真去网上找并发了图", got.some((m) => m.image) && logs2.some((l) => l.includes("去网上找")), show(got));

	// 4. 等“接着聊”的窗口过去（测试模式 20 秒），群友随便说一句它不接的话，然后安静 → 主动冒泡
	await sleep(22000);
	group(30008, "小秦", "今天中午吃的黄焖鸡，还行");
	await sleep(1000);
	const before = outbox.length;
	got = [];
	for (let t = 0; t < 90000 && got.length === 0; t += 1000) {
		await sleep(1000);
		got = outbox.slice(before).filter((m) => m.to === 888);
	}
	await sleep(6000);
	got = outbox.slice(before).filter((m) => m.to === 888);
	const logs3 = (await api("/api/logs?source=fish&after=0")).lines.map((l) => l.text);
	check("群里安静了会主动冒泡", got.length > 0 || logs3.some((l) => l.includes("想冒泡")), show(got) || logs3.filter((l) => l.includes("冒泡")).join(" "));
	check("冒泡后不会自说自话连着冒", outbox.slice(before).filter((m) => m.to === 888 && !m.image).length <= 3);

	console.log("—— 大肥鱼日志\n" + logs3.filter((l) => /->|<-|表情|冒泡|主动/.test(l)).slice(-20).join("\n"));
} finally {
	await api("/api/fish/stop", {}).catch(() => {});
	await sleep(1500);
	server.kill();
	wss.close();
}
console.log(fail ? `❌ ${fail} 项失败` : "✅ 全部通过");
process.exit(fail ? 1 : 0);
