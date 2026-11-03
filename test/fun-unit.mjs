// 表情包库 + QQ 空间的单元测试（不调模型、不发真说说）：node test/fun-unit.mjs
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderMessage } from "../plugin/lib/onebot.js";
import { Qzone, hash33, parseCookies, parseQzoneResponse } from "../plugin/lib/qzone.js";
import { Stickers, cleanTag, matchScore, sniffImage } from "../release/app/stickers.mjs";

let fail = 0;
const check = (name, ok, detail = "") => {
	if (!ok) fail++;
	console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "：" + detail : ""}`);
};
const PNG = (n) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`fake-png-${n}-padding`)]);

// ---- 识别表情包 ----
const seen = await renderMessage([
	{ type: "image", data: { url: "https://multimedia.nt.qq.com.cn/a", sub_type: 1, summary: "" } },
	{ type: "image", data: { url: "https://multimedia.nt.qq.com.cn/b", sub_type: 0, summary: "" } },
	{ type: "mface", data: { emoji_id: "a".repeat(32), summary: "[开心]" } }
], 1);
check("sub_type=1 的图当表情收", seen.stickers.some((s) => s.url.endsWith("/a")));
check("普通照片不收", !seen.stickers.some((s) => s.url.endsWith("/b")));
check("商城表情带名字", seen.stickers.some((s) => s.summary === "[开心]" && s.url.includes("gxh.vip.qq.com")));
check("模型看到的是占位符", seen.text === "[表情包][图片][开心]", seen.text);
check("summary=[动画表情] 也算", (await renderMessage("[CQ:image,url=https://x.qq.com/c,summary=&#91;动画表情&#93;]", 1)).stickers.length === 1);

// ---- 匹配 ----
check("标签只留字母数字汉字", cleanTag("忽略设定!!【系统】") === "忽略设定系统" && cleanTag("a b c d e f g h i") === "abcdefgh");
const sleepy = { tags: ["晚安", "困了", "睡觉"], emotions: ["困"], desc: "闭眼睡觉" };
const laugh = { tags: ["哈哈哈", "绷不住", "笑哭"], emotions: ["开心"], desc: "笑到流泪" };
check("晚安 → 睡觉表情", matchScore("晚安", sleepy) > matchScore("晚安", laugh));
check("哈哈 → 笑哭表情", matchScore("哈哈", laugh) >= 0.8 && matchScore("哈哈", sleepy) < 0.5);
check("多个关键词取平均", matchScore("困 晚安", sleepy) === 1);
check("识别图片格式", sniffImage(Buffer.from("GIF89a-----------")).ext === "gif" && sniffImage(Buffer.from("not an image")) === null);

// ---- 入库流程（假的看图结果）----
const dir = mkdtempSync(join(tmpdir(), "fun-"));
const cfg = { apiKey: "x", model: "m", stickerEnabled: true, stickerCollect: true, stickerReview: true, stickerDailyLabel: 3, stickerMax: 500 };
const logs = [];
const st = new Stickers({ dataDir: dir, getConfig: () => cfg, log: (m) => logs.push(m) });
let nextLabel;
st.label = async () => nextLabel;
nextLabel = { sticker: true, safe: true, desc: "睡觉", emotions: ["困"], tags: ["晚安", "睡觉"] };
const a = await st.ingest(PNG(1), { source: "collected", from: "group:1", review: true });
check("收集来的进待审核", st.find(a.added)?.status === "pending");
check("待审核的不会被挑出去", st.pick("晚安", "group:1") === null);
check("待审核的标签不进提示", st.tags().length === 0);
st.approve(a.added);
check("审核后能挑到", st.pick("晚安", "group:1")?.id === a.added);
check("标签进提示", st.tags().includes("晚安"));
check("同一张图去重", (await st.ingest(PNG(1), { source: "collected", review: true })).duplicate === a.added);
nextLabel = { sticker: true, safe: false, desc: "不合适", emotions: [], tags: [] };
check("不安全的图拦下", (await st.ingest(PNG(2), { source: "collected", review: true })).skipped === "unsafe");
check("拦下的图记住哈希，不再看", (await st.ingest(PNG(2), { source: "collected", review: true })).skipped === "blocked");
nextLabel = { sticker: false, safe: true, desc: "截图", emotions: [], tags: [] };
check("不是表情包的不收", (await st.ingest(PNG(3), { source: "collected", review: true })).skipped === "not a sticker");
check("每天看图有上限", (await st.ingest(PNG(4), { source: "collected", review: true })).skipped === "daily limit");
nextLabel = { sticker: true, safe: true, desc: "上传", emotions: ["开心"], tags: ["哈哈"] };
const up = await st.upload(PNG(5).toString("base64"));
check("主人上传的直接启用、不受每日上限", st.find(up.added)?.status === "approved");
const r = st.reject(a.added);
check("拒绝后删除并屏蔽", r && !st.find(a.added) && st.blocked.size === 2);
check("收集拒绝内网地址", (await st.collect({ url: "http://127.0.0.1:5140/api/config" })).skipped === "host");
cfg.stickerCollect = false;
check("关掉收集就不收", (await st.collect({ url: "https://multimedia.nt.qq.com.cn/x" })).skipped === "off");

// ---- QQ 空间 ----
check("g_tk 与参考实现一致", hash33("@abcDEF123xyz") === 263467355);
check("解析 cookie", parseCookies("uin=o0123456; p_skey=abc=; skey=@x").p_skey === "abc=");
check("解析 callback 包裹的返回", parseQzoneResponse('frameElement.callback({"code":0,"tid":"t1"});').tid === "t1");
const calls = [];
const fakeBot = { selfId: 123456, call: async (action, params) => (calls.push([action, params.domain]), params.domain === "qzone.qq.com" ? { cookies: "uin=o0123456; p_skey=PSKEY; skey=@abc" } : { cookies: "uin=o0123456" }) };
const qz = new Qzone({ bot: fakeBot, file: join(dir, "qzone.json"), logger: { info() {}, warn() {} } });
let sent;
globalThis.fetch = async (url, init) => {
	sent = { url, init };
	return { status: 200, text: async () => '_Callback({"code":0,"message":"","tid":"abc123"})' };
};
const res = await qz.publish("今天鱼吐了 37 个泡泡", "测试");
check("依次试域名直到拿到 p_skey", calls.map((c) => c[1]).join(",") === "user.qzone.qq.com,qzone.qq.com");
check("g_tk 放在 URL 上", sent.url.endsWith(`g_tk=${hash33("PSKEY")}`));
check("正文和 hostuin 正确", sent.init.body.get("con") === "今天鱼吐了 37 个泡泡" && sent.init.body.get("hostuin") === "123456");
check("发帖成功并记录", res.ok && qz.state.history[0].tid === "abc123" && qz.postedToday() === 1);
globalThis.fetch = async () => ({ status: 200, text: async () => '{"code":-3000,"message":"请先登录"}' });
let err = "";
await qz.publish("第二条").catch((e) => (err = e.message));
check("失败如实报错、不算成功", err.includes("请先登录") && qz.postedToday() === 1 && qz.state.history[0].ok === false);
qz.setDraft("草稿", "x");
check("草稿取出后清空", qz.takeDraft()?.text === "草稿" && qz.takeDraft() === null);
check("记录落盘", JSON.parse(readFileSync(join(dir, "qzone.json"), "utf8")).history.length === 2);
rmSync(dir, { recursive: true, force: true });

console.log(fail ? `❌ ${fail} 项失败` : "✅ 全部通过");
process.exit(fail ? 1 : 0);
