import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveAuxEffort } from "../plugin/lib/model-bridge.js";

const route = { provider: "test", model: "chat", reasoningEffort: "high" };
const llm = { resolveModelInfo: async () => ({ reasoning: { defaultEffort: "low" } }) };
assert.equal(await resolveAuxEffort(llm, route, "follow"), "high");
assert.equal(await resolveAuxEffort(llm, { provider: "test", model: "chat" }, "follow"), "low");
assert.equal(await resolveAuxEffort({ resolveModelInfo: async () => ({}) }, route && { provider: "test", model: "chat" }, "follow"), undefined);
assert.equal(await resolveAuxEffort(llm, route, "default"), undefined);
assert.equal(await resolveAuxEffort(llm, route, "off"), "off");
assert.equal(await resolveAuxEffort(llm, route, "low"), "low");

const dir = mkdtempSync(join(tmpdir(), "fish-reasoning-"));
process.env.FISH_RUNTIME_DIR = dir;
const { update, load, chatSelection } = await import("../release/app/config.mjs");
try {
	let c = update({ chatModel: JSON.stringify(["test", "chat"]), chatReasoningEffort: "high", memoryReasoningEffort: "low", visionReasoningEffort: "default" });
	assert.equal(chatSelection(c).reasoningEffort, "high");
	assert.equal(load().memoryReasoningEffort, "low");
	assert.equal(load().visionReasoningEffort, "default");
	assert.throws(() => update({ memoryReasoningEffort: "invalid value!" }));
	c = update({ memoryReasoningEffort: "" });
	assert.equal(c.memoryReasoningEffort, "");
	console.log("思考等级配置、跟随和模型默认通过");
} finally { rmSync(dir, { recursive: true, force: true }); }
