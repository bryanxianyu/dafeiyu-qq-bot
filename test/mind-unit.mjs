// 艾宾浩斯通道的单元测试（不调模型）：node test/mind-unit.mjs
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Mind, retrievability, timeUntil } from "../release/app/mind.mjs";

const DAY = 86400000;
let fail = 0;
const check = (name, ok, detail = "") => {
	if (!ok) fail++;
	console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "：" + detail : ""}`);
};
const dir = mkdtempSync(join(tmpdir(), "mind-"));
const config = { memoryEnabled: true, memoryTopK: 5, memoryBudget: 600, memoryForgetBelow: 0.03, memoryExtractEvery: 99, persona: "" };
const mind = new Mind({ dataDir: dir, getConfig: () => config, log: () => {} });

// 曲线本身
const m = { lastReview: Date.now() - 7 * DAY, stability: 7 };
check("R(t=S) = e^-1 ≈ 36.8%", Math.abs(retrievability(m) - Math.exp(-1)) < 1e-3, `${(retrievability(m) * 100).toFixed(1)}%`);
check("降到 50% 的时间 = S·ln2", Math.abs(timeUntil({ lastReview: 0, stability: 7 }, 0.5, 0) / DAY - 7 * Math.LN2) < 1e-6);

// 间隔效应：快忘时想起，加固更多
const early = { lastReview: Date.now() - 0.1 * DAY, stability: 7, reviews: 0 };
const late = { lastReview: Date.now() - 14 * DAY, stability: 7, reviews: 0 };
mind.review(early);
mind.review(late);
check("刚记住就复习，稳定度涨得少", early.stability < 9, `7 → ${early.stability.toFixed(2)} 天`);
check("快忘时复习，稳定度涨得多", late.stability > 15, `7 → ${late.stability.toFixed(2)} 天`);

// 回想：相关 + 见人想事；重要度决定初始稳定度
mind.addMemory({ scope: "user:1", text: "小明养了一只叫豆包的柯基", importance: 4 });
mind.addMemory({ scope: "user:1", text: "小明最近在学吉他", importance: 2 });
mind.addMemory({ scope: "user:2", text: "小红喜欢猫", importance: 4 });
mind.memories[0].keywords = ["狗", "宠物", "柯基"];
const r1 = mind.recall("private:1", 1, "我的狗最近不爱吃饭");
check("按检索关键词想起（狗 → 柯基）", r1.includes("豆包"));
check("不会想起别人的事", !r1.includes("小红"));
check("初始稳定度由重要度决定", mind.memories[0].stability > mind.memories[1].stability);

// 遗忘：很久没被想起 → 清晰度跌破阈值 → 归档；可恢复
const old = mind.memories.find((x) => x.text.includes("吉他"));
old.lastReview = Date.now() - 30 * DAY; // S=1 天，30 天后 R ≈ e^-30
check("30 天没想起的琐事清晰度≈0", retrievability(old) < 0.001);
mind.sweep();
check("归档（忘了）", !mind.memories.includes(old) && mind.archive.some((x) => x.id === old.id));
check("忘掉的不再被想起", !mind.recall("private:1", 1, "吉他").includes("吉他"));
mind.restoreMemory(old.id);
check("恢复后又能想起", mind.recall("private:1", 1, "吉他").includes("吉他"));

// 模糊的记忆带上提示
const faded = mind.memories.find((x) => x.text.includes("豆包"));
faded.lastReview = Date.now() - 12 * DAY; // S≈7+ 天 → R≈0.2
check("模糊记忆标注“很模糊”", mind.recall("private:1", 1, "豆包").includes("模糊"));

// 锚定文本
mind.saveCards({ cards: [{ id: "a", name: "甲", identity: "你是甲", absolute: [{ text: "主人叫阿青" }, { text: "只在群1生效", scope: "group:1" }] }], defaultCard: "a", bindings: {} });
check("锚定文本含绝对记忆", mind.anchor("private:1").includes("主人叫阿青"));
check("限定范围的绝对记忆只在对应聊天出现", !mind.anchor("private:1").includes("只在群1") && mind.anchor("group:1").includes("只在群1"));

mind.generateJson = async () => ({ value: { memories: [], core: [] }, tokens: 10 });
mind.observe("private:1", { nickname: "小明", userId: 1, isOwner: true }, "你好", "你好");
await mind.flush("private:1");
check("空结果记录为模型没有返回记忆", mind.stats.lastExtraction.status === "success" && mind.stats.lastExtraction.candidates === 0 && mind.stats.lastExtraction.turns === 1);
mind.generateJson = async () => ({ value: { memories: [{ text: "小明喜欢芒果", from: 1, userId: 1, about: "user", importance: 3 }], core: [] }, tokens: 20 });
mind.observe("private:1", { nickname: "小明", userId: 1, isOwner: true }, "我喜欢芒果", "收到");
await mind.flush("private:1");
check("整理状态记录实际新增", mind.stats.lastExtraction.candidates === 1 && mind.stats.lastExtraction.added === 1 && mind.memories.some((x) => x.text.includes("芒果")));
mind.generateJson = async () => { throw new Error("模拟失败"); };
mind.observe("private:1", { nickname: "小明", userId: 1, isOwner: true }, "再聊", "好");
await mind.flush("private:1");
check("整理失败记录状态", mind.stats.lastExtraction.status === "failed");
check("失败后对话仍在待整理队列", mind.listMemories().stats.buffered === 1);

const sender = { nickname: "小明", userId: 1, isOwner: true };
mind.observe("group:1", sender, "我常去游泳");
let resolveExtraction;
let groupPrompt = "";
mind.generateJson = (_use, prompt) => {
	groupPrompt = prompt;
	return new Promise((resolve) => { resolveExtraction = resolve; });
};
const inFlight = mind.extract("group:1");
mind.observe("group:1", sender, "我也学过滑冰");
const duringExtraction = new Mind({ dataDir: dir, getConfig: () => config, log: () => {} });
check("整理进行中重启仍能读到原批次和新消息", duringExtraction.listMemories().stats.buffered === 3);
check("只有群友发言也能生成整理输入", groupPrompt.includes("我常去游泳") && !groupPrompt.includes("undefined"));
resolveExtraction({ value: { memories: [], core: [] }, tokens: 1 });
await inFlight;
check("整理成功只消费本批次，期间收到的新消息仍待整理", mind.listMemories().stats.buffered === 2);

let retriedPrompt = "";
const restarted = new Mind({ dataDir: dir, getConfig: () => config, log: () => {}, generateJson: async (_use, prompt) => {
	retriedPrompt = prompt;
	return { value: { memories: [], core: [] }, tokens: 1 };
} });
check("重启后恢复失败的批次和未整理的新消息", restarted.listMemories().stats.buffered === 2);
const realNow = Date.now;
try {
	restarted.flushIdle();
	check("失败批次在重试间隔内不会再次调用", !retriedPrompt);
	Date.now = () => realNow() + 65_000;
	restarted.flushIdle();
	await restarted.flush("private:1");
	check("后台重试恢复原始对话，成功后从队列移除", retriedPrompt.includes("再聊") && restarted.listMemories().stats.buffered === 1);
	Date.now = () => realNow() + 185_000;
	restarted.flushIdle();
	await restarted.flush("group:1");
	check("恢复后无新消息也会整理闲置批次", retriedPrompt.includes("我也学过滑冰") && restarted.listMemories().stats.buffered === 0);
} finally {
	Date.now = realNow;
}

rmSync(dir, { recursive: true, force: true });
console.log(fail ? `❌ ${fail} 项失败` : "✅ 全部通过");
process.exit(fail ? 1 : 0);
