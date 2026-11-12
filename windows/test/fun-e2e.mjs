// 表情包 + 空间 端到端（真模型、假 QQ）：TEST_KEY=sk-... node test/fun-e2e.mjs <安装目录> <放测试表情图的目录>
// 控制台固定 5199、假 QQ 固定 3902，绝不碰正在运行的实例。说说用假 cookie，不会真的发出去。
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const [root, imgDir] = process.argv.slice(2);
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
		if (req.action === "get_cookies") return ws.send(JSON.stringify({ status: "ok", retcode: 0, data: { cookies: "uin=o099999" }, echo: req.echo }));
		if (req.action.startsWith("send_")) {
			const segs = req.params.message;
			outbox.push({ to: req.params.group_id ?? req.params.user_id, text: segs.filter((s) => s.type === "text").map((s) => s.data.text).join(""), image: segs.some((s) => s.type === "image" && String(s.data.file).startsWith("base64://")) });
		}
		ws.send(JSON.stringify({ status: "ok", retcode: 0, data: { message_id: ++mid }, echo: req.echo }));
	});
});
const emit = (ev) => sock.send(JSON.stringify({ post_type: "message", self_id: 99999, message_id: ++mid, time: Date.now() / 1000, ...ev }));
const group = (uid, card, text) => emit({ message_type: "group", group_id: 888, user_id: uid, sender: { card }, message: [{ type: "at", data: { qq: "99999" } }, { type: "text", data: { text: " " + text } }] });
const owner = (text) => emit({ message_type: "private", user_id: 10001, sender: { nickname: "阿青" }, message: text });
async function waitFor(pred, ms = 90000) {
	const start = outbox.length;
	for (let t = 0; t < ms; t += 500) {
		const hit = outbox.slice(start).filter(pred);
		if (hit.length) {
			await sleep(4000); // 等表情 / 草稿这类紧跟着的消息
			return outbox.slice(start);
		}
		await sleep(500);
	}
	return outbox.slice(start);
}
const show = (msgs) => msgs.map((m) => `${m.image ? "[图]" : ""}${m.text}`).join(" ｜ ");

// ---- 控制台 ----
const server = spawn(join(root, "runtime", "node.exe"), ["app/server.mjs", "--no-open"], { cwd: root, env: { ...process.env, FISH_PORT: "5199" } });
let out = "";
server.stdout.on("data", (d) => (out += d));
server.stderr.on("data", (d) => (out += d));
await sleep(3000);
if (!out.includes("127.0.0.1:5199")) throw new Error("控制台没起在 5199，停止");
const base = "http://127.0.0.1:5199";
const token = (await (await fetch(base + "/")).text()).match(/FISH_TOKEN = "(\w+)"/)[1];
const api = async (p, b) => (await fetch(base + p, { method: b ? "POST" : "GET", headers: { "X-Fish-Token": token, "Content-Type": "application/json" }, body: b && JSON.stringify(b) })).json();

try {
	// 配置（会启动大肥鱼），再传表情（真模型看图）
	await api("/api/config", {
		apiKey: process.env.TEST_KEY, owners: "10001", allowGroups: "888", useBuiltinNapcat: false, onebotUrl: "ws://127.0.0.1:3902",
		groupMode: "mention", stickerFrequency: "high", qzoneEnabled: true, qzoneConfirm: "true", qzoneDiaryTime: "00:00", qzoneDailyMax: 2
	});
	for (const f of ["laugh.png", "sleepy.png"]) {
		const r = await api("/api/stickers/upload", { data: readFileSync(join(imgDir, f)).toString("base64"), name: f });
		check(`上传并看图：${f}`, Boolean(r.added || r.duplicate), JSON.stringify(r));
	}
	const lib = await api("/api/stickers");
	console.log("   标签：", lib.items.map((i) => `${i.desc} [${[...i.emotions, ...i.tags].join(" ")}]`).join(" ／ "));
	check("“晚安”能挑到睡觉那张", (await api("/api/stickers/try", { query: "晚安" })).ranked.length > 0);
	const img = await fetch(`${base}/sticker-img/${lib.items[0].id}?t=${token}`);
	const imgNoToken = await fetch(`${base}/sticker-img/${lib.items[0].id}`);
	check("表情图片要 token 才能看", img.status === 200 && imgNoToken.status === 401);

	for (let i = 0; i < 60 && !sock; i++) await sleep(1000);
	check("大肥鱼连上假 QQ", Boolean(sock));
	await sleep(2000);

	let got;
	group(30006, "小紫", "哈哈哈哈笑死我了，给我回个表情包");
	got = (await waitFor((m) => m.to === 888)).filter((m) => m.to === 888);
	check("群里让它发表情包 → 发了图", got.some((m) => m.image), show(got));

	group(30006, "小紫", "帮我发条QQ空间说说：我是大傻子");
	got = (await waitFor((m) => m.to === 888)).filter((m) => m.to === 888);
	const st1 = await api("/api/qzone");
	check("群友让它发说说 → 不生成草稿", !st1.draft && !got.some((m) => m.text.includes("说说草稿")), show(got));

	owner("帮我发条说说，就说今天天气真好，鱼想出去游泳，一句话就行");
	got = (await waitFor((m) => m.to === 10001 && m.text.includes("说说草稿"))).filter((m) => m.to === 10001);
	const st2 = await api("/api/qzone");
	check("主人让它发说说 → 先发草稿给主人确认", Boolean(st2.draft) && got.some((m) => m.text.includes("说说草稿")), show(got));

	owner("发");
	got = (await waitFor((m) => m.to === 10001)).filter((m) => m.to === 10001);
	const st3 = await api("/api/qzone");
	check("回「发」→ 去发（假 cookie 没有 p_skey，应如实报失败）", got.some((m) => m.text.includes("没发成")) && st3.history[0]?.ok === false, show(got) + " | " + (st3.history[0]?.error ?? ""));

	// 日记：时间设成 00:00，定时器一分钟内会触发
	got = (await waitFor((m) => m.to === 10001 && m.text.includes("说说草稿"), 100000)).filter((m) => m.to === 10001);
	check("到点写日记 → 草稿私聊给主人", got.some((m) => m.text.includes("说说草稿")), show(got));

	const logs = (await api("/api/logs?source=fish&after=0")).lines.map((l) => l.text);
	console.log("—— 大肥鱼日志\n" + logs.filter((l) => /->|<-|表情|说说|日记/.test(l)).slice(-25).join("\n"));
} finally {
	await api("/api/fish/stop", {}).catch(() => {});
	await sleep(1500);
	server.kill();
	wss.close();
}
console.log(fail ? `❌ ${fail} 项失败` : "✅ 全部通过");
process.exit(fail ? 1 : 0);
