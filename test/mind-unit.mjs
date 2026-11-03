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

rmSync(dir, { recursive: true, force: true });
console.log(fail ? `❌ ${fail} 项失败` : "✅ 全部通过");
process.exit(fail ? 1 : 0);
